import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";

// Module-scope side effects in index.ts (Pool/keyring construction) need
// these before the dynamic import below -- see telemetry-removal-retry.test.ts's
// identical header comment.
process.env.ONLYEVS_WORKER_DATABASE_URL = "postgres://user:pass@localhost:5432/db";
process.env.ONLYEVS_TRIP_BINDING_HMAC_SECRET = "x".repeat(32);
process.env.ONLYEVS_DATA_ENCRYPTION_KEYS = "1:ycU65hn79R5/DsFzSz0g1gPVn6OR/N88nlWm7b5hQQc=";
process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = "https://proxy.example.com";
// Configured so the regression-pin / transient tests below reach the actual
// tesla.configure()/status() call instead of tripping over a *different*
// deployment-config error (telemetry_hostname_not_configured) first --
// those tests are pinning vehicle-specific / transient classification, not
// this one.
process.env.ONLYEVS_TELEMETRY_HOSTNAME = "telemetry.example.com";
process.env.ONLYEVS_TELEMETRY_PORT = "443";
process.env.ONLYEVS_TELEMETRY_CA_PEM = "-----BEGIN CERTIFICATE-----\nMIIBpretendcertdata\n-----END CERTIFICATE-----";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { processTelemetry, isDeploymentConfigTelemetryError } = await import("@/services/onlyevs-worker/index");
const { TELEMETRY_CONFIG_ERROR_RETRY_MS } = await import("@/lib/owner/telemetry-policy");
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

// Replays every captured onlyevs_telemetry_enrollments UPDATE against a
// simulated row and returns the resulting STATE (status, last_error_code,
// attempt_count, next_action_at) -- so the tests below assert what the row
// actually ends up looking like, never a raw SQL/param string. Asserting on
// SQL text alone is exactly how defect 1's dead code slipped through: the
// query text and params can look completely correct while the ONE thing
// that determines whether the row is ever reclaimed again
// (private.claim_onlyevs_due_telemetry's status filter, exercised for real
// in supabase/tests/onlyevs_telemetry_config_error_reclaim.pgtap.sql) is
// untouched by this file. This replay only needs to distinguish the three
// UPDATE shapes processTelemetry's catch block can produce for a
// non-removal-requested row that isn't the cap/tesla_integration_unavailable
// case -- see services/onlyevs-worker/index.ts's processTelemetry.
interface SimulatedEnrollmentState {
  status: string;
  last_error_code: string | null;
  attempt_count: number;
  next_action_at: Date;
}

function replayEnrollmentState(
  initial: SimulatedEnrollmentState,
  queries: QueryLogEntry[],
  now: number,
): SimulatedEnrollmentState {
  let state = { ...initial };
  for (const q of queries) {
    if (!q.sql.includes("update public.onlyevs_telemetry_enrollments")) continue;
    if (q.sql.includes("($4)::interval")) {
      // isDeploymentConfigTelemetryError branch (non-removal): status is a
      // literal 'error', last_error_code/interval come through as params.
      const code = q.params[2] as string;
      const intervalLiteral = q.params[3] as string;
      const ms = Number(String(intervalLiteral).split(" ")[0]);
      state = { ...state, status: "error", last_error_code: code, next_action_at: new Date(now + ms) };
    } else if (q.sql.includes("set status = 'removal_requested'") && q.sql.includes("attempt_count = attempt_count + 1")) {
      // isDeploymentConfigTelemetryError branch for a removal_requested row.
      const code = q.params[2] as string;
      state = {
        ...state,
        status: "removal_requested",
        attempt_count: state.attempt_count + 1,
        last_error_code: code,
        next_action_at: new Date(now + 5 * 60 * 1000),
      };
    } else if (q.sql.includes("set status = $3")) {
      // Generic reauth/retryable branch.
      const status = q.params[2] as string;
      const message = q.params[3] as string;
      const retriesSoon = status === "requested" || status === "pending_sync" || status === "removal_requested";
      state = {
        ...state,
        status,
        last_error_code: message,
        attempt_count: state.attempt_count + 1,
        next_action_at: new Date(now + (retriesSoon ? 5 * 60 * 1000 : 365 * 24 * 60 * 60 * 1000)),
      };
    }
  }
  return state;
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

// The pre-configure fleet_status() key probe (D2/D3) always runs before the
// FIRST configure() for a VIN and always consumes one fetch call against
// the region base -- every test below that reaches configure() must queue
// this response first, or a later mock meant for configure() gets consumed
// by the probe instead.
function keyProbeResponse(totalNumberOfKeys = 1) {
  return jsonResponse(200, { response: { vehicle_info: { [CONTEXT_ROW.vin]: { total_number_of_keys: totalNumberOfKeys } } } });
}

function baseHandler(overrides: Partial<Record<string, () => { rows: unknown[] } | undefined>> = {}) {
  return (sql: string) => {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("from public.onlyevs_telemetry_enrollments e")) {
      return overrides.context ? overrides.context() : { rows: [CONTEXT_ROW] };
    }
    if (sql.includes("update private.onlyevs_integration_credentials")) return { rows: [] };
    if (sql.includes("update public.onlyevs_telemetry_enrollments")) return { rows: [] };
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
    status: "requested",
    location_enabled: false,
    applied_config_hash: null,
    attempt_count: 3,
    ...overrides,
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("processTelemetry -- deployment-config telemetry errors (T: worker lane)", () => {
  it("telemetry_proxy_not_configured retries on the short config-error interval, not the 365-day vehicle park", async () => {
    const originalProxyUrl = process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL;
    process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = "";
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      // The pre-configure key probe (D2/D3) goes through the region base,
      // which has nothing to do with the missing proxy under test here.
      .mockResolvedValueOnce(keyProbeResponse());

    const now = Date.now();
    await processTelemetry(baseRow({ attempt_count: 3 }), pool);
    process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = originalProxyUrl;

    const result = replayEnrollmentState(
      { status: "requested", last_error_code: null, attempt_count: 3, next_action_at: new Date(0) },
      queries,
      now,
    );
    expect(result.status).toBe("error");
    expect(result.last_error_code).toBe("telemetry_proxy_not_configured");
    // Bounded around now + the short config-error interval -- nowhere near
    // the 365-day vehicle-permanent park.
    const expected = now + TELEMETRY_CONFIG_ERROR_RETRY_MS;
    expect(result.next_action_at.getTime()).toBeGreaterThanOrEqual(expected - 5_000);
    expect(result.next_action_at.getTime()).toBeLessThanOrEqual(expected + 5_000);
    expect(result.next_action_at.getTime()).toBeLessThan(now + 24 * 60 * 60 * 1000);
  });

  it("telemetry_proxy_not_configured does NOT increment attempt_count -- a deployment gap is not the vehicle failing", async () => {
    const originalProxyUrl = process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL;
    process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = "";
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(keyProbeResponse());

    const now = Date.now();
    await processTelemetry(baseRow({ attempt_count: 3 }), pool);
    process.env.ONLYEVS_TESLA_COMMAND_PROXY_URL = originalProxyUrl;

    const result = replayEnrollmentState(
      { status: "requested", last_error_code: null, attempt_count: 3, next_action_at: new Date(0) },
      queries,
      now,
    );
    expect(result.attempt_count).toBe(3);
  });

  it("regression pin: an unrecognized skip reason (telemetry_vehicle_skipped) fails SAFE -- long-but-finite retry under status 'error', never the 365-day 'unsupported' park, attempt_count NOT bumped", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(keyProbeResponse())
      .mockResolvedValueOnce(
        jsonResponse(200, { response: { skipped_vehicles: [CONTEXT_ROW.vin] } }),
      );

    const now = Date.now();
    await processTelemetry(baseRow({ status: "requested", applied_config_hash: null, attempt_count: 3 }), pool);

    // This code path doesn't match replayEnrollmentState's three known UPDATE
    // shapes (it's a fourth, dedicated branch -- same family as the
    // missing_key/unsupported_firmware branches covered directly in
    // telemetry-skip-reason-classification.test.ts), so assert against the
    // captured query directly rather than teaching the replay helper a shape
    // only this one test uses.
    const update = queries.find(
      (q) => q.sql.includes("update public.onlyevs_telemetry_enrollments") && q.sql.includes("last_error_code = 'telemetry_vehicle_skipped'"),
    );
    expect(update).toBeDefined();
    expect(update!.sql).toContain("status = 'error'");
    expect(update!.sql).not.toContain("attempt_count = attempt_count + 1");
    const intervalParam = update!.params.find((p) => typeof p === "string" && p.includes("milliseconds")) as string;
    const ms = Number(intervalParam.split(" ")[0]);
    expect(ms).toBeGreaterThan(24 * 60 * 60 * 1000);
    expect(ms).toBeLessThan(365 * 24 * 60 * 60 * 1000);
    void now;
  });

  it("regression pin: the genuinely-permanent unsupported_hardware skip reason still keeps the 365-day 'unsupported' park -- narrowing the unrecognized-reason case above must not weaken this one", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(keyProbeResponse())
      .mockResolvedValueOnce(
        jsonResponse(200, { response: { updated_vehicles: 0, skipped_vehicles: { [CONTEXT_ROW.vin]: "unsupported_hardware" } } }),
      );

    const now = Date.now();
    await processTelemetry(baseRow({ status: "requested", applied_config_hash: null, attempt_count: 3 }), pool);

    const result = replayEnrollmentState(
      { status: "requested", last_error_code: null, attempt_count: 3, next_action_at: new Date(0) },
      queries,
      now,
    );
    expect(result.status).toBe("unsupported");
    expect(result.last_error_code).toBe("telemetry_unsupported_hardware");
    expect(result.attempt_count).toBe(4);
    const expected = now + 365 * 24 * 60 * 60 * 1000;
    expect(result.next_action_at.getTime()).toBeGreaterThanOrEqual(expected - 5_000);
    expect(result.next_action_at.getTime()).toBeLessThanOrEqual(expected + 5_000);
  });

  it("regression pin: a transient/retryable error keeps the existing 5-minute retry and attempt_count bump", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockRejectedValueOnce(new Error("network down"));

    const now = Date.now();
    await processTelemetry(baseRow({ status: "requested", applied_config_hash: null, attempt_count: 3 }), pool);

    const result = replayEnrollmentState(
      { status: "requested", last_error_code: null, attempt_count: 3, next_action_at: new Date(0) },
      queries,
      now,
    );
    expect(result.status).toBe("requested");
    expect(result.attempt_count).toBe(4);
    const expected = now + 5 * 60 * 1000;
    expect(result.next_action_at.getTime()).toBeGreaterThanOrEqual(expected - 5_000);
    expect(result.next_action_at.getTime()).toBeLessThanOrEqual(expected + 5_000);
  });

  it("classification is centralized behind one predicate", () => {
    expect(isDeploymentConfigTelemetryError(new TeslaTelemetryError("telemetry_proxy_not_configured", 0, false, null))).toBe(true);
    // D4: after status()/remove() moved off the proxy onto region_base_url,
    // a missing/invalid region base is the same class of deployment gap.
    expect(isDeploymentConfigTelemetryError(new TeslaTelemetryError("telemetry_region_not_configured", 0, false, null))).toBe(true);
    expect(isDeploymentConfigTelemetryError(new TeslaTelemetryError("telemetry_vehicle_skipped", 422, false, null))).toBe(false);
    expect(isDeploymentConfigTelemetryError(new TeslaTelemetryError("tesla_telemetry_limit_reached", 409, true, null))).toBe(false);
    expect(isDeploymentConfigTelemetryError(new Error("plain error"))).toBe(false);
  });
});
