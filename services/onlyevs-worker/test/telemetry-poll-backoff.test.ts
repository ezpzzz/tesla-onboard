import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";

// Module-scope side effects in index.ts (Pool/keyring construction) need
// these before the dynamic import below -- see telemetry-removal-retry.test.ts's
// identical header comment.
process.env.ONLYEVS_WORKER_DATABASE_URL = "postgres://user:pass@localhost:5432/db";
process.env.ONLYEVS_TRIP_BINDING_HMAC_SECRET = "x".repeat(32);
process.env.ONLYEVS_DATA_ENCRYPTION_KEYS = "1:ycU65hn79R5/DsFzSz0g1gPVn6OR/N88nlWm7b5hQQc=";
process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = "https://proxy.example.com";
process.env.ONLYEVS_TELEMETRY_HOSTNAME = "telemetry.example.com";
process.env.ONLYEVS_TELEMETRY_PORT = "443";
process.env.ONLYEVS_TELEMETRY_CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIBpretendcertdata\n-----END CERTIFICATE-----";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { processTelemetry } = await import("@/services/onlyevs-worker/index");
const { TELEMETRY_ACTIVE_POLL_INTERVAL_MS } = await import("@/lib/owner/telemetry-policy");
const { credentialKeyringFromEnv, encryptCredential } = await import("@/lib/owner/credential-envelope");

interface QueryLogEntry {
  sql: string;
  params: unknown[];
}

type QueryHandler = (sql: string, params: unknown[]) => { rows: unknown[] } | undefined;

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

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } as unknown as Headers,
    json: async () => body,
  } as Response;
}

const REFRESH_TOKEN_CIPHERTEXT = encryptCredential("real-refresh-token", credentialKeyringFromEnv(), {
  workspaceId: "ws-1",
  shopSlug: "shop-1",
  provider: "tesla",
  field: "refresh_token",
}).ciphertext;

const CONTEXT_ROW = {
  workspace_id: "ws-1",
  vehicle_id: "veh-1",
  integration_id: "int-1",
  vin: "5YJ3E1EA7KF000001",
  shop_slug: "shop-1",
  granted_scopes: [] as string[],
  region_base_url: "https://fleet-api.prd.na.vn.cloud.tesla.com",
  refresh_token_ciphertext: REFRESH_TOKEN_CIPHERTEXT,
};

function baseHandler() {
  return (sql: string) => {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("from public.onlyevs_telemetry_enrollments e")) return { rows: [CONTEXT_ROW] };
    // No pending guest access grant -- location stays disabled, keeping the
    // config hash stable across these tests.
    if (sql.includes("from public.onlyevs_access_grants g")) return { rows: [{ enabled: false }] };
    if (sql.includes("update public.onlyevs_telemetry_enrollments")) return { rows: [] };
    if (sql.includes("update public.onlyevs_integrations")) return { rows: [] };
    if (sql.includes("pg_advisory_unlock")) return { rows: [] };
    return undefined;
  };
}

// applied_config_hash MUST already match the live config for these tests --
// otherwise processTelemetry takes the configure() branch instead of the
// status() poll branch this file is about. A wrong/stale hash here is a
// silent way for this whole suite to test the wrong code path, so it is
// computed for real from the same inputs processTelemetry itself hashes,
// not copy-pasted.
async function currentConfigHash(): Promise<string> {
  const { createHash } = await import("node:crypto");
  const { telemetryConfiguration, telemetryDestinationFromEnv } = await import("@/lib/owner/tesla-telemetry-client");
  const config = telemetryConfiguration(telemetryDestinationFromEnv(), false);
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

async function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    workspace_id: "ws-1",
    vehicle_id: "veh-1",
    integration_id: "int-1",
    status: "pending_sync",
    location_enabled: false,
    applied_config_hash: await currentConfigHash(),
    attempt_count: 0,
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("processTelemetry -- status() poll cadence backs off once active (D1, T: worker lane)", () => {
  it("an enrollment that becomes 'active' schedules the long poll interval, not the 5-minute one", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { synced: true, limit_reached: false } }));

    const now = Date.now();
    await processTelemetry(await baseRow(), pool);

    const update = findQuery(queries, /update public\.onlyevs_telemetry_enrollments set status = \$3/);
    expect(update).toBeDefined();
    expect(update!.params[2]).toBe("active");
    expect(update!.sql).toContain("case when $3 = 'active'");

    // The interval is passed as a bound parameter (ms, converted via
    // ($N)::interval), not baked into the SQL text -- assert the resulting
    // scheduled time, not the query string.
    const intervalParam = update!.params.find((p) => typeof p === "string" && p.includes("milliseconds")) as string;
    const ms = Number(intervalParam.split(" ")[0]);
    expect(ms).toBe(TELEMETRY_ACTIVE_POLL_INTERVAL_MS);
    // Sanity: materially longer than 5 minutes, and matches the report's
    // 12-hour recommendation.
    expect(ms).toBeGreaterThan(5 * 60 * 1000);
    expect(ms).toBe(12 * 60 * 60 * 1000);
    void now;
  });

  it("a non-active enrollment (pending_sync) keeps the short 5-minute poll interval", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { synced: false, limit_reached: false } }));

    await processTelemetry(await baseRow(), pool);

    const update = findQuery(queries, /update public\.onlyevs_telemetry_enrollments set status = \$3/);
    expect(update).toBeDefined();
    expect(update!.params[2]).toBe("pending_sync");
    // Falls through the SQL CASE's else branch -- the short interval stays
    // a plain SQL literal, unchanged from before D1.
    expect(update!.sql).toContain("else now() + interval '5 minutes'");
  });

  it("the transition from non-active into 'active' flips to the long interval on that very same claim", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { synced: true, limit_reached: false } }));

    // Row arrives already 'pending_sync' (not yet active) -- this call is
    // the one that discovers synced=true and must schedule long, not short.
    await processTelemetry(await baseRow({ status: "pending_sync" }), pool);

    const update = findQuery(queries, /update public\.onlyevs_telemetry_enrollments set status = \$3/);
    expect(update!.params[2]).toBe("active");
    const intervalParam = update!.params.find((p) => typeof p === "string" && p.includes("milliseconds")) as string;
    expect(Number(intervalParam.split(" ")[0])).toBe(TELEMETRY_ACTIVE_POLL_INTERVAL_MS);
  });

  it("limit-reached (unsupported) still keeps the short interval, unchanged by D1", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { synced: true, limit_reached: true } }));

    await processTelemetry(await baseRow(), pool);

    const update = findQuery(queries, /update public\.onlyevs_telemetry_enrollments set status = \$3/);
    expect(update!.params[2]).toBe("unsupported");
    expect(update!.sql).toContain("else now() + interval '5 minutes'");
  });
});
