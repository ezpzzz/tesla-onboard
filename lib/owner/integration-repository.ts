"use client";

import { createClient } from "@/lib/supabase/client";
import type { IntegrationProvider, IntegrationStatus } from "./access-types";
import type { VehicleWorkspaceScope } from "./vehicle-repository";

export interface OwnerIntegration {
  id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  accountLabel: string | null;
  grantedScopes: string[];
  selectedCalendarId: string | null;
  selectedCalendarTimezone: string | null;
  lastSyncAt: number | null;
  lastErrorCode: string | null;
  updatedAt: number;
}

interface IntegrationRow {
  id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  account_label: string | null;
  granted_scopes: string[] | null;
  selected_calendar_id: string | null;
  selected_calendar_timezone: string | null;
  last_sync_at: string | null;
  last_error_code: string | null;
  updated_at: string;
}

function fromRow(row: IntegrationRow): OwnerIntegration {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    accountLabel: row.account_label,
    grantedScopes: row.granted_scopes ?? [],
    selectedCalendarId: row.selected_calendar_id,
    selectedCalendarTimezone: row.selected_calendar_timezone,
    lastSyncAt: row.last_sync_at ? Date.parse(row.last_sync_at) : null,
    lastErrorCode: row.last_error_code,
    updatedAt: Date.parse(row.updated_at),
  };
}

export async function fetchOwnerIntegrations(
  scope: VehicleWorkspaceScope,
): Promise<OwnerIntegration[]> {
  const { data, error } = await createClient()
    .from("onlyevs_integrations")
    .select("id,provider,status,account_label,granted_scopes,selected_calendar_id,selected_calendar_timezone,last_sync_at,last_error_code,updated_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("shop_slug", scope.shopSlug)
    .order("provider");
  if (error) throw new Error(error.message);
  return ((data ?? []) as IntegrationRow[]).map(fromRow);
}

export async function disconnectOwnerIntegration(
  scope: VehicleWorkspaceScope,
  provider: IntegrationProvider,
): Promise<void> {
  const { error } = await createClient().rpc("disconnect_onlyevs_integration", {
    p_workspace_id: scope.workspaceId,
    p_shop_slug: scope.shopSlug,
    p_provider: provider,
  });
  if (error) {
    if (error.message.includes("active_access_grants")) {
      throw new Error("Revoke all active and scheduled Tesla access before disconnecting.");
    }
    throw new Error(error.message);
  }
}

/**
 * Manual recovery for an integration stuck in `disconnecting` because the
 * async worker claim loop that finishes teardown never picked it up (see
 * lib/owner/integration-recovery.ts). Deletes the stored credential and
 * telemetry enrollments and marks the integration `disconnected` in one
 * transaction, without confirming provider-side telemetry config removal --
 * offered only once deriveIntegrationRecovery reports the row as stale.
 */
export async function forceCompleteOwnerIntegrationDisconnect(
  scope: VehicleWorkspaceScope,
  provider: IntegrationProvider,
): Promise<void> {
  const { error } = await createClient().rpc("force_complete_onlyevs_integration_disconnect", {
    p_workspace_id: scope.workspaceId,
    p_shop_slug: scope.shopSlug,
    p_provider: provider,
  });
  if (error) {
    if (error.message.includes("integration_not_disconnecting")) {
      throw new Error("This connection is no longer stuck disconnecting. Refresh to see its current status.");
    }
    throw new Error(error.message);
  }
}
