"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOwnerTenant } from "./OwnerTenantProvider";
import { CalendarReviewQueue } from "./CalendarReviewQueue";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { vehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import { archiveInboxItem, dismissEmailInboxItem, fetchOwnerInbox, restoreInboxItem, type OwnerInboxCursor, type OwnerInboxItem } from "@/lib/owner/email-inbox-repository";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";
import { Badge, Button, Card, Segmented, cn } from "@/components/ui";
import { IconCalendar, IconMail } from "@/components/icons";
import Link from "next/link";

type Filter = "all" | "needs_action" | "archived";

export function OwnerInbox() {
  const { workspace } = useOwnerTenant();
  const { vehicles } = useOwnerData();
  const scope = useMemo(() => vehicleWorkspaceScope(workspace?.tenantRef), [workspace?.tenantRef]);
  const [items, setItems] = useState<OwnerInboxItem[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<OwnerInboxItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<OwnerInboxCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const snapshotAt = useRef(Date.now());
  const dialogRef = useRef<HTMLDialogElement>(null);
  const load = useCallback(async (append = false) => { if (!scope) { setLoading(false); return; } setLoading(true); try { if (!append) snapshotAt.current = Date.now(); const page = await fetchOwnerInbox(scope, snapshotAt.current, append ? cursor ?? undefined : undefined); setItems((current) => append ? [...current, ...page.items] : page.items); setCursor(page.nextCursor); setHasMore(page.hasMore); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Inbox could not be loaded."); } finally { setLoading(false); } }, [cursor, scope]);
  useEffect(() => { void load(false); }, [scope?.key]);
  const visible = items.filter((item) => filter === "archived" ? item.archived : filter === "needs_action" ? item.actionable && !item.archived : !item.archived);
  const urgent = items.filter((item) => item.actionable && !item.archived).slice(0, 50);
  function open(item: OwnerInboxItem) { setSelected((current) => current?.id === item.id ? null : item); if (window.matchMedia("(max-width: 767px)").matches) setTimeout(() => dialogRef.current?.showModal(), 0); }
  async function mutate(action: "dismiss" | "archive" | "restore", item: OwnerInboxItem) { if (!scope) return; setBusy(true); try { if (action === "dismiss") await dismissEmailInboxItem(scope, item); if (action === "archive") await archiveInboxItem(scope, item); if (action === "restore") await restoreInboxItem(scope, item); setSelected(null); dialogRef.current?.close(); setCursor(null); await load(false); } catch (cause) { setError(cause instanceof Error ? cause.message : "Inbox action failed."); } finally { setBusy(false); } }
  return <div className="space-y-5">
    {urgent.length ? <section className="rounded-lg border border-warn/30 bg-warn/[0.06] p-4" aria-label="Needs attention"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-ink">Needs attention</h2><p className="mt-1 text-sm text-muted">{urgent.length}{items.filter((item) => item.actionable && !item.archived).length > 50 ? "+" : ""} booking update{urgent.length === 1 ? "" : "s"} waiting for a decision.</p></div><Badge tone="warn">{urgent.length}</Badge></div></section> : null}
    <CalendarReviewQueue vehicles={vehicles} confirmationEnabled={ONLYEVS_OPERATIONS_ENABLED} />
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><h2 className="text-lg font-semibold">Activity</h2><Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "needs_action", label: "Needs action" }, { value: "archived", label: "Archived" }]} /></div>
    {error ? <div role="alert" className="rounded-md border border-danger/30 bg-white p-4 text-sm text-danger">{error}</div> : null}
    {loading && items.length === 0 ? <Card className="p-5 text-sm text-muted">Loading inbox…</Card> : visible.length === 0 ? <div className="space-y-3"><Card className="p-8 text-center"><h3 className="font-semibold">Nothing here yet</h3><p className="mt-2 text-sm text-muted">Forward a Turo test email or connect Google Calendar to begin.</p></Card>{hasMore ? <Button variant="secondary" className="w-full" disabled={loading} onClick={() => void load(true)}>Load older activity</Button> : null}</div> : <div className="space-y-3">{visible.map((item) => <InboxCard key={`${item.source}:${item.id}`} item={item} expanded={selected?.id === item.id} onOpen={() => open(item)} onMutate={mutate} busy={busy} />)}{hasMore ? <Button variant="secondary" className="w-full" disabled={loading} onClick={() => void load(true)}>{loading ? "Loading…" : "Load older activity"}</Button> : null}</div>}
    <dialog ref={dialogRef} onClose={() => setSelected(null)} className="m-0 mt-auto h-[88dvh] max-h-[88dvh] w-full max-w-none rounded-t-2xl border-0 bg-white p-0 backdrop:bg-black/40 md:hidden">{selected ? <div className="flex h-full flex-col"><div className="flex items-center justify-between border-b border-line p-4"><strong>Inbox detail</strong><button type="button" autoFocus onClick={() => dialogRef.current?.close()} className="min-h-11 rounded-md px-3 text-sm">Close</button></div><div className="min-h-0 flex-1 overflow-y-auto p-5"><InboxDetail item={selected} /></div><div className="border-t border-line bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"><InboxActions item={selected} onMutate={mutate} busy={busy} /></div></div> : null}</dialog>
  </div>;
}

function InboxCard({ item, expanded, onOpen, onMutate, busy }: { item: OwnerInboxItem; expanded: boolean; onOpen: () => void; onMutate: (action: "dismiss" | "archive" | "restore", item: OwnerInboxItem) => void; busy: boolean }) { const Icon = item.source === "turo_email" ? IconMail : IconCalendar; return <Card className={cn("overflow-hidden", item.actionable && "border-l-4 border-l-warn")}><button type="button" onClick={onOpen} aria-expanded={expanded} className="flex min-h-20 w-full items-start gap-3 p-4 text-left sm:p-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand"><Icon className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong className="line-clamp-2 text-sm sm:text-base">{item.title}</strong>{item.actionable ? <Badge tone="warn">Review</Badge> : null}</span><span className="mt-1 block text-sm text-muted">{item.detail} · {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(item.occurredAt)}</span></span></button>{expanded ? <div className="hidden border-t border-line p-5 md:block"><InboxDetail item={item} /><div className="mt-5"><InboxActions item={item} onMutate={onMutate} busy={busy} /></div></div> : null}</Card>; }
function InboxDetail({ item }: { item: OwnerInboxItem }) { return <div className="space-y-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{item.source === "turo_email" ? "Turo email" : "Google Calendar"}</p><h3 className="mt-2 text-xl font-semibold">{item.title}</h3><p className="mt-2 text-sm text-muted">{item.detail}</p></div><dl className="grid grid-cols-2 gap-3 rounded-md bg-surface p-4 text-sm"><div><dt className="text-muted">Status</dt><dd className="mt-1 font-medium capitalize">{item.state.replaceAll("_", " ")}</dd></div><div><dt className="text-muted">Event</dt><dd className="mt-1 font-medium capitalize">{item.eventType.replaceAll("_", " ")}</dd></div></dl>{item.blockerCodes.length ? <div className="rounded-md border border-line p-4 text-sm"><strong>Why review is required</strong><ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{item.blockerCodes.map((code) => <li key={code}>{code.replaceAll("_", " ")}</li>)}</ul></div> : null}</div>; }
function InboxActions({ item, onMutate, busy }: { item: OwnerInboxItem; onMutate: (action: "dismiss" | "archive" | "restore", item: OwnerInboxItem) => void; busy: boolean }) { return <div className="flex flex-col gap-2 sm:flex-row">{item.source === "turo_email" && item.actionable && item.eventType === "booking" ? <Link href="/owner#new-guest" className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white">Create trip manually</Link> : null}{item.source === "turo_email" && item.actionable ? <Button variant="secondary" disabled={busy} onClick={() => void onMutate("dismiss", item)}>Dismiss</Button> : null}{item.archived ? <Button variant="secondary" disabled={busy} onClick={() => void onMutate("restore", item)}>Restore</Button> : !item.actionable ? <Button variant="ghost" disabled={busy} onClick={() => void onMutate("archive", item)}>Archive</Button> : null}</div>; }
