"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useOwnerTenant } from "./OwnerTenantProvider";
import { CalendarReviewQueue } from "./CalendarReviewQueue";
import { PacketEvidenceQueue } from "./packet-evidence-card";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { vehicleWorkspaceScope, type VehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import {
  archiveInboxItem,
  dismissEmailInboxItem,
  fetchOwnerInbox,
  restoreInboxItem,
  type OwnerInboxCursor,
  type OwnerInboxItem,
} from "@/lib/owner/email-inbox-repository";
import {
  confirmEmailCandidate,
  abortEmailRevocation,
  buildPrefilledCreateTripHref,
  resolveAppliedCandidateTrip,
} from "@/lib/owner/email-actions-repository";
import {
  CandidateAvatar,
  CandidateChangeComparison,
  CandidateMeta,
  buildViewFullEmailHref,
  deriveConsequenceTitle,
  fetchEmailCandidateFacts,
  isoToLocalWallTimeInput,
  localWallTimeToIso,
  type EmailCandidateFacts,
} from "./InboxCandidateCard";
import {
  deriveUrgentActionView,
  fetchLinkedEmailAction,
  useMinuteTicker,
  UrgentActionAbortButton,
  UrgentActionPanel,
  type EmailActionRow,
} from "./UrgentActionPanel";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";
import { Badge, Button, Card, Segmented, cn } from "@/components/ui";
import { IconCalendar, IconMail } from "@/components/icons";

type Filter = "all" | "needs_action" | "archived";
type FetchStatus = "idle" | "loading" | "loaded" | "error";
type MutateAction = "dismiss" | "archive" | "restore" | "confirm" | "abort";

/**
 * Event types that can be Confirmed straight through the saga executor
 * (`execute_onlyevs_email_action`'s `db_committing` step,
 * `supabase/migrations/20260816150000_onlyevs_email_action_lifecycle.sql`).
 * Deliberately excludes 'booking': create_trip requires a `guestEmail`, which
 * Turo's booking-confirmation emails never expose (M1's extraction has no
 * source for it) and this Inbox collects no correction for either -- Confirm
 * would deterministically land every booking candidate in needs_review with
 * `create_trip_facts_incomplete`. "Create trip manually" (rendered
 * unconditionally for booking candidates below) is the one live path for a
 * booking event in this build; 'change'/'cancellation' need no guest email
 * (apply_update/cancel_trip) and confirm correctly.
 */
const CONFIRMABLE_EVENT_TYPES = new Set(["change", "cancellation"]);

/**
 * Matches the shape `deriveAppliedCandidateTrip` (`lib/owner/
 * email-actions-repository.ts`, M3) resolves to, per its own test file
 * (`tests/email-actions-repository.test.ts`). Defined locally rather than
 * importing the type so this file only takes a hard dependency on the
 * functions it calls, not on M3's internal naming.
 */
interface AppliedCandidateTrip {
  tripId: string;
  guestName: string | null;
  guestEmail: string | null;
  startAt: number;
  endAt: number;
  status: string;
}

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
  const selectedRef = useRef<OwnerInboxItem | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  // Per-candidate enrichment: proposed_state/correction_facts (M1's
  // extraction) and the linked destructive action, if any (M2's saga). Both
  // are read directly (see InboxCandidateCard.tsx / UrgentActionPanel.tsx)
  // rather than through fetchOwnerInbox, and load lazily once a card opens
  // so paging through a long inbox never fans out into dozens of requests.
  const [factsById, setFactsById] = useState<Record<string, EmailCandidateFacts>>({});
  const [factsStatus, setFactsStatus] = useState<Record<string, FetchStatus>>({});
  const [actionById, setActionById] = useState<Record<string, EmailActionRow | null>>({});
  const [actionStatus, setActionStatus] = useState<Record<string, FetchStatus>>({});
  const [appliedTripById, setAppliedTripById] = useState<Record<string, AppliedCandidateTrip | null>>({});
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [correctionDraft, setCorrectionDraft] = useState<{ startsAt: string; endsAt: string }>({ startsAt: "", endsAt: "" });

  const load = useCallback(async (append = false) => {
    if (!scope) { setLoading(false); return; }
    setLoading(true);
    try {
      if (!append) snapshotAt.current = Date.now();
      const page = await fetchOwnerInbox(scope, snapshotAt.current, append ? cursor ?? undefined : undefined);
      setItems((current) => (append ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inbox could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [cursor, scope]);
  useEffect(() => { void load(false); }, [scope?.key]);

  const loadEnrichment = useCallback(async (item: OwnerInboxItem, workspaceScope: VehicleWorkspaceScope) => {
    if (item.source !== "turo_email") return;
    setFactsStatus((current) => ({ ...current, [item.id]: "loading" }));
    setActionStatus((current) => ({ ...current, [item.id]: "loading" }));
    const [factsResult, actionResult] = await Promise.allSettled([
      fetchEmailCandidateFacts(workspaceScope, item.id),
      fetchLinkedEmailAction(workspaceScope, item.id),
    ]);
    if (factsResult.status === "fulfilled") {
      setFactsById((current) => ({ ...current, [item.id]: factsResult.value }));
      setFactsStatus((current) => ({ ...current, [item.id]: "loaded" }));
    } else {
      setFactsStatus((current) => ({ ...current, [item.id]: "error" }));
    }
    if (actionResult.status === "fulfilled") {
      setActionById((current) => ({ ...current, [item.id]: actionResult.value }));
      setActionStatus((current) => ({ ...current, [item.id]: "loaded" }));
    } else {
      setActionStatus((current) => ({ ...current, [item.id]: "error" }));
    }
    if (item.state === "applied" && !(item.id in appliedTripById)) {
      try {
        const trip = await resolveAppliedCandidateTrip(workspaceScope, item);
        setAppliedTripById((current) => ({ ...current, [item.id]: trip }));
      } catch {
        setAppliedTripById((current) => ({ ...current, [item.id]: null }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- appliedTripById intentionally read, not depended on, to avoid re-fetching after it's set once.
  }, []);

  const visible = items.filter((item) => (filter === "archived" ? item.archived : filter === "needs_action" ? item.actionable && !item.archived : !item.archived));
  const urgentTotal = items.filter((item) => item.actionable && !item.archived).length;
  const urgent = items.filter((item) => item.actionable && !item.archived).slice(0, 50);

  function open(item: OwnerInboxItem) {
    const next = selected?.id === item.id ? null : item;
    setSelected(next);
    // Always refetch on open rather than only the first time this id is seen:
    // a Turo-email candidate's linked destructive action (onlyevs_email_actions)
    // moves through states — queued, awaiting_owner_alert, the 30-minute
    // revocation_pending brake, in-progress — independently of this card's own
    // React lifecycle. Caching "already fetched" by id would leave a stale
    // (frequently pre-confirm, still-null) action row in actionById for the
    // rest of the session once a candidate had been opened once, hiding the
    // countdown/Abort control on every later reopen. The guard here only
    // skips a fetch already in flight for this id, not one already completed.
    if (next && scope && factsStatus[next.id] !== "loading") void loadEnrichment(next, scope);
    if (!window.matchMedia("(max-width: 767px)").matches) return;
    if (!next) { dialogRef.current?.close(); return; }
    if (!dialogRef.current?.open) {
      setTimeout(() => { if (selectedRef.current && !dialogRef.current?.open) dialogRef.current?.showModal(); }, 0);
    }
  }

  async function mutate(action: MutateAction, item: OwnerInboxItem, extra?: { reason?: string; corrections?: Record<string, string> }) {
    if (!scope) return;
    setBusy(true);
    try {
      if (action === "dismiss") await dismissEmailInboxItem(scope, item);
      if (action === "archive") await archiveInboxItem(scope, item);
      if (action === "restore") await restoreInboxItem(scope, item);
      if (action === "confirm") await confirmEmailCandidate(scope, item.id, item.revision, extra?.corrections ?? {});
      if (action === "abort") {
        const linked = actionById[item.id];
        if (!linked) return;
        await abortEmailRevocation(scope, linked.id, linked.revision, extra?.reason ?? "Owner aborted from the Inbox.");
        // Abort keeps the item open (the owner is watching this resolve) —
        // refresh just the linked action instead of closing the card.
        const refreshed = await fetchLinkedEmailAction(scope, item.id);
        setActionById((current) => ({ ...current, [item.id]: refreshed }));
        return;
      }
      setSelected(null);
      dialogRef.current?.close();
      setCorrectingId(null);
      setCursor(null);
      await load(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inbox action failed.");
    } finally {
      setBusy(false);
    }
  }

  function beginCorrection(item: OwnerInboxItem, facts: EmailCandidateFacts) {
    if (!facts.tripStartsAt || !facts.tripEndsAt || !facts.tripTimezone) return;
    setCorrectingId(item.id);
    setCorrectionDraft({
      startsAt: isoToLocalWallTimeInput(facts.tripStartsAt, facts.tripTimezone),
      endsAt: isoToLocalWallTimeInput(facts.tripEndsAt, facts.tripTimezone),
    });
  }

  function confirmWithCorrections(item: OwnerInboxItem, facts: EmailCandidateFacts) {
    if (correctingId !== item.id || !facts.tripTimezone) { void mutate("confirm", item); return; }
    const corrections: Record<string, string> = {};
    const startIso = localWallTimeToIso(correctionDraft.startsAt, facts.tripTimezone);
    const endIso = localWallTimeToIso(correctionDraft.endsAt, facts.tripTimezone);
    // Key names here MUST match what execute_onlyevs_email_action's
    // db_committing step reads off proposed_state/correction_facts --
    // lib/email/turo-parser.ts's 'tripStartAt'/'tripEndAt' (see that
    // migration's key-contract comment), not 'tripStartsAt'/'tripEndsAt'
    // (the EmailCandidateFacts view-model field names below).
    if (facts.tripStartsAt && startIso !== new Date(facts.tripStartsAt).toISOString()) corrections.tripStartAt = startIso;
    if (facts.tripEndsAt && endIso !== new Date(facts.tripEndsAt).toISOString()) corrections.tripEndAt = endIso;
    void mutate("confirm", item, { corrections });
  }

  return (
    <div className="space-y-5">
      {urgent.length ? (
        <section className="rounded-lg border border-warn/30 bg-warn/[0.06] p-4" aria-label="Needs attention">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-ink">Needs attention</h2>
              <p className="mt-1 text-sm text-muted">
                {urgent.length}{urgentTotal > 50 ? "+" : ""} booking update{urgent.length === 1 ? "" : "s"} waiting for a decision.
              </p>
            </div>
            <Badge tone="warn">{urgent.length}</Badge>
          </div>
        </section>
      ) : null}
      <CalendarReviewQueue vehicles={vehicles} confirmationEnabled={ONLYEVS_OPERATIONS_ENABLED} />
      <PacketEvidenceQueue />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold">Activity</h2>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[{ value: "all", label: "All" }, { value: "needs_action", label: "Needs action" }, { value: "archived", label: "Archived" }]}
        />
      </div>
      {error ? <div role="alert" className="rounded-md border border-danger/30 bg-white p-4 text-sm text-danger">{error}</div> : null}
      {loading && items.length === 0 ? (
        <Card className="p-5 text-sm text-muted">Loading inbox…</Card>
      ) : visible.length === 0 ? (
        <div className="space-y-3">
          <Card className="p-8 text-center">
            <h3 className="font-semibold">Nothing here yet</h3>
            <p className="mt-2 text-sm text-muted">Forward a Turo test email or connect Google Calendar to begin.</p>
          </Card>
          {hasMore ? <Button variant="secondary" className="w-full" disabled={loading} onClick={() => void load(true)}>Load older activity</Button> : null}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => (
            <InboxCard
              key={`${item.source}:${item.id}`}
              item={item}
              expanded={selected?.id === item.id}
              onOpen={() => open(item)}
              onMutate={mutate}
              busy={busy}
              facts={factsById[item.id]}
              factsStatus={factsStatus[item.id] ?? "idle"}
              action={actionById[item.id] ?? null}
              actionStatus={actionStatus[item.id] ?? "idle"}
              appliedTrip={appliedTripById[item.id]}
              correcting={correctingId === item.id}
              correctionDraft={correctionDraft}
              onBeginCorrection={(facts) => beginCorrection(item, facts)}
              onCorrectionDraftChange={setCorrectionDraft}
              onConfirmWithCorrections={(facts) => confirmWithCorrections(item, facts)}
            />
          ))}
          {hasMore ? <Button variant="secondary" className="w-full" disabled={loading} onClick={() => void load(true)}>{loading ? "Loading…" : "Load older activity"}</Button> : null}
        </div>
      )}
      <dialog
        ref={dialogRef}
        onClose={() => setSelected(null)}
        className="m-0 mt-auto h-[88dvh] max-h-[88dvh] w-full max-w-none rounded-t-2xl border-0 bg-white p-0 backdrop:bg-black/40 md:hidden"
      >
        {selected ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-line p-4">
              <strong>Inbox detail</strong>
              <button type="button" autoFocus onClick={() => dialogRef.current?.close()} className="min-h-11 rounded-md px-3 text-sm">Close</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <InboxDetail
                item={selected}
                facts={factsById[selected.id]}
                factsStatus={factsStatus[selected.id] ?? "idle"}
                action={actionById[selected.id] ?? null}
                actionStatus={actionStatus[selected.id] ?? "idle"}
                appliedTrip={appliedTripById[selected.id]}
                correcting={correctingId === selected.id}
                correctionDraft={correctionDraft}
                onBeginCorrection={(facts) => beginCorrection(selected, facts)}
                onCorrectionDraftChange={setCorrectionDraft}
              />
            </div>
            <div className="border-t border-line bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <MobileFooterActions
                item={selected}
                action={actionById[selected.id] ?? null}
                facts={factsById[selected.id]}
                onMutate={mutate}
                busy={busy}
                onConfirmWithCorrections={(facts) => confirmWithCorrections(selected, facts)}
              />
            </div>
          </div>
        ) : null}
      </dialog>
    </div>
  );
}

interface EnrichmentProps {
  facts: EmailCandidateFacts | undefined;
  factsStatus: FetchStatus;
  action: EmailActionRow | null;
  actionStatus: FetchStatus;
  appliedTrip: AppliedCandidateTrip | null | undefined;
  correcting: boolean;
  correctionDraft: { startsAt: string; endsAt: string };
  onBeginCorrection: (facts: EmailCandidateFacts) => void;
  onCorrectionDraftChange: (draft: { startsAt: string; endsAt: string }) => void;
}

function InboxCard({
  item, expanded, onOpen, onMutate, busy, facts, factsStatus, action, actionStatus, appliedTrip,
  correcting, correctionDraft, onBeginCorrection, onCorrectionDraftChange, onConfirmWithCorrections,
}: {
  item: OwnerInboxItem;
  expanded: boolean;
  onOpen: () => void;
  onMutate: (action: MutateAction, item: OwnerInboxItem, extra?: { reason?: string; corrections?: Record<string, string> }) => void;
  busy: boolean;
  onConfirmWithCorrections: (facts: EmailCandidateFacts) => void;
} & EnrichmentProps) {
  const isEmail = item.source === "turo_email";
  const Icon = isEmail ? IconMail : IconCalendar;
  const title = isEmail && facts ? deriveConsequenceTitle(item, facts.guestName) : item.title;
  const now = useMinuteTicker(expanded && action?.state === "revocation_pending");
  return (
    <Card className={cn("overflow-hidden", item.actionable && "border-l-4 border-l-warn")}>
      <button type="button" onClick={onOpen} aria-expanded={expanded} className="flex min-h-20 w-full items-start gap-3 p-4 text-left sm:p-5">
        {isEmail ? (
          <CandidateAvatar url={facts?.guestAvatarUrl ?? null} guestName={facts?.guestName ?? null} />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <strong className="line-clamp-2 text-sm sm:text-base">{title}</strong>
            {item.actionable ? <Badge tone="warn">Review</Badge> : null}
            {item.state === "applied" ? <Badge tone="good">Applied</Badge> : null}
            {/* A confirmed candidate leaves 'pending'/'needs_review' (actionable
                turns false) the moment onlyevs_worker claims it, well before it
                reaches the terminal 'applied' state — it sits in 'applying' for
                the whole owner-alert/countdown/provider-mutate saga. Without
                this badge a candidate mid-flight (including one with a live,
                abortable destructive-action countdown) renders identically to
                a plain read-only row, so there's no visual cue in the Activity
                list that it needs to be opened rather than left alone. */}
            {item.state === "applying" ? <Badge tone="brand">In progress</Badge> : null}
          </span>
          <span className="mt-1 block text-sm text-muted">
            {item.detail} · {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(item.occurredAt)}
          </span>
        </span>
      </button>
      {expanded ? (
        <div className="hidden border-t border-line p-5 md:block">
          <InboxDetail
            item={item}
            facts={facts}
            factsStatus={factsStatus}
            action={action}
            actionStatus={actionStatus}
            appliedTrip={appliedTrip}
            correcting={correcting}
            correctionDraft={correctionDraft}
            onBeginCorrection={onBeginCorrection}
            onCorrectionDraftChange={onCorrectionDraftChange}
          />
          <div className="mt-5 flex flex-col gap-3">
            {action ? (() => {
              const view = deriveUrgentActionView(action, now);
              return view.visible && view.phase !== "resolved_succeeded" && view.phase !== "resolved_aborted" && view.phase !== "needs_review" && view.phase !== "failed" ? (
                <UrgentActionAbortButton view={view} busy={busy} onAbort={(reason) => onMutate("abort", item, { reason })} />
              ) : null;
            })() : null}
            <InboxActions
              item={item}
              onMutate={onMutate}
              busy={busy}
              correcting={correcting}
              facts={facts}
              onConfirmWithCorrections={onConfirmWithCorrections}
            />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function InboxDetail({ item, facts, factsStatus, action, actionStatus, appliedTrip, correcting, correctionDraft, onBeginCorrection, onCorrectionDraftChange }: { item: OwnerInboxItem } & EnrichmentProps) {
  const now = useMinuteTicker(action?.state === "revocation_pending");
  const canCorrect = facts?.tripStartsAt && facts?.tripEndsAt && facts?.tripTimezone && CONFIRMABLE_EVENT_TYPES.has(item.eventType) && item.actionable;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{item.source === "turo_email" ? "Turo email" : "Google Calendar"}</p>
        <h3 className="mt-2 text-xl font-semibold">{facts ? deriveConsequenceTitle(item, facts.guestName) : item.title}</h3>
        {facts && item.title && deriveConsequenceTitle(item, facts.guestName) !== item.title ? (
          <p className="mt-1 text-sm text-muted">{item.title}</p>
        ) : null}
        <p className="mt-2 text-sm text-muted">{item.detail}</p>
        {item.source === "turo_email" ? (
          <Link
            href={buildViewFullEmailHref(item.id)}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand underline-offset-2 hover:underline"
          >
            View full email
          </Link>
        ) : null}
      </div>
      {item.state === "applied" ? (
        <div className="rounded-md border border-good/30 bg-good/[0.06] p-3 text-sm">
          {appliedTrip ? (
            <Link href={`/owner/trips/${appliedTrip.tripId}`} className="font-medium text-brand underline-offset-2 hover:underline">
              Applied{appliedTrip.guestName ? ` — ${appliedTrip.guestName}` : ""} · view the resulting trip
            </Link>
          ) : (
            <span className="text-ink-soft">Applied.</span>
          )}
        </div>
      ) : null}
      {item.source === "turo_email" ? (
        factsStatus === "loading" ? (
          <p className="text-sm text-muted">Loading guest details…</p>
        ) : factsStatus === "error" ? (
          <p role="alert" className="text-sm text-danger">Guest details couldn't be loaded.</p>
        ) : facts ? (
          <>
            <CandidateMeta facts={facts} blockerCodes={item.blockerCodes} eventType={item.eventType} />
            <CandidateChangeComparison item={item} facts={facts} />
            {canCorrect ? (
              correcting ? (
                <div className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2">
                  <label className="text-sm font-medium text-ink">Start
                    <input
                      type="datetime-local"
                      value={correctionDraft.startsAt}
                      onChange={(event) => onCorrectionDraftChange({ ...correctionDraft, startsAt: event.target.value })}
                      className="mt-1.5 w-full rounded-md border border-line px-3 py-2.5 text-base"
                    />
                  </label>
                  <label className="text-sm font-medium text-ink">End
                    <input
                      type="datetime-local"
                      value={correctionDraft.endsAt}
                      onChange={(event) => onCorrectionDraftChange({ ...correctionDraft, endsAt: event.target.value })}
                      className="mt-1.5 w-full rounded-md border border-line px-3 py-2.5 text-base"
                    />
                  </label>
                  <p className="text-xs text-muted sm:col-span-2">Times are in {facts.tripTimezone}. Confirm below to apply your corrected dates instead of the ones Turo sent.</p>
                </div>
              ) : (
                <button type="button" onClick={() => onBeginCorrection(facts)} className="min-h-11 text-left text-sm font-medium text-brand underline-offset-2 hover:underline">
                  Correct the trip dates before confirming
                </button>
              )
            ) : null}
          </>
        ) : null
      ) : null}
      <dl className="grid grid-cols-2 gap-3 rounded-md bg-surface p-4 text-sm">
        <div><dt className="text-muted">Status</dt><dd className="mt-1 font-medium capitalize">{item.state.replaceAll("_", " ")}</dd></div>
        <div><dt className="text-muted">Event</dt><dd className="mt-1 font-medium capitalize">{item.eventType.replaceAll("_", " ")}</dd></div>
      </dl>
      {item.blockerCodes.length ? (
        <div className="rounded-md border border-line p-4 text-sm">
          <strong>Why review is required</strong>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {item.blockerCodes.map((code) => <li key={code}>{code.replaceAll("_", " ")}</li>)}
          </ul>
        </div>
      ) : null}
      {actionStatus === "error" ? <p role="alert" className="text-sm text-danger">The linked action couldn't be loaded.</p> : null}
      {action ? <UrgentActionPanel action={action} now={now} /> : null}
    </div>
  );
}

function InboxActions({
  item, onMutate, busy, correcting, facts, onConfirmWithCorrections,
}: {
  item: OwnerInboxItem;
  onMutate: (action: MutateAction, item: OwnerInboxItem, extra?: { reason?: string; corrections?: Record<string, string> }) => void;
  busy: boolean;
  correcting: boolean;
  facts: EmailCandidateFacts | undefined;
  onConfirmWithCorrections: (facts: EmailCandidateFacts) => void;
}) {
  const canConfirm = item.source === "turo_email" && item.actionable && CONFIRMABLE_EVENT_TYPES.has(item.eventType);
  // Turo emails never carry a guest email or a fleet vehicle id (M1's
  // extraction has no source for either) — buildPrefilledCreateTripHref
  // omits whatever facts are absent rather than emitting empty params.
  const createTripHref = buildPrefilledCreateTripHref({
    guestName: facts?.guestName ?? undefined,
    startsAt: facts?.tripStartsAt ?? undefined,
    endsAt: facts?.tripEndsAt ?? undefined,
  });
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {item.source === "turo_email" && item.actionable && item.eventType === "booking" ? (
        <Link href={createTripHref} className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white">
          Create trip manually
        </Link>
      ) : null}
      {canConfirm ? (
        <Button
          disabled={busy}
          onClick={() => (correcting && facts ? onConfirmWithCorrections(facts) : void onMutate("confirm", item))}
        >
          {busy ? "Confirming…" : "Confirm"}
        </Button>
      ) : null}
      {item.source === "turo_email" && item.actionable ? (
        <Button variant="secondary" disabled={busy} onClick={() => void onMutate("dismiss", item)}>Dismiss</Button>
      ) : null}
      {item.archived ? (
        <Button variant="secondary" disabled={busy} onClick={() => void onMutate("restore", item)}>Restore</Button>
      ) : !item.actionable ? (
        <Button variant="ghost" disabled={busy} onClick={() => void onMutate("archive", item)}>Archive</Button>
      ) : null}
    </div>
  );
}

/**
 * Mobile bottom-sheet sticky footer: while a destructive brake is live for
 * this candidate, Abort is the one safety-critical control and takes the
 * full-width footer slot (per the responsive contract) instead of the usual
 * Confirm/Dismiss row — those are already moot at that point, since
 * confirming moved the candidate out of `pending|needs_review`.
 */
function MobileFooterActions({
  item, action, facts, onMutate, busy, onConfirmWithCorrections,
}: {
  item: OwnerInboxItem;
  action: EmailActionRow | null;
  facts: EmailCandidateFacts | undefined;
  onMutate: (action: MutateAction, item: OwnerInboxItem, extra?: { reason?: string; corrections?: Record<string, string> }) => void;
  busy: boolean;
  onConfirmWithCorrections: (facts: EmailCandidateFacts) => void;
}) {
  const now = useMinuteTicker(action?.state === "revocation_pending");
  if (action) {
    const view = deriveUrgentActionView(action, now);
    if (view.visible && view.phase !== "resolved_succeeded" && view.phase !== "resolved_aborted" && view.phase !== "needs_review" && view.phase !== "failed") {
      return <UrgentActionAbortButton view={view} busy={busy} fullWidth onAbort={(reason) => onMutate("abort", item, { reason })} />;
    }
  }
  return <InboxActions item={item} onMutate={onMutate} busy={busy} correcting={false} facts={facts} onConfirmWithCorrections={onConfirmWithCorrections} />;
}
