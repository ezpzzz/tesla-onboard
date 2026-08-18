import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";

// Module-scope side effects in index.ts (Pool/keyring construction) need
// these before the dynamic import below -- see telemetry-bookends.test.ts's
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

function baseHandler(overrides: Partial<Record<string, () => { rows: unknown[] } | undefined>> = {}) {
  return (sql: string) => {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("from public.onlyevs_telemetry_enrollments e")) {
      return overrides.context ? overrides.context() : { rows: [CONTEXT_ROW] };
    }
    if (sql.includes("update private.onlyevs_integration_credentials")) return { rows: [] };
    if (sql.includes("update public.onlyevs_telemetry_enrollments")) return { rows: [] };
    if (sql.includes("delete from public.onlyevs_telemetry_enrollments")) return { rows: [] };
    if (sql.includes("select count(*) from public.onlyevs_telemetry_enrollments")) {
      return overrides.remaining ? overrides.remaining() : { rows: [{ count: "0" }] };
    }
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

describe("processTelemetry -- removal retry cap (T: worker lane)", () => {
  it("below cap: a retryable removal failure stays removal_requested, increments attempt_count, pushes next_action_at", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      // proxy unreachable -> TeslaTelemetryError retryable=true
      .mockRejectedValueOnce(new Error("network down"));

    await processTelemetry(baseRow({ attempt_count: TELEMETRY_REMOVAL_MAX_ATTEMPTS - 2 }), pool);

    const update = findQuery(queries, "update public.onlyevs_telemetry_enrollments set status = $3");
    expect(update).toBeDefined();
    expect(update!.params[2]).toBe("removal_requested");
    expect(update!.sql).toContain("attempt_count = attempt_count + 1");
    expect(update!.sql).toContain("next_action_at = case when $3 in");

    expect(queries.some((q) => q.sql.includes("delete from public.onlyevs_telemetry_enrollments"))).toBe(false);
    expect(queries.some((q) => q.sql.includes("delete from private.onlyevs_integration_credentials"))).toBe(false);
  });

  it("at/above the cap: enrollment row is deleted, integration gets telemetry_removal_unconfirmed, and finishTeslaDisconnect completes it locally", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockRejectedValueOnce(new Error("network down"));

    await processTelemetry(baseRow({ attempt_count: TELEMETRY_REMOVAL_MAX_ATTEMPTS - 1 }), pool);

    const del = findQuery(queries, "delete from public.onlyevs_telemetry_enrollments");
    expect(del).toBeDefined();
    expect(del!.params).toEqual(["ws-1", "veh-1"]);

    const errUpdate = queries.find((q) =>
      q.sql.includes("update public.onlyevs_integrations") && q.sql.includes("telemetry_removal_unconfirmed"));
    expect(errUpdate).toBeDefined();

    const credDelete = findQuery(queries, "delete from private.onlyevs_integration_credentials");
    expect(credDelete).toBeDefined();
    expect(credDelete!.params).toEqual(["int-1"]);

    const statusUpdate = queries.find((q) =>
      q.sql.includes("update public.onlyevs_integrations") && q.sql.includes("status = 'disconnected'"));
    expect(statusUpdate).toBeDefined();

    // Never falls through to the generic error path's attempt_count bump.
    expect(queries.some((q) => q.sql.includes("attempt_count = attempt_count + 1"))).toBe(false);
  });

  it("never throws even when the Tesla command proxy is unreachable/unconfigured at the cap", async () => {
    const originalProxyUrl = process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL;
    process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = "";
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }));

    await expect(
      processTelemetry(baseRow({ attempt_count: TELEMETRY_REMOVAL_MAX_ATTEMPTS }), pool),
    ).resolves.toBeUndefined();

    expect(findQuery(queries, "delete from public.onlyevs_telemetry_enrollments")).toBeDefined();
    process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = originalProxyUrl;
  });
});
