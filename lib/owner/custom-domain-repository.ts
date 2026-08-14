"use client";

import { createClient } from "@/lib/supabase/client";
import {
  normalizeCustomHostname,
  normalizeVerificationRecords,
  type CustomDomainStatus,
  type WorkspaceCustomDomain,
} from "@/lib/custom-domain";
import type { VehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";

interface DomainRow {
  id: string;
  workspace_id: string;
  shop_slug: string;
  hostname: string;
  status: CustomDomainStatus;
  verification: unknown;
  last_error_code: string | null;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DomainRow): WorkspaceCustomDomain {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    shopSlug: row.shop_slug,
    hostname: row.hostname,
    status: row.status,
    verification: normalizeVerificationRecords(row.verification),
    lastErrorCode: row.last_error_code,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function fetchWorkspaceDomains(scope: VehicleWorkspaceScope): Promise<WorkspaceCustomDomain[]> {
  const { data, error } = await createClient()
    .from("onlyevs_custom_domains")
    .select("id,workspace_id,shop_slug,hostname,status,verification,last_error_code,last_checked_at,created_at,updated_at")
    .eq("workspace_id", scope.workspaceId)
    .eq("shop_slug", scope.shopSlug)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as DomainRow[]).map(mapRow);
}

export async function requestWorkspaceDomain(scope: VehicleWorkspaceScope, value: string): Promise<WorkspaceCustomDomain> {
  const hostname = normalizeCustomHostname(value);
  const { data, error } = await createClient()
    .rpc("request_onlyevs_custom_domain", {
      p_workspace_id: scope.workspaceId,
      p_shop_slug: scope.shopSlug,
      p_hostname: hostname,
    });
  if (error) {
    if (error.code === "23505") throw new Error("That hostname is already connected to an evhost.app workspace.");
    throw new Error(error.message);
  }
  return mapRow(data as DomainRow);
}

export async function requestWorkspaceDomainRemoval(domain: WorkspaceCustomDomain): Promise<void> {
  const { error } = await createClient()
    .rpc("request_onlyevs_custom_domain_removal", {
      p_domain_id: domain.id,
      p_workspace_id: domain.workspaceId,
    });
  if (error) throw new Error(error.message);
}
