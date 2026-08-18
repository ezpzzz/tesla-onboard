"use client";

/**
 * /owner/mail list surface (T13, design doc
 * alex-email-inbox-design-20260817-123909.md, Implementation Approach step
 * 5). Cursor-paginated by default; a `?candidateId=`/`?tripId=` query param
 * (set by InboxCandidateCard.tsx's "View full email" link and the trip
 * detail page's cross-link) switches into a filtered, non-paginated view of
 * exactly that candidate's/trip's messages instead. Search runs a separate
 * RPC and replaces the list with its own (also non-paginated, server-capped)
 * results while a query is active.
 *
 * Demo-mode / pre-rollout honesty: `scope` is null whenever Supabase isn't
 * configured (vehicleWorkspaceScope's UUID check rejects the synthetic demo
 * workspace id) -- every fetch below is gated on `scope` being present, so
 * demo mode constructs zero Supabase clients, exactly OwnerInbox.tsx's own
 * convention. A configured workspace with no captured mail yet (pre-rollout)
 * reaches the same empty state through a real, empty RPC response.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useOwnerTenant } from "./OwnerTenantProvider";
import { vehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import {
  fetchMailList,
  fetchMailMessagesForCandidate,
  fetchMailMessagesForTrip,
  searchMailMessages,
  type MailListFilters,
} from "@/lib/owner/mail-repository";
import {
  deriveMailLinkChip,
  formatMailListDate,
  formatMailSender,
  shouldShowMailItem,
  type LinkedFilterValue,
  type MailListCursor,
  type MailListItem,
} from "./mail-list-view";
import { Badge, Button, Card, cn } from "@/components/ui";
import { EmptyState } from "./owner-ui";
import { IconDownload } from "@/components/icons";

const EVENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All types" },
  { value: "booking", label: "Booking" },
  { value: "change", label: "Trip change" },
  { value: "cancellation", label: "Cancellation" },
  { value: "guest_message", label: "Guest message" },
  { value: "unknown", label: "Uncategorized" },
];

type Mode = { kind: "list" } | { kind: "candidate"; id: string } | { kind: "trip"; id: string };

function useMailMode(): Mode {
  const searchParams = useSearchParams();
  const candidateId = searchParams.get("candidateId");
  const tripId = searchParams.get("tripId");
  if (candidateId) return { kind: "candidate", id: candidateId };
  if (tripId) return { kind: "trip", id: tripId };
  return { kind: "list" };
}

export function OwnerMailList() {
  const { workspace } = useOwnerTenant();
  const scope = useMemo(() => vehicleWorkspaceScope(workspace?.tenantRef), [workspace?.tenantRef]);
  const mode = useMailMode();
  // Stable string key for the effect/callback deps below -- avoids an inline
  // conditional expression appearing directly in a dependency array.
  const crossLinkKey = mode.kind === "list" ? null : `${mode.kind}:${mode.id}`;

  const [items, setItems] = useState<MailListItem[]>([]);
  const [cursor, setCursor] = useState<MailListCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [eventType, setEventType] = useState("");
  const [linked, setLinked] = useState<LinkedFilterValue>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [allMail, setAllMail] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");

  const filters: MailListFilters = useMemo(
    () => ({ eventType: eventType || null, linked, unreadOnly }),
    [eventType, linked, unreadOnly],
  );

  const load = useCallback(async (append: boolean) => {
    if (!scope) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      if (mode.kind === "candidate") {
        const results = await fetchMailMessagesForCandidate(scope, mode.id);
        setItems(results);
        setHasMore(false);
        setCursor(null);
        return;
      }
      if (mode.kind === "trip") {
        const results = await fetchMailMessagesForTrip(scope, mode.id);
        setItems(results);
        setHasMore(false);
        setCursor(null);
        return;
      }
      if (activeSearch) {
        const results = await searchMailMessages(scope, activeSearch);
        setItems(results);
        setHasMore(false);
        setCursor(null);
        return;
      }
      const page = await fetchMailList(scope, filters, append ? cursor ?? undefined : undefined);
      setItems((current) => (append ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setHasMore(page.nextCursor !== null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mail couldn't be loaded.");
    } finally {
      setLoading(false);
    }
  }, [cursor, scope, mode.kind, crossLinkKey, activeSearch, filters]);

  // `load` intentionally excluded -- this effect fires on scope/mode/search/
  // filter changes only, never merely because `load`'s identity changed when
  // `cursor` advanced (matching OwnerInbox.tsx's own load-effect split).
  useEffect(() => { void load(false); }, [scope?.key, crossLinkKey, activeSearch, filters]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setActiveSearch(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput("");
    setActiveSearch("");
  }

  const visible = mode.kind === "list" && !activeSearch
    ? items.filter((item) => shouldShowMailItem(item, allMail))
    : items;

  return (
    <div className="space-y-4">
      {mode.kind !== "list" ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-3 text-sm">
          <span className="text-ink-soft">
            Showing mail linked to this {mode.kind === "candidate" ? "booking update" : "trip"}.
          </span>
          <Link href="/owner/mail" className="font-semibold text-brand hover:underline">
            Clear filter
          </Link>
        </div>
      ) : (
        <Card className="space-y-3 p-4">
          <form onSubmit={submitSearch} className="flex flex-col gap-2 sm:flex-row">
            <label htmlFor="mail-search" className="sr-only">Search mail</label>
            <input
              id="mail-search"
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search subject and message text…"
              className="field"
            />
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" disabled={!searchInput.trim()}>Search</Button>
              {activeSearch ? <Button type="button" variant="ghost" onClick={clearSearch}>Clear</Button> : null}
            </div>
          </form>
          {!activeSearch ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter by event type"
                value={eventType}
                onChange={(event) => setEventType(event.target.value)}
                className="field w-auto min-h-11 py-2"
              >
                {EVENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                aria-label="Filter by linked status"
                value={linked}
                onChange={(event) => setLinked(event.target.value as LinkedFilterValue)}
                className="field w-auto min-h-11 py-2"
              >
                <option value="all">All mail links</option>
                <option value="linked">Linked only</option>
                <option value="unlinked">Unlinked only</option>
              </select>
              <label className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm">
                <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
                Unread only
              </label>
              <button
                type="button"
                onClick={() => setAllMail((v) => !v)}
                aria-pressed={allMail}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium",
                  allMail ? "border-brand bg-brand/10 text-brand" : "border-line bg-white text-ink-soft",
                )}
              >
                {allMail ? "Showing all mail" : "All mail"}
              </button>
            </div>
          ) : null}
        </Card>
      )}

      {error ? <div role="alert" className="rounded-md border border-danger/30 bg-white p-4 text-sm text-danger">{error}</div> : null}

      {loading && items.length === 0 ? (
        <Card className="p-5 text-sm text-muted">Loading mail…</Card>
      ) : visible.length === 0 ? (
        <EmptyState
          title="No mail captured yet."
          detail={
            mode.kind !== "list"
              ? "No captured message is linked here yet."
              : activeSearch
                ? "No captured message matched that search."
                : "Once Turo email capture is live for this workspace, messages will appear here."
          }
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((item) => (
            <MailListRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      {mode.kind === "list" && !activeSearch && hasMore ? (
        <Button variant="secondary" className="w-full" disabled={loading} onClick={() => void load(true)}>
          {loading ? "Loading…" : "Load older mail"}
        </Button>
      ) : null}
    </div>
  );
}

function MailListRow({ item }: { item: MailListItem }) {
  const chip = deriveMailLinkChip(item);
  return (
    <li>
      <Link
        href={`/owner/mail/${item.id}`}
        className="flex min-h-16 items-start gap-3 rounded-lg border border-line bg-white p-4 hover:bg-surface"
      >
        <span
          aria-hidden="true"
          className={cn("mt-2 h-2 w-2 shrink-0 rounded-full", item.isRead ? "bg-transparent" : "bg-brand")}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <strong className={cn("line-clamp-1 text-sm sm:text-base", item.isRead ? "font-medium text-ink-soft" : "font-semibold text-ink")}>
              {item.subject}
            </strong>
            {item.hasAttachments ? (
              <IconDownload role="img" aria-label="Has attachments" className="h-4 w-4 shrink-0 text-muted" />
            ) : null}
            {chip ? <Badge tone="neutral">{chip.label}</Badge> : null}
          </span>
          <span className="mt-0.5 block truncate text-sm text-muted">{formatMailSender(item.sender)}</span>
          <span className="mt-0.5 line-clamp-1 block text-sm text-ink-soft">{item.snippet}</span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted">{formatMailListDate(item.sentAtMs)}</span>
      </Link>
    </li>
  );
}
