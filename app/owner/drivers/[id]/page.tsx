"use client";

/**
 * Driver detail: identity, onboarding progress, module completion split
 * against their path mode, the readiness checklist, and any trips linked to
 * them. Reads the dynamic segment via useParams() (never the async `params`
 * prop — this is a client component, same as the rest of /owner).
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { driverStatus } from "@/lib/owner/derive";
import { modulesForPath } from "@/lib/flow";
import { CHECKLIST, moduleById } from "@/lib/content";
import { Badge, Card, ProgressBar } from "@/components/ui";
import { IconCheck, IconChevronRight } from "@/components/icons";
import { StatusPill, TripStatusBadge, EmptyState } from "@/components/owner/owner-ui";
import { PageHeader } from "@/components/evhost-ui";
import { GuestRollupStats } from "@/components/owner/guest-rollup-stats";
import { findPossibleDuplicateGuestGroups, duplicatePartnerIds } from "@/components/owner/guest-duplicate-hints";
import { GuestMergeDialog } from "@/components/owner/guest-merge-dialog";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { mergeGuestsViaRpc } from "@/lib/owner/guest-linking-client";
import type { Guest } from "@/lib/owner/types";
import {
  applyGuestLinks,
  EMPTY_GUEST_LINKS,
  fetchWorkspaceGuestKeyCounts,
  fetchWorkspaceGuestLinks,
  type WorkspaceGuestLinks,
} from "../guest-roster";

const STEP_LABELS: Record<string, string> = {
  welcome: "Welcome",
  connect: "Connect",
  plan: "Your plan",
  "tesla-account": "Tesla account setup",
  checklist: "Readiness checklist",
  done: "All set",
};

function stepLabel(stepId: string): string {
  return STEP_LABELS[stepId] ?? moduleById(stepId)?.title ?? stepId;
}

function experienceLabel(exp: string | null | undefined): string {
  switch (exp) {
    case "owner":
      return "Tesla owner";
    case "account":
      return "Tesla account";
    case "new":
      return "New to Tesla";
    default:
      return "Not connected";
  }
}

function pathModeLabel(mode: string | null | undefined): string {
  if (mode === "full") return "Full tour";
  if (mode === "essentials") return "Essentials only";
  return "Not chosen";
}

// UTC getters on purpose — see components/owner/owner-ui.tsx's note: keeps
// server/first-paint output deterministic regardless of either side's
// timezone. This page only ever prints published progress timestamps.
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${h12}:${String(m).padStart(2, "0")} ${ampm} UTC`;
}

function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// Stable pre-hydration fallback so SSR markup matches the first client paint —
// same pattern as app/owner/page.tsx and app/owner/drivers/page.tsx. `now`
// only becomes the real clock after mount.
const SSR_FALLBACK_NOW = 0;

export default function DriverDetailPage() {
  const params = useParams<{ id: string }>();
  // Next may preserve an encoded dynamic segment during client navigation.
  // Normalize once so roster links containing the synthetic `trip-guest:`
  // prefix resolve identically after a hard load and an in-app transition.
  const id = (() => {
    try {
      return decodeURIComponent(params.id);
    } catch {
      return params.id;
    }
  })();
  const { drivers: rawDrivers, trips: rawTrips, hydrated } = useOwnerData();
  const { workspace } = useOwnerTenant();
  const [now, setNow] = useState(SSR_FALLBACK_NOW);
  const [guestLinks, setGuestLinks] = useState<WorkspaceGuestLinks>(EMPTY_GUEST_LINKS);
  const [keyCounts, setKeyCounts] = useState<Map<string, number>>(new Map());
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  // Durable-guest roster (Phase 7, workspace mode only) — see
  // ../guest-roster.ts. Demo mode (no workspace) never fetches and keeps
  // today's per-trip synthesized rows, honestly.
  useEffect(() => {
    let cancelled = false;
    if (!workspace) {
      setGuestLinks(EMPTY_GUEST_LINKS);
      setKeyCounts(new Map());
      return;
    }
    const scope = { workspaceId: workspace.id, shopSlug: workspace.shopSlug };
    Promise.all([fetchWorkspaceGuestLinks(scope), fetchWorkspaceGuestKeyCounts(scope)]).then(
      ([links, counts]) => {
        if (cancelled) return;
        setGuestLinks(links);
        setKeyCounts(counts);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  const { drivers, trips } = useMemo(
    () => applyGuestLinks(rawDrivers, rawTrips, guestLinks),
    [rawDrivers, rawTrips, guestLinks],
  );

  // Possible-duplicate hint (Phase 7 validation calibration rule) — see
  // components/owner/guest-duplicate-hints.ts for why this is an honest
  // client-visible proxy rather than the server-side Phase 3 query. Runs
  // over the (possibly guest-grouped) roster above, so once two durable
  // guests still share an email post-linking, that really is a candidate
  // for the merge tool below — not just two per-trip rows for the same
  // booking.
  const duplicateGroups = useMemo(() => findPossibleDuplicateGuestGroups(drivers), [drivers]);

  if (!hydrated) {
    return <EmptyState title="Loading…" />;
  }

  const driver = drivers.find((d) => d.id === id);

  if (!driver) {
    return (
      <EmptyState
        title="Guest not found."
        detail="This guest may not have a trip booked yet, or the link is out of date."
      >
        <Link
          href="/owner/drivers"
          className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          Back to drivers
        </Link>
      </EmptyState>
    );
  }

  const status = driverStatus(driver, now);
  const progress = driver.progress;
  const pathMode = progress?.pathMode ?? "essentials";
  const modules = modulesForPath(pathMode);
  const completedModules = modules.filter((m) => progress?.completed.includes(m.id));
  const pendingModules = modules.filter((m) => !progress?.completed.includes(m.id));
  const linkedTrips = trips.filter((t) => t.driverId === driver.id);

  const partnerIds = duplicatePartnerIds(driver.id, duplicateGroups);
  const partnerDriver = partnerIds.length > 0 ? drivers.find((d) => d.id === partnerIds[0]) : undefined;

  // Real, non-fabricated preview counts for the partner record (the one a
  // merge would remove), now that durable guests + the hardened
  // get_onlyevs_guest_identity_key_counts RPC are both readable directly
  // from the client (see ../guest-roster.ts). Only meaningful once both
  // sides of the pair are durable guests (i.e. present in
  // guestLinks.guestDisplayNames) — a per-trip synthesized id was never a
  // real guest record to preview a merge against.
  const partnerIsDurableGuest = Boolean(partnerDriver && guestLinks.guestDisplayNames.has(partnerDriver.id));
  const partnerTripsToMove = partnerDriver ? trips.filter((t) => t.driverId === partnerDriver.id).length : 0;
  const partnerKeysToMove = partnerDriver ? keyCounts.get(partnerDriver.id) ?? 0 : 0;

  // The "Review & merge" action needs both sides of the pair to already be
  // durable guest records (public.onlyevs_guests rows), never a per-trip
  // synthesized id — merge_onlyevs_guests (the migration's Phase 7 RPC)
  // operates on real guest ids only. Source is always the partner record
  // (the one a merge removes); target is always the guest currently being
  // viewed, matching the counts already shown above ("onto this record").
  const viewedIsDurableGuest = guestLinks.guestDisplayNames.has(driver.id);
  const canOfferMerge = Boolean(workspace && partnerDriver && partnerIsDurableGuest && viewedIsDurableGuest);
  const mergeSource: Guest | null =
    canOfferMerge && partnerDriver
      ? { id: partnerDriver.id, displayName: guestLinks.guestDisplayNames.get(partnerDriver.id) ?? partnerDriver.name, createdAt: 0, updatedAt: 0 }
      : null;
  const mergeTarget: Guest | null = canOfferMerge
    ? { id: driver.id, displayName: guestLinks.guestDisplayNames.get(driver.id) ?? driver.name, createdAt: 0, updatedAt: 0 }
    : null;

  async function handleConfirmMerge() {
    if (!workspace || !mergeSource || !mergeTarget) return;
    setMerging(true);
    setMergeError(null);
    try {
      await mergeGuestsViaRpc({ workspaceId: workspace.id }, mergeSource.id, mergeTarget.id);
      const scope = { workspaceId: workspace.id, shopSlug: workspace.shopSlug };
      const [links, counts] = await Promise.all([
        fetchWorkspaceGuestLinks(scope),
        fetchWorkspaceGuestKeyCounts(scope),
      ]);
      setGuestLinks(links);
      setKeyCounts(counts);
      setMergeDialogOpen(false);
    } catch (err) {
      // Honest merge-failed state, never a silent no-op or a fabricated
      // success — see the plan's Guest page states ("merge-failed message").
      setMergeError(err instanceof Error ? err.message : "Merge failed. Please try again.");
    } finally {
      setMerging(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <Link
          href="/owner/drivers"
          className="text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          ← Guests
        </Link>
        <PageHeader
          eyebrow="Guest readiness"
          title={driver.name || "Unnamed guest"}
          description="Walkthrough progress, required readiness items, and linked trip context."
        />
      </div>

      {/* Identity — design review Issue 1 (1A): identity header first, then
          trip history, then rollups (disputes reference trips, not
          averages). */}
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">Guest profile</span>
              {driver.source === "guest-local" && (
                <Badge tone="brand">This browser&apos;s guest</Badge>
              )}
              {partnerDriver && <Badge tone="warn">Possible duplicate</Badge>}
            </div>
            {driver.email && <div className="mt-0.5 text-sm text-muted">{driver.email}</div>}
          </div>
          <StatusPill status={status} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>{experienceLabel(progress?.experience)}</Badge>
          <Badge>{pathModeLabel(progress?.pathMode)}</Badge>
        </div>
        <div className="mt-3 text-xs text-muted">
          {progress
            ? `Last activity ${formatDateTime(progress.updatedAt)}`
            : "No onboarding activity yet."}
        </div>
        {partnerDriver && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-warn/30 bg-warn/[0.06] p-3">
            <p className="min-w-0 flex-1 text-sm text-ink-soft">
              Shares an email with <span className="font-medium text-ink">{partnerDriver.name || "another guest"}</span> — this may be the same person.
              {partnerIsDurableGuest
                ? ` A merge would move ${partnerTripsToMove} trip${partnerTripsToMove === 1 ? "" : "s"} and ${partnerKeysToMove} identity key${partnerKeysToMove === 1 ? "" : "s"} onto this record.`
                : " Merging isn't available yet."}
            </p>
            {canOfferMerge && (
              <button
                type="button"
                onClick={() => {
                  setMergeError(null);
                  setMergeDialogOpen(true);
                }}
                className="min-h-11 shrink-0 rounded-md border border-warn/40 px-3 text-sm font-medium text-ink transition-colors hover:bg-warn/10"
              >
                Review &amp; merge
              </button>
            )}
          </div>
        )}
        {mergeError && (
          <p className="mt-2 text-sm text-danger">{mergeError}</p>
        )}
      </Card>

      {mergeSource && mergeTarget && (
        <GuestMergeDialog
          open={mergeDialogOpen}
          source={mergeSource}
          target={mergeTarget}
          tripsToMove={partnerTripsToMove}
          keysToMove={partnerKeysToMove}
          busy={merging}
          onConfirm={handleConfirmMerge}
          onCancel={() => setMergeDialogOpen(false)}
        />
      )}

      {/* Trip history — before aggregates by design (Phase 7, Issue 1/1A). */}
      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Trip history
        </div>
        {linkedTrips.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No linked trips yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {linkedTrips.map((trip) => (
              <li key={trip.id}>
                <Link
                  href={`/owner/trips/${trip.id}`}
                  className="flex min-h-[44px] items-center gap-3 rounded-md border border-line bg-white px-3.5 py-2.5 transition-colors hover:bg-surface"
                >
                  <TripStatusBadge status={trip.status} />
                  <span className="min-w-0 flex-1 text-[14px] font-medium text-ink">
                    {formatShortDate(trip.startAt)} – {formatShortDate(trip.endAt)}
                  </span>
                  <IconChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Rollups — last in the hierarchy, and only once Phase 3's
          key-stability validation has passed (see guest-rollup-stats.tsx).
          Renders nothing while the gate is closed. */}
      <GuestRollupStats trips={linkedTrips} />

      {/* Onboarding progress */}
      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Onboarding progress
        </div>
        {progress ? (
          <>
            <ProgressBar value={progress.pct} />
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-ink-soft">{Math.round(progress.pct)}% complete</span>
              <span className="text-muted">
                {progress.isDone ? "Finished" : `Currently on: ${stepLabel(progress.stepId)}`}
              </span>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted">This guest hasn&apos;t opened onboarding.</p>
        )}
      </Card>

      {/* Modules */}
      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Modules ({completedModules.length}/{modules.length})
        </div>
        <div className="mt-3 space-y-1.5">
          {completedModules.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-md bg-good/5 px-3 py-2.5">
              <span className="text-xl leading-none">{m.emoji}</span>
              <span className="min-w-0 flex-1 text-[14px] font-medium text-ink">{m.title}</span>
              <span className="shrink-0 text-xs text-muted">{m.minutes} min</span>
              <IconCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-good" />
            </div>
          ))}
          {pendingModules.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-md bg-surface px-3 py-2.5">
              <span className="text-xl leading-none opacity-60">{m.emoji}</span>
              <span className="min-w-0 flex-1 text-[14px] font-medium text-ink-soft">
                {m.title}
              </span>
              <span className="shrink-0 text-xs text-muted">{m.minutes} min</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Checklist */}
      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Readiness checklist
        </div>
        <div className="mt-3 space-y-1.5">
          {CHECKLIST.map((item) => {
            const checked = progress?.checklist[item.id] === true;
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-md border border-line bg-white px-3 py-2.5"
              >
                <span
                  className={
                    checked
                      ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-good text-white"
                      : "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-line"
                  }
                >
                  {checked && <IconCheck aria-hidden="true" className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 text-[14px] text-ink-soft">{item.label}</span>
                {item.required && <Badge>Required</Badge>}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
