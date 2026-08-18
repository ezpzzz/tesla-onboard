"use client";

/**
 * Client-side data access for the /owner/mail surface (T13/T14, design doc
 * alex-email-inbox-design-20260817-123909.md). Every function here calls a
 * hardened RPC from supabase/migrations/20260817140000_onlyevs_workspace_
 * mail.sql, 20260817160000_onlyevs_workspace_mail_read_rpcs.sql, or
 * 20260817170000_onlyevs_workspace_mail_crosslinks.sql -- never a direct
 * table read. Row shaping is pure and lives in components/owner/
 * mail-list-view.ts / mail-detail-view.ts; this module is the thin I/O
 * layer around them, mirroring lib/owner/email-inbox-repository.ts's split.
 *
 * Callers are expected to guard on `scope` being non-null before invoking
 * anything here (same discipline as vehicleWorkspaceScope/OwnerInbox.tsx) --
 * `vehicleWorkspaceScope()` already returns null for the demo-mode synthetic
 * workspace (its id isn't a UUID), so a caller that skips the Supabase call
 * whenever `scope` is null constructs zero Supabase clients in demo mode
 * without needing a separate SUPABASE_CONFIGURED check here.
 */

import { createClient } from "@/lib/supabase/client";
import type { VehicleWorkspaceScope } from "./vehicle-repository";
import {
  mapMailListRow,
  resolveLinkedFilterParam,
  type LinkedFilterValue,
  type MailListCursor,
  type MailListItem,
  type MailListRpcRow,
} from "@/components/owner/mail-list-view";
import type { MailPurgeScope, MailReadReceipt, MailTrustAuth } from "@/components/owner/mail-detail-view";

export interface MailListFilters {
  eventType: string | null;
  linked: LinkedFilterValue;
  unreadOnly: boolean;
}

export const MAIL_LIST_PAGE_SIZE = 50;

function client() {
  return createClient();
}

function rowsOf<T>(data: T | T[] | null): T[] {
  return Array.isArray(data) ? data : data ? [data] : [];
}

export interface MailListPage {
  items: MailListItem[];
  nextCursor: MailListCursor | null;
}

export async function fetchMailList(
  scope: VehicleWorkspaceScope,
  filters: MailListFilters,
  cursor?: MailListCursor,
  limit = MAIL_LIST_PAGE_SIZE,
): Promise<MailListPage> {
  const { data, error } = await client().rpc("list_onlyevs_email_messages", {
    p_workspace_id: scope.workspaceId,
    p_shop_slug: scope.shopSlug,
    p_event_type: filters.eventType,
    p_linked: resolveLinkedFilterParam(filters.linked),
    p_unread_only: filters.unreadOnly || null,
    p_before_sent_at: cursor ? new Date(cursor.sentAtMs).toISOString() : null,
    p_before_id: cursor?.id ?? null,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  const items = rowsOf(data as MailListRpcRow[] | null).map(mapMailListRow);
  const last = items.at(-1);
  return {
    items,
    nextCursor: items.length >= limit && last ? { sentAtMs: last.sentAtMs, id: last.id } : null,
  };
}

export interface MailSearchResult extends MailListItem {
  rank: number;
}

export async function searchMailMessages(
  scope: VehicleWorkspaceScope,
  query: string,
): Promise<MailSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const { data, error } = await client().rpc("search_onlyevs_email_messages", {
    p_workspace_id: scope.workspaceId,
    p_query: trimmed,
    p_shop_slug: scope.shopSlug,
    p_limit: 100,
  });
  if (error) throw new Error(error.message);
  return rowsOf(data as Array<MailListRpcRow & { rank: number }> | null).map((row) => ({
    ...mapMailListRow(row),
    rank: row.rank,
  }));
}

export async function fetchMailUnreadCount(scope: VehicleWorkspaceScope): Promise<number> {
  const { data, error } = await client().rpc("get_onlyevs_email_unread_count", {
    p_workspace_id: scope.workspaceId,
    p_shop_slug: scope.shopSlug,
  });
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : 0;
}

/** Single message by its own id -- the detail page's own header/cross-link/
 * purge-scope source of truth. Returns null on a missing/foreign id (the
 * RPC's honest empty-set convention) rather than throwing. */
export async function fetchMailMessage(
  scope: VehicleWorkspaceScope,
  messageId: string,
): Promise<MailListItem | null> {
  const { data, error } = await client().rpc("get_onlyevs_email_message", {
    p_workspace_id: scope.workspaceId,
    p_message_id: messageId,
  });
  if (error) throw new Error(error.message);
  const row = rowsOf(data as MailListRpcRow[] | null)[0];
  return row ? mapMailListRow(row) : null;
}

export async function fetchMailMessagesForCandidate(
  scope: VehicleWorkspaceScope,
  candidateId: string,
): Promise<MailListItem[]> {
  const { data, error } = await client().rpc("list_onlyevs_email_messages_for_candidate", {
    p_workspace_id: scope.workspaceId,
    p_candidate_id: candidateId,
    p_limit: 20,
  });
  if (error) throw new Error(error.message);
  return rowsOf(data as MailListRpcRow[] | null).map(mapMailListRow);
}

export async function fetchMailMessagesForTrip(
  scope: VehicleWorkspaceScope,
  tripId: string,
): Promise<MailListItem[]> {
  const { data, error } = await client().rpc("list_onlyevs_email_messages_for_trip", {
    p_workspace_id: scope.workspaceId,
    p_trip_id: tripId,
    p_limit: 50,
  });
  if (error) throw new Error(error.message);
  return rowsOf(data as MailListRpcRow[] | null).map(mapMailListRow);
}

export async function fetchMailMessageTrust(
  scope: VehicleWorkspaceScope,
  messageId: string,
): Promise<MailTrustAuth | null> {
  const { data, error } = await client().rpc("get_onlyevs_email_message_trust", {
    p_workspace_id: scope.workspaceId,
    p_message_id: messageId,
  });
  if (error) throw new Error(error.message);
  const row = rowsOf(
    data as Array<{ dkim_pass: boolean | null; spf_pass: boolean | null; dmarc_pass: boolean | null; from_domain_aligned: boolean | null }> | null,
  )[0];
  if (!row) return null;
  return {
    dkimPass: row.dkim_pass,
    spfPass: row.spf_pass,
    dmarcPass: row.dmarc_pass,
    fromDomainAligned: row.from_domain_aligned,
  };
}

export async function recordMailRead(scope: VehicleWorkspaceScope, messageId: string): Promise<void> {
  const { error } = await client().rpc("record_onlyevs_email_read", {
    p_workspace_id: scope.workspaceId,
    p_message_id: messageId,
  });
  if (error) throw new Error(error.message);
}

export async function fetchMailReadReceipts(
  scope: VehicleWorkspaceScope,
  messageId: string,
): Promise<MailReadReceipt[]> {
  const { data, error } = await client().rpc("get_onlyevs_email_read_receipts", {
    p_workspace_id: scope.workspaceId,
    p_message_id: messageId,
  });
  if (error) throw new Error(error.message);
  return rowsOf(data as Array<{ user_id: string; read_at: string }> | null).map((row) => ({
    userId: row.user_id,
    readAtMs: Date.parse(row.read_at),
  }));
}

/**
 * The reservation id a message's linked candidate carries, if any -- read
 * directly off onlyevs_email_candidates under the same manager-role RLS
 * InboxCandidateCard.tsx already relies on for proposed_state/
 * correction_facts, rather than adding a dedicated RPC for one scalar
 * column. Used only to decide whether reservation-scoped purge is offered
 * (deriveAvailablePurgeScopes in mail-detail-view.ts) -- never used for
 * authorization.
 */
export async function fetchCandidateReservationId(
  scope: VehicleWorkspaceScope,
  candidateId: string,
): Promise<string | null> {
  const { data, error } = await client()
    .from("onlyevs_email_candidates")
    .select("reservation_id")
    .eq("workspace_id", scope.workspaceId)
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.reservation_id as string | null) ?? null;
}

export interface MailPurgeResult {
  r2ObjectKeys: string[];
}

async function callPurgeRpc(fn: string, params: Record<string, unknown>): Promise<MailPurgeResult> {
  const { data, error } = await client().rpc(fn, params);
  if (error) throw new Error(error.message);
  const rows = rowsOf(data as Array<{ r2_object_key: string }> | null);
  return { r2ObjectKeys: rows.map((row) => row.r2_object_key) };
}

export async function purgeMail(
  scope: VehicleWorkspaceScope,
  purgeScope: MailPurgeScope,
  target: { inboundEmailId?: string; reservationId?: string; guestId?: string },
  reason?: string,
): Promise<MailPurgeResult> {
  if (purgeScope === "message") {
    if (!target.inboundEmailId) throw new Error("Missing message id for a message-scoped purge.");
    return callPurgeRpc("purge_onlyevs_email_message", {
      p_workspace_id: scope.workspaceId,
      p_inbound_email_id: target.inboundEmailId,
      p_reason: reason ?? null,
    });
  }
  if (purgeScope === "reservation") {
    if (!target.reservationId) throw new Error("Missing reservation id for a reservation-scoped purge.");
    return callPurgeRpc("purge_onlyevs_email_reservation", {
      p_workspace_id: scope.workspaceId,
      p_reservation_id: target.reservationId,
      p_reason: reason ?? null,
    });
  }
  if (!target.guestId) throw new Error("Missing guest id for a guest-scoped purge.");
  return callPurgeRpc("purge_onlyevs_email_guest", {
    p_workspace_id: scope.workspaceId,
    p_guest_id: target.guestId,
    p_reason: reason ?? null,
  });
}
