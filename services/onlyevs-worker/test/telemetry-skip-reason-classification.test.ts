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

const {
  processTelemetry,
  isMissingKeyTelemetryError,
  isUnsupportedFirmwareTelemetryError,
  isMaxConfigsTelemetryError,
} = await import("@/services/onlyevs-worker/index");
const {
  TELEMETRY_MISSING_KEY_RETRY_MS,
  TELEMETRY_UNSUPPORTED_FIRMWARE_RETRY_MS,
} = await import("@/lib/owner/telemetry-policy");
const { credentialKeyringFromEnv, encryptCredential } = await import("@/lib/owner/credential-envelope");
const { TeslaTelemetryError } = await import("@/lib/owner/tesla-telemetry-client");

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
    if (sql.includes("from public.onlyevs_access_grants g")) return { rows: [{ enabled: false }] };
    if (sql.includes("update public.onlyevs_telemetry_enrollments")) return { rows: [] };
    if (sql.includes("update public.onlyevs_integrations")) return { rows: [] };
    if (sql.includes("pg_advisory_unlock")) return { rows: [] };
    return undefined;
  };
}

// A brand-new enrollment: applied_config_hash === null forces the
// configure() branch (never the status() poll branch) on every call below,
// which is what all of these skip-reason scenarios flow through.
function baseRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    workspace_id: "ws-1",
    vehicle_id: "veh-1",
    integration_id: "int-1",
    status: "requested",
    location_enabled: false,
    applied_config_hash: null,
    attempt_count: 0,
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("processTelemetry -- per-VIN skip-reason classification (D2, T: worker lane)", () => {
  it("missing_key: status stays 'error' (never 'unsupported'), hours-scale retry, attempt_count NOT bumped (self-healing)", async () => {
    const now = Date.now();
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      // fleetStatus() probe: at least one key present, so configure() is
      // still attempted (and is what actually reports missing_key here).
      .mockResolvedValueOnce(jsonResponse(200, { response: { vehicle_info: { [CONTEXT_ROW.vin]: { total_number_of_keys: 1 } } } }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { updated_vehicles: 0, skipped_vehicles: { [CONTEXT_ROW.vin]: "missing_key" } } }));

    await processTelemetry(baseRow({ attempt_count: 3 }), pool);

    const update = findQuery(queries, "last_error_code = 'telemetry_missing_key'");
    expect(update).toBeDefined();
    expect(update!.sql).toContain("status = 'error'");
    expect(update!.sql).not.toContain("attempt_count = attempt_count + 1");

    const intervalParam = update!.params.find((p) => typeof p === "string" && p.includes("milliseconds")) as string;
    const ms = Number(intervalParam.split(" ")[0]);
    expect(ms).toBe(TELEMETRY_MISSING_KEY_RETRY_MS);
    expect(now + ms).toBeLessThan(now + 24 * 60 * 60 * 1000);
  });

  it("the pre-configure fleet_status probe detects zero keys and skips configure() entirely -- no billed, rejected command", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { vehicle_info: { [CONTEXT_ROW.vin]: { total_number_of_keys: 0 } } } }));
    // No third mock queued -- configure() must never be called, so nothing
    // should try to consume a third fetch response.

    await processTelemetry(baseRow(), pool);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const configureCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("fleet_telemetry_config") && call[1]?.method === "POST");
    expect(configureCall).toBeUndefined();

    const update = findQuery(queries, "last_error_code = 'telemetry_missing_key'");
    expect(update).toBeDefined();
    expect(update!.sql).toContain("status = 'error'");
  });

  it("a reconfigure (applied_config_hash already set) does NOT re-probe fleet_status -- only the first configure() for a VIN does", async () => {
    const { pool } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { updated_vehicles: 1 } }));

    await processTelemetry(baseRow({ applied_config_hash: "stale-hash-not-matching-current-config" }), pool);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fleetStatusCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("fleet_status"));
    expect(fleetStatusCall).toBeUndefined();
  });

  it("unsupported_hardware: keeps the existing 365-day permanent park under status 'unsupported'", async () => {
    const now = Date.now();
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { vehicle_info: { [CONTEXT_ROW.vin]: { total_number_of_keys: 1 } } } }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { updated_vehicles: 0, skipped_vehicles: { [CONTEXT_ROW.vin]: "unsupported_hardware" } } }));

    await processTelemetry(baseRow({ attempt_count: 3 }), pool);

    const update = findQuery(queries, /update public\.onlyevs_telemetry_enrollments set status = \$3/);
    expect(update).toBeDefined();
    expect(update!.params[2]).toBe("unsupported");
    expect(update!.params[3]).toBe("telemetry_unsupported_hardware");
    expect(update!.sql).toContain("else now() + interval '365 days'");
    void now;
  });

  it("unsupported_firmware: long backoff but explicitly NOT the 365-day park, status stays 'error'", async () => {
    const now = Date.now();
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { vehicle_info: { [CONTEXT_ROW.vin]: { total_number_of_keys: 1 } } } }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { updated_vehicles: 0, skipped_vehicles: { [CONTEXT_ROW.vin]: "unsupported_firmware" } } }));

    await processTelemetry(baseRow({ attempt_count: 3 }), pool);

    const update = findQuery(queries, "last_error_code = 'telemetry_unsupported_firmware'");
    expect(update).toBeDefined();
    expect(update!.sql).toContain("status = 'error'");
    const intervalParam = update!.params.find((p) => typeof p === "string" && p.includes("milliseconds")) as string;
    const ms = Number(intervalParam.split(" ")[0]);
    expect(ms).toBe(TELEMETRY_UNSUPPORTED_FIRMWARE_RETRY_MS);
    expect(ms).toBeLessThan(365 * 24 * 60 * 60 * 1000);
    expect(ms).toBeGreaterThan(24 * 60 * 60 * 1000);
    void now;
  });

  it("max_configs: reuses the existing limit-reached UI state ('unsupported' + tesla_telemetry_limit_reached)", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { vehicle_info: { [CONTEXT_ROW.vin]: { total_number_of_keys: 1 } } } }))
      .mockResolvedValueOnce(jsonResponse(200, { response: { updated_vehicles: 0, skipped_vehicles: { [CONTEXT_ROW.vin]: "max_configs" } } }));

    await processTelemetry(baseRow({ attempt_count: 3 }), pool);

    const update = findQuery(queries, "last_error_code = 'tesla_telemetry_limit_reached'");
    expect(update).toBeDefined();
    expect(update!.sql).toContain("status = 'unsupported'");
  });

  it("classification predicates are centralized and match exactly one code each", () => {
    expect(isMissingKeyTelemetryError(new TeslaTelemetryError("telemetry_missing_key", 422, false, null))).toBe(true);
    expect(isUnsupportedFirmwareTelemetryError(new TeslaTelemetryError("telemetry_unsupported_firmware", 422, false, null))).toBe(true);
    expect(isMaxConfigsTelemetryError(new TeslaTelemetryError("telemetry_max_configs", 422, false, null))).toBe(true);
    expect(isMissingKeyTelemetryError(new TeslaTelemetryError("telemetry_unsupported_hardware", 422, false, null))).toBe(false);
    expect(isUnsupportedFirmwareTelemetryError(new TeslaTelemetryError("telemetry_max_configs", 422, false, null))).toBe(false);
    expect(isMaxConfigsTelemetryError(new TeslaTelemetryError("telemetry_missing_key", 422, false, null))).toBe(false);
  });
});
