"use client";

import { createClient } from "@/lib/supabase/client";
import type { VehicleWorkspaceScope } from "./vehicle-repository";

export interface OwnerInboxItem {
  id: string;
  source: "turo_email" | "google_calendar";
  occurredAt: number;
  title: string;
  detail: string;
  state: string;
  eventType: string;
  actionable: boolean;
  archived: boolean;
  archiveId: string | null;
  revision: number;
  blockerCodes: string[];
}

export interface OwnerInboxCursor { occurredAt: number; source: OwnerInboxItem["source"]; id: string }
export interface OwnerInboxPage { items: OwnerInboxItem[]; nextCursor: OwnerInboxCursor | null; hasMore: boolean }

/**
 * Per-source row cap for a single fetchOwnerInbox round. Deliberately well above
 * pageSize (50): each round fully re-queries both sources from the current cursor
 * (never resumes an existing offset), so this only needs to comfortably exceed one
 * page's worth of rows from a single dominant source to guarantee the merged
 * top-`pageSize` selection for that round is correct. Exported so a source with an
 * unusually deep single-round backlog can be tuned without touching call sites.
 */
export const INBOX_SOURCE_FETCH_LIMIT = 200;

/**
 * Pure scoping decision: given the integration rows resolved for a workspace+shop,
 * decide whether the email-candidates query should run at all, and if so, which
 * integration ids it must be scoped to. The tenant-security boundary is RLS
 * (`has_minimum_role(workspace_id, ..., 'manager')`), which is workspace-scoped, not
 * this function. This scoping exists to prevent within-workspace cross-shop
 * presentation bleed — a manager who already has workspace access seeing another
 * shop's email candidates in this view — by only passing through integration ids
 * that belong to the *active* shop's rows.
 */
export function resolveEmailIntegrationScope(
  integrationRows: Array<{ id: string }>,
): { shouldQuery: false; integrationIds: [] } | { shouldQuery: true; integrationIds: string[] } {
  const integrationIds = integrationRows.map((row) => row.id);
  if (integrationIds.length === 0) return { shouldQuery: false, integrationIds: [] };
  return { shouldQuery: true, integrationIds };
}

/**
 * Pure merge/sort/paginate step shared by fetchOwnerInbox: combines already-shaped
 * email + calendar items, sorts newest-first with a stable tiebreak, applies the
 * cursor exclusion, and slices to a page of `pageSize` returning the next cursor.
 */
export function paginateInboxItems(
  emailItems: OwnerInboxItem[],
  calendarItems: OwnerInboxItem[],
  before?: OwnerInboxCursor,
  pageSize = 50,
): OwnerInboxPage {
  const ordered = [...emailItems, ...calendarItems]
    .sort((a, b) => b.occurredAt - a.occurredAt || a.source.localeCompare(b.source) || a.id.localeCompare(b.id))
    .filter((item) => !before || item.occurredAt < before.occurredAt || (item.occurredAt === before.occurredAt && (item.source > before.source || (item.source === before.source && item.id > before.id))));
  const items = ordered.slice(0, pageSize);
  const last = items.at(-1);
  return { items, hasMore: ordered.length > items.length, nextCursor: last ? { occurredAt: last.occurredAt, source: last.source, id: last.id } : null };
}

export async function fetchOwnerInbox(scope: VehicleWorkspaceScope, snapshotAt = Date.now(), before?: OwnerInboxCursor): Promise<OwnerInboxPage> {
  const client = createClient();
  const ceiling = new Date(Math.min(snapshotAt, before?.occurredAt ?? snapshotAt)).toISOString();
  const integrations = await client.from("onlyevs_email_integrations").select("id").eq("workspace_id", scope.workspaceId).eq("shop_slug", scope.shopSlug);
  if (integrations.error) throw new Error(integrations.error.message);
  const emailScope = resolveEmailIntegrationScope(integrations.data ?? []);
  // Each source's query is pushed the exact cursor boundary (not just the date
  // floor) so a round that already showed items down to `before` never re-spends
  // its fetch budget re-fetching the boundary row itself, and a secondary `id`
  // order makes the LIMIT slice deterministic across rounds when many rows tie on
  // occurred_at — without either, a source with >INBOX_SOURCE_FETCH_LIMIT rows
  // tied at the same timestamp could keep returning the same arbitrary window and
  // never surface the rest. Cross-source ties are still resolved by
  // paginateInboxItems's post-filter, which is the authority for what's "before".
  let emailQuery = client.from("onlyevs_email_candidates").select("id,event_type,reservation_id,proposed_state,blocker_codes,state,occurred_at,revision").eq("workspace_id", scope.workspaceId).in("integration_id", emailScope.integrationIds);
  emailQuery = before?.source === "turo_email"
    ? emailQuery.or(`occurred_at.lt.${ceiling},and(occurred_at.eq.${ceiling},id.gt.${before.id})`)
    : emailQuery.lte("occurred_at", ceiling);
  let calendarQuery = client.from("onlyevs_calendar_candidates").select("id,summary,starts_at,status,change_kind,source_updated_at,revision").eq("workspace_id", scope.workspaceId).eq("shop_slug", scope.shopSlug);
  calendarQuery = before?.source === "google_calendar"
    ? calendarQuery.or(`source_updated_at.lt.${ceiling},and(source_updated_at.eq.${ceiling},id.gt.${before.id}),and(source_updated_at.is.null,starts_at.lt.${ceiling}),and(source_updated_at.is.null,starts_at.eq.${ceiling},id.gt.${before.id})`)
    : calendarQuery.or(`source_updated_at.lte.${ceiling},and(source_updated_at.is.null,starts_at.lte.${ceiling})`);
  const [emails, calendars, archives] = await Promise.all([
    emailScope.shouldQuery
      ? emailQuery.order("occurred_at", { ascending: false }).order("id", { ascending: true }).limit(INBOX_SOURCE_FETCH_LIMIT)
      : { data: [], error: null },
    calendarQuery.order("source_updated_at", { ascending: false }).order("id", { ascending: true }).limit(INBOX_SOURCE_FETCH_LIMIT),
    client.from("onlyevs_inbox_archives").select("id,email_candidate_id,calendar_candidate_id").eq("workspace_id", scope.workspaceId),
  ]);
  const error = emails.error ?? calendars.error ?? archives.error;
  if (error) throw new Error(error.message);
  const archivedEmail = new Map<string, string>();
  const archivedCalendar = new Map<string, string>();
  for (const archive of archives.data ?? []) {
    if (archive.email_candidate_id) archivedEmail.set(archive.email_candidate_id, archive.id);
    if (archive.calendar_candidate_id) archivedCalendar.set(archive.calendar_candidate_id, archive.id);
  }
  const emailItems: OwnerInboxItem[] = (emails.data ?? []).map((row) => {
    const proposed = row.proposed_state && typeof row.proposed_state === "object" ? row.proposed_state as Record<string, unknown> : {};
    const archiveId = archivedEmail.get(row.id) ?? null;
    return { id: row.id, source: "turo_email", occurredAt: Date.parse(row.occurred_at), title: typeof proposed.subject === "string" ? proposed.subject : `${String(row.event_type).replaceAll("_", " ")} from Turo`, detail: row.reservation_id ? `Reservation ${row.reservation_id}` : "Turo email", state: row.state, eventType: row.event_type, actionable: ["pending","needs_review"].includes(row.state), archived: Boolean(archiveId), archiveId, revision: row.revision, blockerCodes: row.blocker_codes ?? [] };
  });
  const calendarItems: OwnerInboxItem[] = (calendars.data ?? []).map((row) => {
    const archiveId = archivedCalendar.get(row.id) ?? null;
    return { id: row.id, source: "google_calendar", occurredAt: Date.parse(row.source_updated_at ?? row.starts_at), title: row.summary, detail: new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(Date.parse(row.starts_at)), state: row.status, eventType: row.change_kind ?? "calendar_event", actionable: ["pending","needs_review"].includes(row.status), archived: Boolean(archiveId), archiveId, revision: row.revision, blockerCodes: [] };
  });
  return paginateInboxItems(emailItems, calendarItems, before);
}

export async function dismissEmailInboxItem(scope: VehicleWorkspaceScope, item: OwnerInboxItem) {
  const { error } = await createClient().rpc("dismiss_onlyevs_email_candidate", { p_workspace_id: scope.workspaceId, p_candidate_id: item.id, p_expected_revision: item.revision });
  if (error) throw new Error(error.message);
}
export async function archiveInboxItem(scope: VehicleWorkspaceScope, item: OwnerInboxItem) {
  const { error } = await createClient().rpc("archive_onlyevs_inbox_item", { p_workspace_id: scope.workspaceId, p_email_candidate_id: item.source === "turo_email" ? item.id : null, p_calendar_candidate_id: item.source === "google_calendar" ? item.id : null });
  if (error) throw new Error(error.message);
}
export async function restoreInboxItem(scope: VehicleWorkspaceScope, item: OwnerInboxItem) {
  if (!item.archiveId) return;
  const { error } = await createClient().rpc("restore_onlyevs_inbox_item", { p_archive_id: item.archiveId, p_workspace_id: scope.workspaceId });
  if (error) throw new Error(error.message);
}
