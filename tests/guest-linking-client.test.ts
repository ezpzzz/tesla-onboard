import { describe, expect, it, vi } from "vitest";

/**
 * Wired merge-flow coverage (T11/G7 last sub-item): the browser-side
 * counterpart to lib/owner/guest-linking.ts's mergeGuests(), which calls the
 * hardened `merge_onlyevs_guests` RPC (the migration's Phase 7 section)
 * instead of a GuestLinkingStore, since the browser never holds the
 * onlyevs_worker role. This asserts the RPC call shape (name + param names,
 * matching the migration's `p_workspace_id`/`p_source_guest_id`/
 * `p_target_guest_id` signature) and both the success and honest-failure
 * mappings.
 */

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc }),
}));

// SUPABASE_CONFIGURED (lib/owner/guest-linking-client.ts) is a module-scope
// const evaluated once at import, mirroring the pattern in
// OwnerTenantProvider.tsx / use-owner-data.ts / cost-rate-setting.tsx -- so
// these must be stubbed before the dynamic import below, not in beforeEach.
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-key");

const { mergeGuestsViaRpc } = await import("@/lib/owner/guest-linking-client");

const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const SOURCE = "00000000-0000-4000-8000-000000000002";
const TARGET = "00000000-0000-4000-8000-000000000003";

describe("mergeGuestsViaRpc", () => {
  it("calls merge_onlyevs_guests with the exact param shape the migration's RPC expects", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        {
          target_guest_id: TARGET,
          target_display_name: "Sam K.",
          target_created_at: "2026-08-01T00:00:00Z",
          target_updated_at: "2026-08-17T00:00:00Z",
          trips_moved: 4,
          keys_moved: 2,
          audit_event_id: "audit-1",
        },
      ],
      error: null,
    });

    const result = await mergeGuestsViaRpc({ workspaceId: WORKSPACE }, SOURCE, TARGET);

    expect(rpc).toHaveBeenCalledWith("merge_onlyevs_guests", {
      p_workspace_id: WORKSPACE,
      p_source_guest_id: SOURCE,
      p_target_guest_id: TARGET,
    });
    expect(result).toEqual({
      targetGuest: {
        id: TARGET,
        displayName: "Sam K.",
        createdAt: Date.parse("2026-08-01T00:00:00Z"),
        updatedAt: Date.parse("2026-08-17T00:00:00Z"),
      },
      tripsMoved: 4,
      keysMoved: 2,
      auditEventId: "audit-1",
    });
  });

  it("throws on an RPC error — never a silent no-op success", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "workspace_manager_required" } });
    await expect(mergeGuestsViaRpc({ workspaceId: WORKSPACE }, SOURCE, TARGET)).rejects.toThrow(
      "workspace_manager_required",
    );
  });

  it("throws when the RPC returns no row, rather than fabricating a result", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(mergeGuestsViaRpc({ workspaceId: WORKSPACE }, SOURCE, TARGET)).rejects.toThrow();
  });
});
