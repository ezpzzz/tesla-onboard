import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";

// Module-scope side effects in index.ts (Pool/keyring construction) need
// these before the dynamic import below -- see telemetry-removal-retry.test.ts's
// identical header comment.
process.env.ONLYEVS_WORKER_DATABASE_URL = "postgres://user:pass@localhost:5432/db";
process.env.ONLYEVS_TRIP_BINDING_HMAC_SECRET = "x".repeat(32);
process.env.ONLYEVS_DATA_ENCRYPTION_KEYS = "1:ycU65hn79R5/DsFzSz0g1gPVn6OR/N88nlWm7b5hQQc=";
process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = "https://proxy.example.com";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { processTelemetry } = await import("@/services/onlyevs-worker/index");
const { TELEMETRY_REMOVAL_MAX_ATTEMPTS } = await import("@/lib/owner/telemetry-policy");
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
  refresh_token_ciphertext: REFRESH_TOKEN_CIPHERTEXT,
};

function baseHandler() {
  return (sql: string) => {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("from public.onlyevs_telemetry_enrollments e")) return { rows: [CONTEXT_ROW] };
    if (sql.includes("update private.onlyevs_integration_credentials")) return { rows: [] };
    if (sql.includes("update public.onlyevs_telemetry_enrollments")) return { rows: [] };
    if (sql.includes("delete from public.onlyevs_telemetry_enrollments")) return { rows: [] };
    if (sql.includes("select count(*) from public.onlyevs_telemetry_enrollments")) return { rows: [{ count: "0" }] };
    if (sql.includes("delete from private.onlyevs_integration_credentials")) return { rows: [] };
    if (sql.includes("update public.onlyevs_integrations")) return { rows: [] };
    if (sql.includes("pg_advisory_unlock")) return { rows: [] };
    return undefined;
  };
}

function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    workspace_id: "ws-1",
    vehicle_id: "veh-1",
    integration_id: "int-1",
    status: "removal_requested",
    location_enabled: false,
    applied_config_hash: null,
    attempt_count: 0,
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("processTelemetry -- removal_requested must survive an unconfigured deployment (defect 4, T: worker lane)", () => {
  it("below the removal cap: a deployment-config error (telemetry_proxy_not_configured) keeps status='removal_requested', never demotes it to 'error'", async () => {
    const originalProxyUrl = process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL;
    process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = "";
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }),
    );

    await processTelemetry(baseRow({ attempt_count: TELEMETRY_REMOVAL_MAX_ATTEMPTS - 2 }), pool);
    process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = originalProxyUrl;

    // The row must never be written as a plain 'error' row -- that is
    // exactly the marker-loss bug (stranded 'disconnecting' integration,
    // v0.10.1's failure class reintroduced at the enrollment level).
    const wrongUpdate = findQuery(queries, "update public.onlyevs_telemetry_enrollments set status = 'error'");
    expect(wrongUpdate).toBeUndefined();

    const update = findQuery(queries, /update public\.onlyevs_telemetry_enrollments set status = /);
    expect(update).toBeDefined();
    expect(update!.sql).toContain("status = 'removal_requested'");
    expect(update!.params).toContain("telemetry_proxy_not_configured");
    expect(update!.sql).toContain("attempt_count = attempt_count + 1");

    // Must not have been deleted / disconnected -- the row survives to
    // retry, it did not hit the exhaustion cap.
    expect(queries.some((q) => q.sql.includes("delete from public.onlyevs_telemetry_enrollments"))).toBe(false);
    expect(queries.some((q) =>
      q.sql.includes("update public.onlyevs_integrations") && q.sql.includes("status = 'disconnected'"),
    )).toBe(false);
  });

  it("at/above the removal cap: a deployment-config error still reaches the existing cap-driven local-completion path (removal_requested is never lost before the cap can act on it)", async () => {
    const originalProxyUrl = process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL;
    process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = "";
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }),
    );

    await processTelemetry(baseRow({ attempt_count: TELEMETRY_REMOVAL_MAX_ATTEMPTS - 1 }), pool);
    process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = originalProxyUrl;

    const del = findQuery(queries, "delete from public.onlyevs_telemetry_enrollments");
    expect(del).toBeDefined();
    expect(del!.params).toEqual(["ws-1", "veh-1"]);

    const statusUpdate = queries.find((q) =>
      q.sql.includes("update public.onlyevs_integrations") && q.sql.includes("status = 'disconnected'"));
    expect(statusUpdate).toBeDefined();

    const unconfirmed = queries.find((q) =>
      q.sql.includes("update public.onlyevs_integrations") && q.sql.includes("telemetry_removal_unconfirmed"));
    expect(unconfirmed).toBeDefined();

    // Never written as a plain 'error' row on the way to the cap either.
    expect(queries.some((q) => q.sql.includes("update public.onlyevs_telemetry_enrollments set status = 'error'"))).toBe(false);
  });
});
