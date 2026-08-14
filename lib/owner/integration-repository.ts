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
