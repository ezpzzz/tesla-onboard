import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";

// Module-scope side effects in index.ts (Pool/keyring construction) need
// these before the dynamic import below -- see telemetry-bookends.test.ts's
// identical header comment.
process.env.ONLYEVS_WORKER_DATABASE_URL = "postgres://user:pass@localhost:5432/db";
process.env.ONLYEVS_TRIP_BINDING_HMAC_SECRET = "x".repeat(32);
process.env.ONLYEVS_DATA_ENCRYPTION_KEYS = "1:ycU65hn79R5/DsFzSz0g1gPVn6OR/N88nlWm7b5hQQc=";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const { syncChargingInvoices } = await import("@/services/onlyevs-worker/index");
const { credentialKeyringFromEnv, encryptCredential } = await import("@/lib/owner/credential-envelope");

// A real envelope (not a placeholder string) -- refreshTeslaToken decrypts
// this for real via decryptCredential, so it must round-trip against the
// same ONLYEVS_DATA_ENCRYPTION_KEYS set above.
const REFRESH_TOKEN_CIPHERTEXT = encryptCredential("real-refresh-token", credentialKeyringFromEnv(), {
  workspaceId: "ws-1",
  shopSlug: "shop-1",
  provider: "tesla",
  field: "refresh_token",
}).ciphertext;

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

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const CONTEXT_ROW = {
  workspace_id: "ws-1",
  shop_slug: "shop-1",
  integration_id: "int-1",
  region_base_url: "https://fleet-api.prd.na.vn.cloud.tesla.com",
  refresh_token_ciphertext: REFRESH_TOKEN_CIPHERTEXT,
};

function baseHandler(overrides: Partial<Record<string, () => { rows: unknown[] } | undefined>> = {}) {
  return (sql: string) => {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("from public.onlyevs_integrations i") && sql.includes("region_base_url")) {
      return overrides.context ? overrides.context() : { rows: [CONTEXT_ROW] };
    }
    if (sql.includes("from public.onlyevs_vehicles")) {
      return overrides.vehicles ? overrides.vehicles() : { rows: [{ id: "veh-1", vin: "5YJ3E1EA7KF000001" }] };
    }
    if (sql.includes("update public.onlyevs_integrations")) return { rows: [] };
    if (sql.includes("insert into public.onlyevs_charging_invoices")) return { rows: [] };
    if (sql.includes("pg_advisory_unlock")) return { rows: [] };
    return undefined;
  };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("syncChargingInvoices -- charging-invoice sync job (T10)", () => {
  it("syncs invoices for each active vehicle and upserts idempotently on (workspace_id, provider_invoice_id)", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    // refreshTeslaToken uses a real fetch too -- mock its response first,
    // then the charging-history call.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "rt", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, {
        response: [{
          id: "inv-1",
          vin: "5YJ3E1EA7KF000001",
          chargeStartDateTime: "2026-08-15T10:00:00Z",
          chargeStopDateTime: "2026-08-15T10:45:00Z",
          energyAdded: 22.5,
          totalDue: 8.1,
        }],
      }));

    await syncChargingInvoices(pool, { id: "int-1" });

    const insert = findQuery(queries, "insert into public.onlyevs_charging_invoices");
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("on conflict (workspace_id, provider_invoice_id) do update set");
    expect(insert!.params).toEqual([
      "ws-1", "veh-1", "inv-1",
      new Date(Date.parse("2026-08-15T10:00:00Z")),
      new Date(Date.parse("2026-08-15T10:45:00Z")),
      22.5, 8.1,
    ]);

    const reschedule = findQuery(queries, "update public.onlyevs_integrations")!;
    expect(reschedule.sql).toContain("next_sync_at = now() + make_interval");
    expect(reschedule.sql).toContain("last_error_code = null");
  });

  it("skips a vehicle whose charging-history call 404s/500s without aborting the rest of the sync, and logs the failed vehicle/status", async () => {
    const { pool, queries } = makeFakePool(baseHandler({
      vehicles: () => ({ rows: [{ id: "veh-1", vin: "VIN1" }, { id: "veh-2", vin: "VIN2" }] }),
    }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "rt", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, {
        response: [{ id: "inv-2", vin: "VIN2", chargeStartDateTime: "2026-08-16T00:00:00Z", energyAdded: 5, cost: 2 }],
      }));

    await syncChargingInvoices(pool, { id: "int-1" });

    const inserts = queries.filter((q) => q.sql.includes("insert into public.onlyevs_charging_invoices"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[1]).toBe("veh-2");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("veh-1"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("500"),
    );
    warnSpy.mockRestore();
  });

  it("a 401 from the charging-history endpoint marks the integration reauth_required and stops the sync", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "rt", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(401, {}));

    await syncChargingInvoices(pool, { id: "int-1" });

    const statusUpdate = findQuery(queries, "set status = 'reauth_required'");
    expect(statusUpdate).toBeDefined();
    expect(queries.some((q) => q.sql.includes("insert into public.onlyevs_charging_invoices"))).toBe(false);
  });

  it("an integration with no vehicle_charging_cmds-eligible context (missing/disconnected) reschedules far out and writes nothing", async () => {
    const { pool, queries } = makeFakePool(baseHandler({ context: () => ({ rows: [] }) }));

    await syncChargingInvoices(pool, { id: "int-1" });

    expect(queries.some((q) => q.sql.includes("insert into public.onlyevs_charging_invoices"))).toBe(false);
    const reschedule = findQuery(queries, "tesla_integration_unavailable");
    expect(reschedule).toBeDefined();
  });

  it("a busy (already-locked) integration reschedules for a short retry instead of proceeding", async () => {
    const { pool, queries } = makeFakePool((sql) => {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: false }] };
      if (sql.includes("update public.onlyevs_integrations")) return { rows: [] };
      return undefined;
    });

    await syncChargingInvoices(pool, { id: "int-1" });

    expect(fetchMock).not.toHaveBeenCalled();
    const reschedule = findQuery(queries, "tesla_integration_busy");
    expect(reschedule).toBeDefined();
  });

  it("drops rows the tolerant parser can't map to a complete invoice, never fabricating one", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "rt", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, { response: [{ vin: "5YJ3E1EA7KF000001" }] }));

    await syncChargingInvoices(pool, { id: "int-1" });

    expect(queries.some((q) => q.sql.includes("insert into public.onlyevs_charging_invoices"))).toBe(false);
  });

  it("drops a present-but-mismatched invoice.vin instead of trusting request-URL scoping alone, and logs the drop count", async () => {
    const { pool, queries } = makeFakePool(baseHandler());
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok", refresh_token: "rt", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, {
        response: [
          { id: "inv-1", vin: "5YJ3E1EA7KF000001", chargeStartDateTime: "2026-08-15T10:00:00Z", energyAdded: 22.5, totalDue: 8.1 },
          { id: "inv-2", vin: "SOMEOTHERVEHICLEVIN", chargeStartDateTime: "2026-08-15T11:00:00Z", energyAdded: 5, totalDue: 2 },
        ],
      }));

    await syncChargingInvoices(pool, { id: "int-1" });

    const inserts = queries.filter((q) => q.sql.includes("insert into public.onlyevs_charging_invoices"));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params[2]).toBe("inv-1");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dropped 1 charging invoice"));
    warnSpy.mockRestore();
  });
});
