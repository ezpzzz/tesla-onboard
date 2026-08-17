import { describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { Guest } from "@/lib/owner/types";
import type { GuestIdentityCandidateKey, GuestLinkingStore, GuestMergeAuditEvent } from "@/lib/owner/guest-linking";

// Module-scope side effects in index.ts (Pool/keyring construction) need
// these before the dynamic import below -- see telemetry-bookends.test.ts's
// identical header comment.
process.env.ONLYEVS_WORKER_DATABASE_URL = "postgres://user:pass@localhost:5432/db";
process.env.ONLYEVS_TRIP_BINDING_HMAC_SECRET = "x".repeat(32);
process.env.ONLYEVS_DATA_ENCRYPTION_KEYS = "1:ycU65hn79R5/DsFzSz0g1gPVn6OR/N88nlWm7b5hQQc=";

const { sweepGuestLinking } = await import("@/services/onlyevs-worker/index");
const { PgGuestLinkingStore } = await import("@/services/onlyevs-worker/guest-linking-store");

interface QueryLogEntry {
  sql: string;
  params: unknown[];
}
type QueryHandler = (sql: string, params: unknown[]) => { rows: unknown[] } | undefined;

// Same fake pg Pool/PoolClient convention as telemetry-bookends.test.ts.
function makeFakePool(handler: QueryHandler) {
  const queries: QueryLogEntry[] = [];
  const query = (async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    const result = handler(sql, params);
    return result ?? { rows: [], rowCount: 0 };
  }) as unknown as Pool["query"];
  const pool = { query } as unknown as Pool;
  return { pool, queries };
}

/** In-memory GuestLinkingStore, same shape as tests/guest-linking.test.ts's
 * fakeStore() -- used here to test sweepGuestLinking's wiring (candidate
 * selection + which keys it hands to linkTripToGuest) independent of a real
 * database. */
function fakeStore() {
  const guests = new Map<string, Guest>();
  const keyToGuest = new Map<string, string>();
  const tripGuest = new Map<string, string>();
  let nextId = 1;

  function keyOf(key: GuestIdentityCandidateKey): string {
    return `${key.keyType}:${key.keyValue}`;
  }

  const store: GuestLinkingStore = {
    async findGuestIdByKey(_workspaceId, key) {
      return keyToGuest.get(keyOf(key)) ?? null;
    },
    async createGuest(_workspaceId, displayName) {
      const guest: Guest = { id: `guest-${nextId++}`, displayName, createdAt: 0, updatedAt: 0 };
      guests.set(guest.id, guest);
      return guest;
    },
    async getGuest(_workspaceId, guestId) {
      const guest = guests.get(guestId);
      if (!guest) throw new Error(`missing guest ${guestId}`);
      return guest;
    },
    async attachKey(_workspaceId, guestId, key) {
      if (!keyToGuest.has(keyOf(key))) keyToGuest.set(keyOf(key), guestId);
    },
    async setTripGuest(_workspaceId, tripId, guestId) {
      tripGuest.set(tripId, guestId);
    },
    async listGuestTripIds() {
      return [];
    },
    async listGuestKeys() {
      return [];
    },
    async repointTripsToGuest() {},
    async repointKeysToGuest() {},
    async deleteGuest(_workspaceId, guestId) {
      guests.delete(guestId);
    },
    async recordMergeAudit(_event: GuestMergeAuditEvent) {
      return "audit-1";
    },
  };
  return { store, guests, tripGuest };
}

const SIXTY_FOUR_HEX = "a".repeat(64);
const SIXTY_FOUR_HEX_2 = "b".repeat(64);

describe("sweepGuestLinking -- Phase 7 auto-linking sweep (T11 worker half)", () => {
  it("links a trip with a verified email hash to a new guest, using the trip's guest_name as fallback display name", async () => {
    const { pool } = makeFakePool((sql) => {
      if (sql.includes("from public.onlyevs_trips t") && sql.includes("onlyevs_guest_bindings")) {
        return {
          rows: [
            { trip_id: "trip-1", workspace_id: "ws-1", guest_name: "Riley T.", verified_email_hash: SIXTY_FOUR_HEX, tesla_subject_hmac: null },
          ],
        };
      }
      return undefined;
    });
    const { store, guests, tripGuest } = fakeStore();

    await sweepGuestLinking(pool, store);

    expect(tripGuest.get("trip-1")).toBeDefined();
    const guestId = tripGuest.get("trip-1")!;
    expect(guests.get(guestId)?.displayName).toBe("Riley T.");
  });

  it("only ever queries trips with guest_id is null (never re-links an already-linked trip)", async () => {
    const { pool, queries } = makeFakePool(() => ({ rows: [] }));
    const { store } = fakeStore();
    await sweepGuestLinking(pool, store);
    const candidateQuery = queries.find((q) => q.sql.includes("onlyevs_guest_bindings"));
    expect(candidateQuery?.sql).toContain("t.guest_id is null");
  });

  it("skips a candidate trip whose binding carries neither key -- never a fabricated link", async () => {
    const { pool } = makeFakePool((sql) => {
      if (sql.includes("onlyevs_guest_bindings")) {
        return { rows: [{ trip_id: "trip-1", workspace_id: "ws-1", guest_name: "Riley T.", verified_email_hash: null, tesla_subject_hmac: null }] };
      }
      return undefined;
    });
    const { store, tripGuest } = fakeStore();
    await sweepGuestLinking(pool, store);
    expect(tripGuest.has("trip-1")).toBe(false);
  });

  it("exact-match only: two trips sharing the same verified_email_hash link to the same guest, never two guests", async () => {
    const { pool } = makeFakePool((sql) => {
      if (sql.includes("onlyevs_guest_bindings")) {
        return {
          rows: [
            { trip_id: "trip-1", workspace_id: "ws-1", guest_name: "Riley T.", verified_email_hash: SIXTY_FOUR_HEX, tesla_subject_hmac: null },
            { trip_id: "trip-2", workspace_id: "ws-1", guest_name: "Riley T.", verified_email_hash: SIXTY_FOUR_HEX, tesla_subject_hmac: null },
          ],
        };
      }
      return undefined;
    });
    const { store, tripGuest } = fakeStore();
    await sweepGuestLinking(pool, store);
    expect(tripGuest.get("trip-1")).toBe(tripGuest.get("trip-2"));
  });

  it("passes both keys to linking when a binding carries both email_hash and tesla_subject_hmac", async () => {
    const { pool } = makeFakePool((sql) => {
      if (sql.includes("onlyevs_guest_bindings")) {
        return {
          rows: [
            { trip_id: "trip-1", workspace_id: "ws-1", guest_name: "Riley T.", verified_email_hash: SIXTY_FOUR_HEX, tesla_subject_hmac: SIXTY_FOUR_HEX_2 },
          ],
        };
      }
      return undefined;
    });
    const { store } = fakeStore();
    let seenKeys: GuestIdentityCandidateKey[] = [];
    const spyStore: GuestLinkingStore = {
      ...store,
      async findGuestIdByKey(workspaceId, key) {
        seenKeys.push(key);
        return store.findGuestIdByKey(workspaceId, key);
      },
    };
    await sweepGuestLinking(pool, spyStore);
    expect(seenKeys.map((k) => k.keyType).sort()).toEqual(["email_hash", "tesla_subject_hmac"]);
  });
});

describe("PgGuestLinkingStore -- live SQL shape against the schema agent's Phase 7 tables", () => {
  it("findGuestIdByKey queries the exact-match unique index columns", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("from private.onlyevs_guest_identity_keys")) return { rows: [{ guest_id: "guest-1" }] };
      return undefined;
    });
    const store = new PgGuestLinkingStore(pool as unknown as PoolClient);
    const result = await store.findGuestIdByKey("ws-1", { keyType: "email_hash", keyValue: SIXTY_FOUR_HEX });
    expect(result).toBe("guest-1");
    const query = queries[0]!;
    expect(query.sql).toContain("where workspace_id = $1 and key_type = $2 and key_value = $3");
    expect(query.params).toEqual(["ws-1", "email_hash", SIXTY_FOUR_HEX]);
  });

  it("attachKey is idempotent: on conflict (workspace_id, key_type, key_value) do nothing", async () => {
    const { pool, queries } = makeFakePool(() => ({ rows: [] }));
    const store = new PgGuestLinkingStore(pool as unknown as PoolClient);
    await store.attachKey("ws-1", "guest-1", { keyType: "email_hash", keyValue: SIXTY_FOUR_HEX });
    expect(queries[0]!.sql).toContain("on conflict (workspace_id, key_type, key_value) do nothing");
  });

  it("repointTripsToGuest is a no-op query for an empty trip list (never an invalid `= any($2)` with no ids)", async () => {
    const { pool, queries } = makeFakePool(() => ({ rows: [] }));
    const store = new PgGuestLinkingStore(pool as unknown as PoolClient);
    await store.repointTripsToGuest("ws-1", [], "guest-1");
    expect(queries).toHaveLength(0);
  });

  it("repointTripsToGuest repoints via = any($2::uuid[])", async () => {
    const { pool, queries } = makeFakePool(() => ({ rows: [] }));
    const store = new PgGuestLinkingStore(pool as unknown as PoolClient);
    await store.repointTripsToGuest("ws-1", ["trip-1", "trip-2"], "guest-2");
    expect(queries[0]!.sql).toContain("id = any($2::uuid[])");
    expect(queries[0]!.params).toEqual(["ws-1", ["trip-1", "trip-2"], "guest-2"]);
  });

  it("recordMergeAudit inserts prior state as jsonb and returns the new audit row id", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("insert into private.onlyevs_guest_merge_audit")) return { rows: [{ id: "audit-1" }] };
      return undefined;
    });
    const store = new PgGuestLinkingStore(pool as unknown as PoolClient);
    const id = await store.recordMergeAudit({
      workspaceId: "ws-1",
      sourceGuestId: "guest-1",
      targetGuestId: "guest-2",
      actorUserId: "user-1",
      priorTripIds: ["trip-1"],
      priorKeys: [{ keyType: "email_hash", keyValue: SIXTY_FOUR_HEX }],
      mergedAt: 1_700_000_000_000,
    });
    expect(id).toBe("audit-1");
    const priorState = JSON.parse(queries[0]!.params[4] as string);
    expect(priorState).toEqual({ tripIds: ["trip-1"], keys: [{ keyType: "email_hash", keyValue: SIXTY_FOUR_HEX }] });
  });

  it("deleteGuest scopes the delete by workspace_id and id", async () => {
    const { pool, queries } = makeFakePool(() => ({ rows: [] }));
    const store = new PgGuestLinkingStore(pool as unknown as PoolClient);
    await store.deleteGuest("ws-1", "guest-1");
    expect(queries[0]!.sql).toContain("delete from public.onlyevs_guests where workspace_id = $1 and id = $2");
    expect(queries[0]!.params).toEqual(["ws-1", "guest-1"]);
  });
});
