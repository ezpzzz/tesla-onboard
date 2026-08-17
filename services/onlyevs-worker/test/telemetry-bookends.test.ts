import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { BOOKEND_END_TRACKING_GRACE_MS, HISTORY_RETENTION_MS } from "@/lib/owner/telemetry-policy";
import type { TelemetryUpdate } from "@/lib/owner/telemetry-ingest";

// Module-scope side effects in index.ts (Pool/keyring construction) need
// these before the dynamic import below -- see the "isMainModule" guard at
// the bottom of index.ts, which is what keeps this import from also
// starting a real Kafka consumer / claim loop.
process.env.ONLYEVS_WORKER_DATABASE_URL = "postgres://user:pass@localhost:5432/db";
process.env.ONLYEVS_TRIP_BINDING_HMAC_SECRET = "x".repeat(32);
process.env.ONLYEVS_DATA_ENCRYPTION_KEYS = "1:ycU65hn79R5/DsFzSz0g1gPVn6OR/N88nlWm7b5hQQc=";

// segmentChargeSessions (lib/owner/charge-sessions.ts) is the data-layer
// lane's stub (T10) -- it throws by design until that lane lands. Mocking
// it here pins composeTripEvidencePacket's degrade-on-not-implemented
// behavior to an explicit, controllable throw rather than depending on
// another lane's in-flight file.
vi.mock("@/lib/owner/charge-sessions", () => ({
  segmentChargeSessions: vi.fn(() => {
    throw new Error("segmentChargeSessions: not implemented (T10 charging lane)");
  }),
}));

const {
  advanceTripStatusesAndComposePackets,
  captureBookendEdge,
  composeTripEvidencePacket,
  ingestTelemetry,
  numberOrNull,
  sweepHistoryRetention,
  sweepLocationPointRetention,
  sweepRetention,
  sweepTripBookends,
} = await import("@/services/onlyevs-worker/index");
const { segmentChargeSessions } = await import("@/lib/owner/charge-sessions");
const { credentialKeyringFromEnv, encryptCredential } = await import("@/lib/owner/credential-envelope");

interface QueryLogEntry {
  sql: string;
  params: unknown[];
}

type QueryHandler = (sql: string, params: unknown[]) => { rows: unknown[] } | undefined;

/**
 * A fake pg Pool/PoolClient pair sharing one query log and one dispatch
 * table, matching the fake-client convention already used in
 * email-action-executor.test.ts (query calls recorded, SQL matched by
 * substring, canned rows returned). Both `pool.query(...)` (used by
 * sweepHistoryRetention/advanceTripStatusesAndComposePackets/ingestTelemetry's
 * `pool.connect()`) and a connected client's `.query(...)` route through the
 * same handler, since none of these functions need real transactional
 * isolation to be contract-tested.
 */
function makeFakePool(handler: QueryHandler) {
  const queries: QueryLogEntry[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    const result = handler(sql, params);
    return result ?? { rows: [], rowCount: 0 };
  });
  const client = { query, release: vi.fn() } as unknown as PoolClient;
  const pool = { query, connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, client, queries };
}

function findQuery(queries: QueryLogEntry[], match: string | RegExp): QueryLogEntry | undefined {
  return queries.find((q) => (typeof match === "string" ? q.sql.includes(match) : match.test(q.sql)));
}

beforeEach(() => {
  vi.mocked(segmentChargeSessions).mockClear();
});

describe("ingestTelemetry -- history append + split late-event policy (T2/T3)", () => {
  const NOW = Date.parse("2026-08-17T12:00:00Z");

  function baseUpdate(overrides: Partial<TelemetryUpdate> = {}): TelemetryUpdate {
    return { vin: "5YJ3E1EA7KF000001", observedAt: NOW, batteryPct: 55, odometerMi: 12_000, ...overrides };
  }

  it("valid event: appends to history (idempotent on conflict) and updates the fresh live card", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("from public.onlyevs_vehicles where vin")) {
        return { rows: [{ id: "veh-1", workspace_id: "ws-1" }] };
      }
      return undefined;
    });

    await ingestTelemetry(pool, baseUpdate(), "onlyevs_V:0:100");

    const historyInsert = findQuery(queries, "insert into public.onlyevs_vehicle_stats_history");
    expect(historyInsert).toBeDefined();
    expect(historyInsert!.sql).toContain("on conflict (workspace_id, source_message_id) do nothing");
    expect(historyInsert!.params).toEqual([
      "ws-1", "veh-1", new Date(NOW), 55, null, 12_000, null, null, "onlyevs_V:0:100", new Date(NOW + HISTORY_RETENTION_MS),
    ]);

    const currentInsert = findQuery(queries, "insert into public.onlyevs_vehicle_stats_current");
    expect(currentInsert).toBeDefined();
  });

  it("dupe source_message_id: idempotency is a single atomic INSERT ... ON CONFLICT DO NOTHING, never a check-then-insert race", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("from public.onlyevs_vehicles where vin")) return { rows: [{ id: "veh-1", workspace_id: "ws-1" }] };
      return undefined;
    });

    await ingestTelemetry(pool, baseUpdate(), "onlyevs_V:0:100");
    await ingestTelemetry(pool, baseUpdate(), "onlyevs_V:0:100");

    const historyInserts = queries.filter((q) => q.sql.includes("insert into public.onlyevs_vehicle_stats_history"));
    expect(historyInserts).toHaveLength(2);
    // No separate existence-check select ever precedes the insert -- the
    // unique(workspace_id, source_message_id) constraint is the only guard.
    expect(queries.some((q) => q.sql.includes("select") && q.sql.includes("source_message_id"))).toBe(false);
    for (const insert of historyInserts) {
      expect(insert.sql).toContain("on conflict (workspace_id, source_message_id) do nothing");
    }
  });

  it("out-of-order event: history has no monotonic guard (unlike stats_current) -- always appended", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("from public.onlyevs_vehicles where vin")) return { rows: [{ id: "veh-1", workspace_id: "ws-1" }] };
      return undefined;
    });

    await ingestTelemetry(pool, baseUpdate({ observedAt: NOW - 60_000 }), "onlyevs_V:0:50");

    const historyInsert = findQuery(queries, "insert into public.onlyevs_vehicle_stats_history")!;
    expect(historyInsert.sql).not.toMatch(/where[\s\S]*observed_at/i);

    const currentInsert = findQuery(queries, "insert into public.onlyevs_vehicle_stats_current")!;
    expect(currentInsert.sql).toContain("onlyevs_vehicle_stats_current.observed_at is null or excluded.observed_at >=");
  });

  it("unknown VIN: no vehicle row matches -- nothing is written", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("from public.onlyevs_vehicles where vin")) return { rows: [] };
      return undefined;
    });

    await ingestTelemetry(pool, baseUpdate(), "onlyevs_V:0:1");

    expect(queries.filter((q) => q.sql.includes("insert into"))).toHaveLength(0);
  });

  it("ambiguous VIN: two active vehicles share it -- attribution is refused, nothing is written, and the skip is logged (VIN masked to last 6 chars)", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("from public.onlyevs_vehicles where vin")) {
        return { rows: [{ id: "veh-1", workspace_id: "ws-1" }, { id: "veh-2", workspace_id: "ws-2" }] };
      }
      return undefined;
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await ingestTelemetry(pool, baseUpdate(), "onlyevs_V:0:2");

    expect(queries.filter((q) => q.sql.includes("insert into"))).toHaveLength(0);
    // baseUpdate()'s vin is "5YJ3E1EA7KF000001" -- masked to its last 6 chars.
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("000001"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("2 active vehicles"));
    // The full VIN is never logged, only the masked tail.
    const warnedText = warnSpy.mock.calls.map((call) => String(call[0])).join(" ");
    expect(warnedText).not.toContain("5YJ3E1EA7KF000001");
    warnSpy.mockRestore();
  });

  it("split late-event policy: an event older than 24h still appends to history but never touches the live card", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("from public.onlyevs_vehicles where vin")) return { rows: [{ id: "veh-1", workspace_id: "ws-1" }] };
      return undefined;
    });

    const threeDaysAgo = NOW - 3 * 24 * 60 * 60 * 1_000;
    await ingestTelemetry(pool, baseUpdate({ observedAt: threeDaysAgo }), "onlyevs_V:0:3");

    expect(findQuery(queries, "insert into public.onlyevs_vehicle_stats_history")).toBeDefined();
    expect(findQuery(queries, "insert into public.onlyevs_vehicle_stats_current")).toBeUndefined();
  });

  it("an event within 24h does touch the live card", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("from public.onlyevs_vehicles where vin")) return { rows: [{ id: "veh-1", workspace_id: "ws-1" }] };
      return undefined;
    });

    await ingestTelemetry(pool, baseUpdate({ observedAt: NOW - 60_000 }), "onlyevs_V:0:4");

    expect(findQuery(queries, "insert into public.onlyevs_vehicle_stats_current")).toBeDefined();
  });

  describe("location write-path trip attribution: consent invariant mirrors locationNeeded()", () => {
    it("the trip-attribution query filters out revoked/expired/failed_terminal grants, exactly like locationNeeded()", async () => {
      const { pool, queries } = makeFakePool((sql) => {
        if (sql.includes("from public.onlyevs_vehicles where vin")) return { rows: [{ id: "veh-1", workspace_id: "ws-1" }] };
        if (sql.includes("from public.onlyevs_trips t") && sql.includes("onlyevs_access_grants")) return { rows: [] };
        return undefined;
      });

      await ingestTelemetry(pool, baseUpdate({ location: { latitude: 37.7, longitude: -122.4 } }), "onlyevs_V:0:5");

      const tripQuery = findQuery(queries, /from public\.onlyevs_trips t[\s\S]*onlyevs_access_grants/)!;
      expect(tripQuery.sql).toContain("g.status not in ('revoked', 'expired', 'failed_terminal')");
      // No candidate row (the fake grant-status filter above returned none) --
      // the location insert must never fire without an attributed trip.
      expect(findQuery(queries, "insert into private.onlyevs_vehicle_location_points")).toBeUndefined();
    });

    it("still writes the location point when exactly one non-revoked, consented trip attributes it", async () => {
      const { pool, queries } = makeFakePool((sql) => {
        if (sql.includes("from public.onlyevs_vehicles where vin")) return { rows: [{ id: "veh-1", workspace_id: "ws-1" }] };
        if (sql.includes("from public.onlyevs_trips t") && sql.includes("onlyevs_access_grants")) {
          return { rows: [{ trip_id: "trip-1", shop_slug: "shop-1" }] };
        }
        return undefined;
      });

      await ingestTelemetry(pool, baseUpdate({ location: { latitude: 37.7, longitude: -122.4 } }), "onlyevs_V:0:6");

      expect(findQuery(queries, "insert into private.onlyevs_vehicle_location_points")).toBeDefined();
    });
  });
});

describe("captureBookendEdge -- absent-data + freshness rule wired to SQL (T5)", () => {
  it("insert_only mode uses ON CONFLICT DO NOTHING (start bookend: first-write-wins, never overwritten)", async () => {
    const { client, queries } = makeFakePool(() => undefined);
    await captureBookendEdge(client, { id: "trip-1", workspaceId: "ws-1", vehicleId: "veh-1" }, "start", Date.now(), "insert_only");
    const insert = findQuery(queries, "insert into private.onlyevs_trip_bookends")!;
    expect(insert.sql).toContain("on conflict (trip_id, edge) do nothing");
  });

  it("upsert mode uses ON CONFLICT DO UPDATE (end bookend: latest-write-wins)", async () => {
    const { client, queries } = makeFakePool(() => undefined);
    await captureBookendEdge(client, { id: "trip-1", workspaceId: "ws-1", vehicleId: "veh-1" }, "end", Date.now(), "upsert");
    const insert = findQuery(queries, "insert into private.onlyevs_trip_bookends")!;
    expect(insert.sql).toContain("on conflict (trip_id, edge) do update set");
  });

  it("absent-data rule: no stats row -- both fields recorded null, never fabricated, still written (not skipped)", async () => {
    const { client, queries } = makeFakePool((sql) => {
      if (sql.includes("from public.onlyevs_vehicle_stats_current")) return { rows: [] };
      return undefined;
    });
    await captureBookendEdge(client, { id: "trip-1", workspaceId: "ws-1", vehicleId: "veh-1" }, "start", Date.now(), "insert_only");
    const insert = findQuery(queries, "insert into private.onlyevs_trip_bookends")!;
    // params: [workspace_id, trip_id, edge, odometer_mi, odometer_observed_at, battery_pct, battery_observed_at, captured_at, stale]
    expect(insert.params[3]).toBeNull();
    expect(insert.params[4]).toBeNull();
    expect(insert.params[5]).toBeNull();
    expect(insert.params[6]).toBeNull();
    expect(insert.params[8]).toBe(false);
  });

  it("absent-data rule: one field never streamed -- that field is null, the other is captured", async () => {
    const { client, queries } = makeFakePool((sql) => {
      if (sql.includes("from public.onlyevs_vehicle_stats_current")) {
        return { rows: [{ odometer_mi: "12000.50", odometer_observed_at: new Date("2026-08-17T12:00:00Z"), battery_pct: null, battery_observed_at: null }] };
      }
      return undefined;
    });
    await captureBookendEdge(client, { id: "trip-1", workspaceId: "ws-1", vehicleId: "veh-1" }, "start", Date.parse("2026-08-17T12:00:00Z"), "insert_only");
    const insert = findQuery(queries, "insert into private.onlyevs_trip_bookends")!;
    expect(insert.params[3]).toBe(12_000.5);
    expect(insert.params[5]).toBeNull();
  });

  it("stale rule: a field observed more than 30 minutes before the edge is stored with stale=true", async () => {
    const edgeAtMs = Date.parse("2026-08-17T12:00:00Z");
    const { client, queries } = makeFakePool((sql) => {
      if (sql.includes("from public.onlyevs_vehicle_stats_current")) {
        return {
          rows: [{
            odometer_mi: "12000",
            odometer_observed_at: new Date(edgeAtMs - 45 * 60_000),
            battery_pct: "80",
            battery_observed_at: new Date(edgeAtMs - 45 * 60_000),
          }],
        };
      }
      return undefined;
    });
    await captureBookendEdge(client, { id: "trip-1", workspaceId: "ws-1", vehicleId: "veh-1" }, "end", edgeAtMs, "upsert");
    const insert = findQuery(queries, "insert into private.onlyevs_trip_bookends")!;
    expect(insert.params[8]).toBe(true);
  });

  it("numberOrNull parses pg numeric strings without coercing invalid input to 0", () => {
    expect(numberOrNull("12345.60")).toBe(12345.6);
    expect(numberOrNull(null)).toBeNull();
    expect(numberOrNull(undefined)).toBeNull();
  });
});

describe("sweepTripBookends -- trip-window sweep trigger (eng-review Issue 1A) + straddle rule", () => {
  it("fires a start bookend for a due trip that has none yet", async () => {
    const startsAt = new Date(Date.now() - 60_000);
    const endsAt = new Date(Date.now() + 3_600_000);
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("not exists") && sql.includes("edge = 'start'")) {
        return { rows: [{ id: "trip-1", workspace_id: "ws-1", vehicle_id: "veh-1", starts_at: startsAt, ends_at: endsAt, status: "active" }] };
      }
      if (sql.includes("t.ends_at <= now()")) return { rows: [] };
      if (sql.includes("from public.onlyevs_vehicle_stats_current")) return { rows: [] };
      return undefined;
    });

    await sweepTripBookends(pool);

    const insert = findQuery(queries, "insert into private.onlyevs_trip_bookends")!;
    expect(insert).toBeDefined();
    expect(insert.params[2]).toBe("start");
  });

  it("does not fire a start bookend for a trip whose starts_at has not arrived yet (isBookendWindowDue false)", async () => {
    const startsAt = new Date(Date.now() + 3_600_000);
    const endsAt = new Date(Date.now() + 7_200_000);
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("not exists") && sql.includes("edge = 'start'")) {
        return { rows: [{ id: "trip-1", workspace_id: "ws-1", vehicle_id: "veh-1", starts_at: startsAt, ends_at: endsAt, status: "confirmed" }] };
      }
      if (sql.includes("t.ends_at <= now()")) return { rows: [] };
      return undefined;
    });

    await sweepTripBookends(pool);

    expect(queries.some((q) => q.sql.includes("insert into private.onlyevs_trip_bookends"))).toBe(false);
  });

  it("rollout straddle rule: a trip already 'completed' is never a start candidate (status filter excludes it)", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("not exists") && sql.includes("edge = 'start'")) {
        // Regression guard on the query shape itself: completed trips must
        // be excluded by the SQL WHERE clause, not by app-side filtering.
        expect(sql).toContain("status in ('confirmed', 'armed', 'active')");
        return { rows: [] }; // the DB filter already excluded the completed trip
      }
      if (sql.includes("t.ends_at <= now()")) return { rows: [] };
      return undefined;
    });

    await sweepTripBookends(pool);

    expect(queries.some((q) => q.sql.includes("insert into private.onlyevs_trip_bookends"))).toBe(false);
  });

  it("end bookend: fires the upsert for a due, still-tracking trip (grant-conflict-free window sweep path)", async () => {
    const startsAt = new Date(Date.now() - 7_200_000);
    const endsAt = new Date(Date.now() - 60_000);
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("not exists") && sql.includes("edge = 'start'")) return { rows: [] };
      if (sql.includes("t.ends_at <= now()")) {
        return { rows: [{ id: "trip-1", workspace_id: "ws-1", vehicle_id: "veh-1", starts_at: startsAt, ends_at: endsAt, status: "active" }] };
      }
      if (sql.includes("from public.onlyevs_vehicle_stats_current")) return { rows: [] };
      return undefined;
    });

    await sweepTripBookends(pool);

    const insert = findQuery(queries, "insert into private.onlyevs_trip_bookends")!;
    expect(insert.params[2]).toBe("end");
    expect(insert.sql).toContain("on conflict (trip_id, edge) do update set");
  });

  it("late-return rule: a trip past ends_at but still within the grace window keeps tracking on this sweep", async () => {
    const startsAt = new Date(Date.now() - 26 * 3_600_000);
    const endsAt = new Date(Date.now() - (BOOKEND_END_TRACKING_GRACE_MS - 3_600_000)); // 1h left of grace
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("not exists") && sql.includes("edge = 'start'")) return { rows: [] };
      if (sql.includes("t.ends_at <= now()")) {
        return { rows: [{ id: "trip-1", workspace_id: "ws-1", vehicle_id: "veh-1", starts_at: startsAt, ends_at: endsAt, status: "active" }] };
      }
      if (sql.includes("from public.onlyevs_vehicle_stats_current")) return { rows: [] };
      return undefined;
    });

    await sweepTripBookends(pool);

    expect(queries.some((q) => q.sql.includes("insert into private.onlyevs_trip_bookends"))).toBe(true);
  });

  it("status-transition interaction: the end-candidate query itself excludes 'completed' trips (grace cap enforced by the transition, not restated here)", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("not exists") && sql.includes("edge = 'start'")) return { rows: [] };
      if (sql.includes("t.ends_at <= now()")) {
        expect(sql).toContain("status not in ('cancelled', 'conflict', 'completed')");
        return { rows: [] };
      }
      return undefined;
    });

    await sweepTripBookends(pool);
    expect(queries.some((q) => q.sql.includes("insert into private.onlyevs_trip_bookends"))).toBe(false);
  });

  it("bounds the start-candidate query to trips starting soon and caps the batch (never an unbounded fleet-wide scan)", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("not exists") && sql.includes("edge = 'start'")) {
        expect(sql).toContain("t.starts_at <= now() + interval '1 hour'");
        expect(sql).toMatch(/limit \d+/);
        return { rows: [] };
      }
      if (sql.includes("t.ends_at <= now()")) return { rows: [] };
      return undefined;
    });

    await sweepTripBookends(pool);
    expect(queries.some((q) => q.sql.includes("insert into private.onlyevs_trip_bookends"))).toBe(false);
  });
});

describe("sweepHistoryRetention -- 13-month retention sweep (Lane D: LIMIT-batched)", () => {
  it("deletes history rows past their delete_after, LIMIT-batched", async () => {
    const { pool, queries } = makeFakePool(() => ({ rows: [], rowCount: 3 }));
    const deleted = await sweepHistoryRetention(pool);
    const del = findQuery(queries, "delete from public.onlyevs_vehicle_stats_history");
    expect(del).toBeDefined();
    expect(del!.sql).toContain("delete_after <= now()");
    expect(del!.sql).toContain("limit 5000");
    expect(deleted).toBe(3);
  });

  it("loops in further batches until an under-batch-size page comes back, summing the deleted count", async () => {
    let calls = 0;
    const { pool, queries } = makeFakePool(() => {
      calls += 1;
      return { rows: [], rowCount: calls === 1 ? 5000 : 120 };
    });
    const deleted = await sweepHistoryRetention(pool);
    expect(calls).toBe(2);
    expect(deleted).toBe(5120);
    expect(queries.filter((q) => q.sql.includes("onlyevs_vehicle_stats_history"))).toHaveLength(2);
  });
});

describe("sweepLocationPointRetention -- 30-day location-point retention sweep (Lane D)", () => {
  it("deletes location-point rows past their delete_after, LIMIT-batched", async () => {
    const { pool, queries } = makeFakePool(() => ({ rows: [], rowCount: 7 }));
    const deleted = await sweepLocationPointRetention(pool);
    const del = findQuery(queries, "delete from private.onlyevs_vehicle_location_points");
    expect(del).toBeDefined();
    expect(del!.sql).toContain("delete_after <= now()");
    expect(del!.sql).toContain("limit 5000");
    expect(deleted).toBe(7);
  });
});

describe("sweepRetention -- hourly-gated orchestrator over both retention tables (Lane D)", () => {
  // sweepRetention's once-per-hour guard is deliberate module-scope state
  // (see its comment in index.ts), so it persists across every test in this
  // file/process, not just this describe block. Each test below pins an
  // explicit system time via fake timers, at least a day past any time a
  // previous test in this suite could plausibly have used, so the guard is
  // reliably clear at the start of every test regardless of run order --
  // and the one test that specifically exercises the guard advances time by
  // only minutes for its second call, deliberately staying inside the
  // window.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs both tables' sweeps and logs the deleted counts when the guard allows it", async () => {
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("onlyevs_vehicle_stats_history")) return { rows: [], rowCount: 2 };
      if (sql.includes("onlyevs_vehicle_location_points")) return { rows: [], rowCount: 9 };
      return undefined;
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sweepRetention(pool);

    expect(queries.some((q) => q.sql.includes("onlyevs_vehicle_stats_history"))).toBe(true);
    expect(queries.some((q) => q.sql.includes("onlyevs_vehicle_location_points"))).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("2 onlyevs_vehicle_stats_history"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("9 onlyevs_vehicle_location_points"));
    logSpy.mockRestore();
  });

  it("does not log when nothing was deleted", async () => {
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    const { pool } = makeFakePool(() => ({ rows: [], rowCount: 0 }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sweepRetention(pool);

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("skips a second sweep called immediately after the first (hourly guard), running neither table's delete again", async () => {
    vi.setSystemTime(new Date("2026-01-03T00:00:00Z"));
    const { pool, queries } = makeFakePool(() => ({ rows: [], rowCount: 1 }));

    await sweepRetention(pool);
    const queriesAfterFirst = queries.length;
    expect(queriesAfterFirst).toBeGreaterThan(0); // sanity: the first call actually ran

    vi.setSystemTime(new Date("2026-01-03T00:05:00Z")); // +5 min, well inside the 1h window
    await sweepRetention(pool);

    expect(queries.length).toBe(queriesAfterFirst);
  });
});

describe("advanceTripStatusesAndComposePackets -- status transition + Phase 6 packet trigger", () => {
  it("passes BOOKEND_END_TRACKING_GRACE_MS as the transition's grace parameter, never an inline literal", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("update public.onlyevs_trips")) return { rows: [] };
      return undefined;
    });
    await advanceTripStatusesAndComposePackets(pool);
    const update = findQuery(queries, "update public.onlyevs_trips")!;
    expect(update.params).toEqual([BOOKEND_END_TRACKING_GRACE_MS]);
  });

  it("composes an evidence packet only for trips whose next_status is 'completed', never for 'active'/'armed'/'confirmed'", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("update public.onlyevs_trips")) {
        return {
          rows: [
            { id: "trip-completed", workspace_id: "ws-1", next_status: "completed" },
            { id: "trip-active", workspace_id: "ws-1", next_status: "active" },
          ],
        };
      }
      if (sql.includes("from public.onlyevs_trips\n    where workspace_id")) return { rows: [] }; // no trip found -> compose no-ops
      if (sql.startsWith("\n    select id, workspace_id, vehicle_id, guest_name")) return { rows: [] };
      return undefined;
    });

    await advanceTripStatusesAndComposePackets(pool);

    const tripLookups = queries.filter((q) => q.sql.includes("select id, workspace_id, vehicle_id, guest_name"));
    expect(tripLookups).toHaveLength(1);
    expect(tripLookups[0].params).toEqual(["ws-1", "trip-completed"]);
  });
});

describe("composeTripEvidencePacket -- Phase 6 immutable evidence packet (T9 worker half)", () => {
  const tripRow = {
    id: "trip-1",
    workspace_id: "ws-1",
    vehicle_id: "veh-1",
    guest_name: "Riley T.",
    shop_slug: "shop-1",
    starts_at: new Date("2026-08-15T10:00:00Z"),
    ends_at: new Date("2026-08-16T10:00:00Z"),
  };
  const startBookend = {
    edge: "start", odometer_mi: "1000.00", odometer_observed_at: new Date("2026-08-15T10:00:00Z"),
    battery_pct: "90.00", battery_observed_at: new Date("2026-08-15T10:00:00Z"), stale: false,
  };
  const endBookend = {
    edge: "end", odometer_mi: "1250.00", odometer_observed_at: new Date("2026-08-16T10:00:00Z"),
    battery_pct: "62.00", battery_observed_at: new Date("2026-08-16T10:00:00Z"), stale: false,
  };

  // `existingVersions` simulates rows already durable for this trip, so
  // "select coalesce(max(version),0)+1" and a second compose call can be
  // exercised without a real database -- state lives in a closure array
  // that the fake insert handler appends to, mirroring how the real
  // `unique(trip_id, version)` constraint would accumulate rows.
  // Default: no vehicle row at all -- no return-charge override, no home
  // area configured. Individual tests override this via a custom handler
  // to exercise the battery-policy / out-of-area paths.
  function makeComposeHandler(existingVersions: number[] = []) {
    const versions = [...existingVersions];
    return (sql: string, params: unknown[]) => {
      if (sql.includes("select id, workspace_id, vehicle_id, guest_name")) return { rows: [tripRow] };
      if (sql.includes("from private.onlyevs_trip_bookends")) return { rows: [startBookend, endBookend] };
      if (sql.includes("from public.onlyevs_vehicle_stats_history")) return { rows: [] };
      if (sql.includes("from public.onlyevs_vehicles")) return { rows: [] };
      if (sql.includes("from private.onlyevs_vehicle_location_points")) return { rows: [] };
      if (sql.includes("coalesce(max(version), 0) + 1")) {
        const nextVersion = versions.length ? Math.max(...versions) + 1 : 1;
        return { rows: [{ next_version: String(nextVersion) }] };
      }
      if (sql.includes("insert into public.onlyevs_trip_evidence_packets")) {
        const version = params[2] as number;
        versions.push(version);
        return { rows: [{ id: `packet-v${version}` }] };
      }
      if (sql.includes("insert into public.onlyevs_integration_audit_events")) return { rows: [] };
      return undefined;
    };
  }

  it("composes deltas from both bookends and never queries the sealed location table (no-coordinates invariant)", async () => {
    const { client, queries } = makeFakePool(makeComposeHandler());
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });

    const insert = findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!;
    expect(insert).toBeDefined();
    const payload = JSON.parse(insert.params[3] as string);
    expect(payload.milesDriven).toBe(250);
    expect(payload.batteryDeltaPct).toBe(-28);
    expect(payload.odometerRegression).toBe(false);
    expect(payload.chargingSessionsDerived).toBe(false);
    expect(payload.chargingSessions).toEqual([]);

    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toContain("latitude");
    expect(serialized).not.toContain("longitude");
    expect(queries.some((q) => q.sql.includes("onlyevs_vehicle_location_points"))).toBe(false);
  });

  it("first packet for a trip is version 1, insert-only: on conflict (trip_id, version) do nothing", async () => {
    const { client, queries } = makeFakePool(makeComposeHandler());
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    const insert = findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!;
    expect(insert.sql).toContain("on conflict (trip_id, version) do nothing");
    expect(insert.params[2]).toBe(1);
  });

  it("composition determinism: identical input data produces a byte-identical payload across two calls", async () => {
    const { client: clientA, queries: queriesA } = makeFakePool(makeComposeHandler());
    const { client: clientB, queries: queriesB } = makeFakePool(makeComposeHandler());
    await composeTripEvidencePacket(clientA, { id: "trip-1", workspaceId: "ws-1" });
    await composeTripEvidencePacket(clientB, { id: "trip-1", workspaceId: "ws-1" });
    const payloadA = findQuery(queriesA, "insert into public.onlyevs_trip_evidence_packets")!.params[3];
    const payloadB = findQuery(queriesB, "insert into public.onlyevs_trip_evidence_packets")!.params[3];
    expect(payloadA).toBe(payloadB);
  });

  // G4 supersede contract: composing a second time for the same trip never
  // mutates the first row -- it inserts a new row at version = previous
  // max + 1. This is also the plan's superseding-packet contract test:
  // "insert v1, supersede v2".
  it("supersede: composing twice for the same trip inserts version 1, then version 2 -- never a mutation", async () => {
    const { client, queries } = makeFakePool(makeComposeHandler());
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    const inserts = queries.filter((q) => q.sql.includes("insert into public.onlyevs_trip_evidence_packets"));
    expect(inserts).toHaveLength(2);
    expect(inserts[0]!.params[2]).toBe(1);
    expect(inserts[1]!.params[2]).toBe(2);
    for (const insert of inserts) {
      expect(insert.sql).toContain("on conflict (trip_id, version) do nothing");
      expect(insert.sql).not.toMatch(/\bupdate\b/i);
    }
  });

  it("records a delivery attempt (Inbox channel) for each newly composed version, entity_type='trip_evidence_packet'", async () => {
    const { client, queries } = makeFakePool(makeComposeHandler());
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    const deliveries = queries.filter((q) => q.sql.includes("insert into public.onlyevs_integration_audit_events"));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.sql).toContain("'trip_evidence_packet'");
    expect(deliveries[0]!.sql).toContain("'inbox_delivery'");
    const details = JSON.parse(deliveries[0]!.params[3] as string);
    expect(details).toEqual({ tripId: "trip-1", version: 1, channel: "owner_inbox" });
  });

  it("charging-session dependency (T10) not yet landed: degrades to an honest 'not yet derived' marker, never a fabricated empty result silently claiming zero charging", async () => {
    const { client, queries } = makeFakePool(makeComposeHandler());
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    expect(segmentChargeSessions).toHaveBeenCalled();
    const payload = JSON.parse(findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!.params[3] as string);
    expect(payload.chargingSessionsDerived).toBe(false);
  });

  it("start-only bookend (rollout straddle): renders an honest partial delta, never a guessed one", async () => {
    const { client, queries } = makeFakePool((sql, params) => {
      if (sql.includes("select id, workspace_id, vehicle_id, guest_name")) return { rows: [tripRow] };
      if (sql.includes("from private.onlyevs_trip_bookends")) return { rows: [startBookend] };
      if (sql.includes("from public.onlyevs_vehicle_stats_history")) return { rows: [] };
      if (sql.includes("coalesce(max(version), 0) + 1")) return { rows: [{ next_version: "1" }] };
      if (sql.includes("insert into public.onlyevs_trip_evidence_packets")) return { rows: [{ id: "packet-1" }] };
      if (sql.includes("insert into public.onlyevs_integration_audit_events")) return { rows: [] };
      void params;
      return undefined;
    });
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    const payload = JSON.parse(findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!.params[3] as string);
    expect(payload.milesDriven).toBeNull();
    expect(payload.bookends.end).toBeNull();
    expect(payload.bookends.start).not.toBeNull();
  });

  it("odometer regression: end < start renders the data-error state, never negative miles", async () => {
    const regressedEnd = { ...endBookend, odometer_mi: "900.00" };
    const { client, queries } = makeFakePool((sql) => {
      if (sql.includes("select id, workspace_id, vehicle_id, guest_name")) return { rows: [tripRow] };
      if (sql.includes("from private.onlyevs_trip_bookends")) return { rows: [startBookend, regressedEnd] };
      if (sql.includes("from public.onlyevs_vehicle_stats_history")) return { rows: [] };
      if (sql.includes("coalesce(max(version), 0) + 1")) return { rows: [{ next_version: "1" }] };
      if (sql.includes("insert into public.onlyevs_trip_evidence_packets")) return { rows: [{ id: "packet-1" }] };
      if (sql.includes("insert into public.onlyevs_integration_audit_events")) return { rows: [] };
      return undefined;
    });
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    const payload = JSON.parse(findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!.params[3] as string);
    expect(payload.odometerRegression).toBe(true);
    expect(payload.milesDriven).toBeNull();
  });

  it("no trip found: composes nothing, records no delivery", async () => {
    const { client, queries } = makeFakePool((sql) => {
      if (sql.includes("select id, workspace_id, vehicle_id, guest_name")) return { rows: [] };
      return undefined;
    });
    await composeTripEvidencePacket(client, { id: "trip-missing", workspaceId: "ws-1" });
    expect(queries.some((q) => q.sql.includes("insert into public.onlyevs_trip_evidence_packets"))).toBe(false);
    expect(queries.some((q) => q.sql.includes("insert into public.onlyevs_integration_audit_events"))).toBe(false);
  });

  it("includes vehicleId in the payload (t.vehicle_id, already fetched with the trip)", async () => {
    const { client, queries } = makeFakePool(makeComposeHandler());
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    const payload = JSON.parse(findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!.params[3] as string);
    expect(payload.vehicleId).toBe("veh-1");
  });

  it("miles-vs-allowance: always null -- no mileage-allowance data source exists anywhere in this codebase yet", async () => {
    const { client, queries } = makeFakePool(makeComposeHandler());
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    const payload = JSON.parse(findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!.params[3] as string);
    expect(payload.milesAllowance).toBeNull();
  });

  it("battery-vs-policy: resolves through the vehicle's own return-charge override, via resolveVehiclePolicyPct", async () => {
    const { client, queries } = makeFakePool((sql) => {
      if (sql.includes("select id, workspace_id, vehicle_id, guest_name")) return { rows: [tripRow] };
      if (sql.includes("from private.onlyevs_trip_bookends")) return { rows: [startBookend, endBookend] };
      if (sql.includes("from public.onlyevs_vehicle_stats_history")) return { rows: [] };
      if (sql.includes("from public.onlyevs_vehicles")) return { rows: [{ return_charge_level_pct: "70.00" }] };
      if (sql.includes("from private.onlyevs_vehicle_location_points")) return { rows: [] };
      if (sql.includes("coalesce(max(version), 0) + 1")) return { rows: [{ next_version: "1" }] };
      if (sql.includes("insert into public.onlyevs_trip_evidence_packets")) return { rows: [{ id: "packet-1" }] };
      if (sql.includes("insert into public.onlyevs_integration_audit_events")) return { rows: [] };
      return undefined;
    });
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    const payload = JSON.parse(findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!.params[3] as string);
    expect(payload.batteryPolicyPct).toBe(70);
  });

  it("battery-vs-policy: null when the vehicle carries no override -- the worker has no reachable fleet-wide fallback", async () => {
    const { client, queries } = makeFakePool((sql) => {
      if (sql.includes("select id, workspace_id, vehicle_id, guest_name")) return { rows: [tripRow] };
      if (sql.includes("from private.onlyevs_trip_bookends")) return { rows: [startBookend, endBookend] };
      if (sql.includes("from public.onlyevs_vehicle_stats_history")) return { rows: [] };
      if (sql.includes("from public.onlyevs_vehicles")) return { rows: [{ return_charge_level_pct: null }] };
      if (sql.includes("from private.onlyevs_vehicle_location_points")) return { rows: [] };
      if (sql.includes("coalesce(max(version), 0) + 1")) return { rows: [{ next_version: "1" }] };
      if (sql.includes("insert into public.onlyevs_trip_evidence_packets")) return { rows: [{ id: "packet-1" }] };
      if (sql.includes("insert into public.onlyevs_integration_audit_events")) return { rows: [] };
      return undefined;
    });
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    const payload = JSON.parse(findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!.params[3] as string);
    expect(payload.batteryPolicyPct).toBeNull();
  });

  it("out-of-area: null when the vehicle has no home area configured, and never queries the sealed location table", async () => {
    const { client, queries } = makeFakePool(makeComposeHandler());
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    const payload = JSON.parse(findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!.params[3] as string);
    expect(payload.outOfAreaOccurrences).toBeNull();
    expect(queries.some((q) => q.sql.includes("onlyevs_vehicle_location_points"))).toBe(false);
  });

  it("out-of-area: null when a home area is configured but no location observations exist for this trip", async () => {
    const { client, queries } = makeFakePool((sql) => {
      if (sql.includes("select id, workspace_id, vehicle_id, guest_name")) return { rows: [tripRow] };
      if (sql.includes("from private.onlyevs_trip_bookends")) return { rows: [startBookend, endBookend] };
      if (sql.includes("from public.onlyevs_vehicle_stats_history")) return { rows: [] };
      if (sql.includes("from public.onlyevs_vehicles")) {
        return { rows: [{ return_charge_level_pct: null, home_area_center_lat: "33.45", home_area_center_lng: "-111.94", home_area_radius_mi: "25" }] };
      }
      if (sql.includes("from private.onlyevs_vehicle_location_points")) return { rows: [] };
      if (sql.includes("coalesce(max(version), 0) + 1")) return { rows: [{ next_version: "1" }] };
      if (sql.includes("insert into public.onlyevs_trip_evidence_packets")) return { rows: [{ id: "packet-1" }] };
      if (sql.includes("insert into public.onlyevs_integration_audit_events")) return { rows: [] };
      return undefined;
    });
    await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
    const payload = JSON.parse(findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!.params[3] as string);
    expect(payload.outOfAreaOccurrences).toBeNull();
    expect(queries.some((q) => q.sql.includes("onlyevs_vehicle_location_points"))).toBe(true);
  });

  describe("out-of-area occurrence count: real decryption against a configured home area", () => {
    const HOME_LAT = 33.45;
    const HOME_LNG = -111.94;
    const HOME_RADIUS_MI = 25;
    const INSIDE_POINT = { latitude: 33.46, longitude: -111.95 }; // ~0.8mi from home
    const OUTSIDE_POINT = { latitude: 34.2, longitude: -112.6 }; // ~60mi+ from home

    function encryptPoint(point: { latitude: number; longitude: number }): string {
      return encryptCredential(JSON.stringify(point), credentialKeyringFromEnv(), {
        workspaceId: "ws-1",
        shopSlug: "shop-1",
        provider: "tesla",
        field: "location",
      }).ciphertext;
    }

    function makeHomeAreaHandler(locationRows: { coordinates_ciphertext: string }[]) {
      return (sql: string) => {
        if (sql.includes("select id, workspace_id, vehicle_id, guest_name")) return { rows: [tripRow] };
        if (sql.includes("from private.onlyevs_trip_bookends")) return { rows: [startBookend, endBookend] };
        if (sql.includes("from public.onlyevs_vehicle_stats_history")) return { rows: [] };
        if (sql.includes("from public.onlyevs_vehicles")) {
          return { rows: [{ return_charge_level_pct: null, home_area_center_lat: String(HOME_LAT), home_area_center_lng: String(HOME_LNG), home_area_radius_mi: String(HOME_RADIUS_MI) }] };
        }
        if (sql.includes("from private.onlyevs_vehicle_location_points")) return { rows: locationRows };
        if (sql.includes("coalesce(max(version), 0) + 1")) return { rows: [{ next_version: "1" }] };
        if (sql.includes("insert into public.onlyevs_trip_evidence_packets")) return { rows: [{ id: "packet-1" }] };
        if (sql.includes("insert into public.onlyevs_integration_audit_events")) return { rows: [] };
        return undefined;
      };
    }

    it("counts observations outside the home area, decrypting server-side, without ever leaking coordinates into the payload", async () => {
      const rows = [
        { coordinates_ciphertext: encryptPoint(INSIDE_POINT) },
        { coordinates_ciphertext: encryptPoint(INSIDE_POINT) },
        { coordinates_ciphertext: encryptPoint(OUTSIDE_POINT) },
      ];
      const { client, queries } = makeFakePool(makeHomeAreaHandler(rows));
      await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
      const insert = findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!;
      const payload = JSON.parse(insert.params[3] as string);
      expect(payload.outOfAreaOccurrences).toBe(1);

      // No-coordinates invariant (T9 gap closure): even though real
      // decryption happened above, the serialized payload never carries a
      // latitude/longitude -- only the derived count.
      const serialized = JSON.stringify(payload).toLowerCase();
      expect(serialized).not.toContain("latitude");
      expect(serialized).not.toContain("longitude");
      expect(serialized).not.toContain(String(INSIDE_POINT.latitude));
      expect(serialized).not.toContain(String(OUTSIDE_POINT.latitude));
    });

    it("all observations inside the home area: a real, checked zero -- not null", async () => {
      const rows = [{ coordinates_ciphertext: encryptPoint(INSIDE_POINT) }, { coordinates_ciphertext: encryptPoint(INSIDE_POINT) }];
      const { client, queries } = makeFakePool(makeHomeAreaHandler(rows));
      await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
      const payload = JSON.parse(findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!.params[3] as string);
      expect(payload.outOfAreaOccurrences).toBe(0);
    });

    it("a point that fails to decrypt (e.g. a rotated-out key version) forces the count to null, not a possibly-biased number -- and logs a warning", async () => {
      const rows = [
        { coordinates_ciphertext: "oev1.99.bad.bad.bad" }, // unknown key version -> decrypt failure
        { coordinates_ciphertext: encryptPoint(OUTSIDE_POINT) },
      ];
      const { client, queries } = makeFakePool(makeHomeAreaHandler(rows));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await composeTripEvidencePacket(client, { id: "trip-1", workspaceId: "ws-1" });
      const insert = findQuery(queries, "insert into public.onlyevs_trip_evidence_packets")!;
      expect(insert).toBeDefined(); // packet composition still completes
      const payload = JSON.parse(insert.params[3] as string);
      // A KEK mismatch / targeted corruption on even one row must never
      // silently bias the count toward zero while looking green -- the
      // whole occurrence count degrades to the honest "unknown" instead.
      expect(payload.outOfAreaOccurrences).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("trip-1"),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("1 of 2"),
      );
      // Never coordinates in the log.
      const warnedText = warnSpy.mock.calls.map((call) => String(call[0])).join(" ");
      expect(warnedText).not.toContain(String(OUTSIDE_POINT.latitude));
      expect(warnedText).not.toContain(String(OUTSIDE_POINT.longitude));
      warnSpy.mockRestore();
    });
  });
});
