import { createClient } from "@/lib/supabase/client";
import type { Guest } from "./types";
import type { MergeGuestsResult } from "./guest-linking";

/**
 * Browser-side counterpart to lib/owner/guest-linking.ts's mergeGuests()
 * (Phase 7 merge tool's apply half, T11).
 *
 * mergeGuests() there is a pure orchestrator that runs a GuestLinkingStore
 * (the exact-key lookup / repoint / audit / delete sequence) against a live
 * `pg` Pool -- but that store can only be constructed where the
 * onlyevs_worker Postgres role runs (services/onlyevs-worker), never in the
 * browser (see that module's header comment). The browser instead calls
 * `merge_onlyevs_guests`, a hardened SECURITY DEFINER RPC
 * (the migration's Phase 7 section) that performs the identical sequence --
 * manager-membership check first, repoint trips + identity keys, record the
 * prior-state audit row, delete the source guest -- as one atomic,
 * server-side statement. Re-deriving that same sequence here as several
 * separate authenticated requests would both duplicate business logic
 * already enforced in SQL and lose the atomicity the RPC gives it, so this
 * function is intentionally a single `.rpc()` call, not a second
 * GuestLinkingStore implementation.
 */

interface MergeGuestsRpcRow {
  target_guest_id: string;
  target_display_name: string;
  target_created_at: string;
  target_updated_at: string;
  trips_moved: number;
  keys_moved: number;
  audit_event_id: string;
}

export interface MergeGuestsClientScope {
  workspaceId: string;
}

function mapRow(row: MergeGuestsRpcRow): MergeGuestsResult {
  const targetGuest: Guest = {
    id: row.target_guest_id,
    displayName: row.target_display_name,
    createdAt: new Date(row.target_created_at).getTime(),
    updatedAt: new Date(row.target_updated_at).getTime(),
  };
  return {
    targetGuest,
    tripsMoved: Number(row.trips_moved),
    keysMoved: Number(row.keys_moved),
    auditEventId: row.audit_event_id,
  };
}

/** Throws on any failure (RPC error, or the RPC returning no row) -- callers
 * render an honest merge-failed state rather than assume success. Never
 * silently no-ops. */
export async function mergeGuestsViaRpc(
  scope: MergeGuestsClientScope,
  sourceGuestId: string,
  targetGuestId: string,
): Promise<MergeGuestsResult> {
  const { data, error } = await createClient().rpc("merge_onlyevs_guests", {
    p_workspace_id: scope.workspaceId,
    p_source_guest_id: sourceGuestId,
    p_target_guest_id: targetGuestId,
  });
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as MergeGuestsRpcRow | undefined;
  if (!row) throw new Error("merge_onlyevs_guests returned no row.");
  return mapRow(row);
}
