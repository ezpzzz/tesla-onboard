import { describe, expect, it, vi } from "vitest";

interface FakeResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

let selectedColumns: string | null = null;
let rpcCalls: { fn: string; params: Record<string, unknown> }[] = [];
let rpcResult: FakeResult = { data: null, error: null };
let queryResult: FakeResult = { data: [], error: null };

function resetFakes() {
  selectedColumns = null;
  rpcCalls = [];
  rpcResult = { data: null, error: null };
  queryResult = { data: [], error: null };
}

function makeQueryBuilder() {
  const builder = {
    select: (columns: string) => {
      selectedColumns = columns;
      return builder;
    },
    eq: () => builder,
    order: () => Promise.resolve(queryResult),
  };
  return builder;
}

const fakeClient = {
  from: () => makeQueryBuilder(),
  rpc: (fn: string, params: Record<string, unknown>) => {
    rpcCalls.push({ fn, params });
    return Promise.resolve(rpcResult);
  },
};

vi.mock("@/lib/supabase/client", () => ({ createClient: () => fakeClient }));

const {
  fetchOwnerIntegrations,
  disconnectOwnerIntegration,
  forceCompleteOwnerIntegrationDisconnect,
} = await import("@/lib/owner/integration-repository");

const SCOPE = { workspaceId: "ws-1", shopSlug: "shop-1", key: "ws-1~shop-1" };

describe("fetchOwnerIntegrations", () => {
  it("selects updated_at (drift pin: the recovery UX needs it to derive staleness)", async () => {
    resetFakes();
    queryResult = { data: [], error: null };
    await fetchOwnerIntegrations(SCOPE);
    expect(selectedColumns).toContain("updated_at");
  });

  it("maps updated_at into the OwnerIntegration record's updatedAt field", async () => {
    resetFakes();
    queryResult = {
      data: [{
        id: "int-1", provider: "tesla", status: "disconnecting",
        account_label: null, granted_scopes: [], selected_calendar_id: null,
        selected_calendar_timezone: null, last_sync_at: null, last_error_code: null,
        updated_at: "2026-08-18T10:00:00Z",
      }],
      error: null,
    };
    const [integration] = await fetchOwnerIntegrations(SCOPE);
    expect(integration.updatedAt).toBe(Date.parse("2026-08-18T10:00:00Z"));
  });
});

describe("forceCompleteOwnerIntegrationDisconnect", () => {
  it("calls the exact RPC name and params (drift pin)", async () => {
    resetFakes();
    rpcResult = { data: "disconnected", error: null };
    await forceCompleteOwnerIntegrationDisconnect(SCOPE, "tesla");
    expect(rpcCalls).toEqual([{
      fn: "force_complete_onlyevs_integration_disconnect",
      params: { p_workspace_id: "ws-1", p_shop_slug: "shop-1", p_provider: "tesla" },
    }]);
  });

  it("maps the integration_not_disconnecting error to an honest, non-technical message", async () => {
    resetFakes();
    rpcResult = { data: null, error: { message: "integration_not_disconnecting" } };
    await expect(forceCompleteOwnerIntegrationDisconnect(SCOPE, "tesla")).rejects.toThrow(
      /disconnecting/i,
    );
  });

  it("does not swallow an unrelated RPC error behind the friendly mapping", async () => {
    resetFakes();
    rpcResult = { data: null, error: { message: "workspace_admin_required" } };
    await expect(forceCompleteOwnerIntegrationDisconnect(SCOPE, "tesla")).rejects.toThrow(
      "workspace_admin_required",
    );
  });

  it("resolves without throwing on success", async () => {
    resetFakes();
    rpcResult = { data: "disconnected", error: null };
    await expect(forceCompleteOwnerIntegrationDisconnect(SCOPE, "tesla")).resolves.toBeUndefined();
  });
});

describe("disconnectOwnerIntegration (existing behavior, unchanged)", () => {
  it("still calls disconnect_onlyevs_integration with the same params shape", async () => {
    resetFakes();
    rpcResult = { data: null, error: null };
    await disconnectOwnerIntegration(SCOPE, "tesla");
    expect(rpcCalls).toEqual([{
      fn: "disconnect_onlyevs_integration",
      params: { p_workspace_id: "ws-1", p_shop_slug: "shop-1", p_provider: "tesla" },
    }]);
  });
});
