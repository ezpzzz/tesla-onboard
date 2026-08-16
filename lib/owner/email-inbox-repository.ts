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

export async function fetchOwnerInbox(scope: VehicleWorkspaceScope, snapshotAt = Date.now(), before?: OwnerInboxCursor): Promise<OwnerInboxPage> {
  const client = createClient();
  const ceiling = new Date(Math.min(snapshotAt, before?.occurredAt ?? snapshotAt)).toISOString();
  const [emails, calendars, archives] = await Promise.all([
    client.from("onlyevs_email_candidates").select("id,event_type,reservation_id,proposed_state,blocker_codes,state,occurred_at,revision").eq("workspace_id", scope.workspaceId).lte("occurred_at", ceiling).order("occurred_at", { ascending: false }).limit(100),
    client.from("onlyevs_calendar_candidates").select("id,summary,starts_at,status,change_kind,source_updated_at,revision").eq("workspace_id", scope.workspaceId).eq("shop_slug", scope.shopSlug).or(`source_updated_at.lte.${ceiling},and(source_updated_at.is.null,starts_at.lte.${ceiling})`).order("source_updated_at", { ascending: false }).limit(100),
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
  const ordered = [...emailItems, ...calendarItems]
    .sort((a, b) => b.occurredAt - a.occurredAt || a.source.localeCompare(b.source) || a.id.localeCompare(b.id))
    .filter((item) => !before || item.occurredAt < before.occurredAt || (item.occurredAt === before.occurredAt && (item.source > before.source || (item.source === before.source && item.id > before.id))));
  const items = ordered.slice(0, 50);
  const last = items.at(-1);
  return { items, hasMore: ordered.length > items.length, nextCursor: last ? { occurredAt: last.occurredAt, source: last.source, id: last.id } : null };
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
