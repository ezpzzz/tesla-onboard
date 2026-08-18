"use client";

/**
 * Trip detail — header (driver, car, status, dates), stat row, battery
 * return gauge vs. policy, timeline, charging sessions, a cost-recovery
 * callout when there's money to pass through, and the return checklist for
 * trips that have actually started.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { useOwnerState } from "@/lib/owner/owner-state";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import {
  formatMiles,
  formatUsd,
  isTripCancellable,
  parseReturnPolicyPct,
  resolveVehiclePolicyPct,
  sessionsForTrip,
  tripEnergy,
  tripMiles,
} from "@/lib/owner/derive";
import {
  ChargingSessionList,
  EmptyState,
  ReturnChecklistCard,
  StatTile,
  TripStatusBadge,
} from "@/components/owner/owner-ui";
import { BatteryReturnGauge, TripTimeline } from "@/components/owner/charts";
import { Badge, Button, Card } from "@/components/ui";
import { IconAlert } from "@/components/icons";
import { cancelTrip, regenerateGuestOnboardingLink } from "@/lib/owner/trip-repository";
import { vehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import { fetchTripChargeSessions, saveManualChargeCostOverride } from "@/lib/owner/charge-session-repository";
import { formatSessionKwhLabel } from "@/lib/owner/charge-sessions";
import { CostOverrideField } from "@/components/owner/cost-override-field";
import type { DerivedChargeSession } from "@/lib/owner/types";
import { PageHeader } from "@/components/evhost-ui";
import { ReminderButton } from "@/components/owner/ReminderButton";

/* UTC-only formatting so server and first client paint always agree — see
 * the same convention in components/owner/owner-ui.tsx. */
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

function formatDateRange(startMs: number, endMs: number): string {
  return `${formatDateTime(startMs)} – ${formatDateTime(endMs)}`;
}

export default function TripDetailPage() {
  const { config, tenantSlug } = useTenantConfig();
  const params = useParams<{ id: string }>();
  const tripId = params.id;
  const { trips, drivers, vehicles, chargingSessions, hydrated } = useOwnerData();
  const { state: ownerState } = useOwnerState();
  const [copied, setCopied] = useState(false);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [guestUrl, setGuestUrl] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [derivedSessions, setDerivedSessions] = useState<DerivedChargeSession[]>([]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const cancelTriggerRef = useRef<HTMLButtonElement>(null);
  const cancelConfirmRef = useRef<HTMLButtonElement>(null);
  const wasConfirmingCancelRef = useRef(false);
  const hasMountedCancelRef = useRef(false);

  const trip = trips.find((t) => t.id === tripId) ?? null;
  const cancellable = trip !== null && isTripCancellable(trip.status);

  // Same focus-preservation idiom as the vehicle "Remove from fleet" control
  // (app/owner/vehicles/[id]/page.tsx): move focus to whichever control just
  // became relevant instead of letting it drop to <body> when the trigger
  // button unmounts.
  useEffect(() => {
    if (!hasMountedCancelRef.current) {
      hasMountedCancelRef.current = true;
      wasConfirmingCancelRef.current = confirmCancel;
      return;
    }
    if (confirmCancel && !wasConfirmingCancelRef.current) {
      cancelConfirmRef.current?.focus();
    } else if (!confirmCancel && wasConfirmingCancelRef.current) {
      cancelTriggerRef.current?.focus();
    }
    wasConfirmingCancelRef.current = confirmCancel;
  }, [confirmCancel]);
  const driver = trip ? drivers.find((d) => d.id === trip.driverId) ?? null : null;
  const vehicle = trip ? vehicles.find((v) => v.id === trip.vehicleId) ?? null : null;
  const sessions = trip ? sessionsForTrip(chargingSessions, trip.id) : [];
  const energy = useMemo(() => tripEnergy(sessions), [sessions]);
  const miles = trip ? tripMiles(trip) : null;
  const scope = useMemo(() => vehicleWorkspaceScope(tenantSlug), [tenantSlug]);

  // Cost-provenance detail (Phase 3, TODO 2 choice C, mechanism Issue 9B) —
  // ChargingSessionList above already renders the real per-session
  // kWh/cost from `chargingSessions`; this fetches the same trip's sessions
  // in their full DerivedChargeSession shape (costProvenance intact) so
  // CostProvenanceTag/CostOverrideField have somewhere to render. A read
  // failure degrades to an empty list — the plain session list above still
  // renders regardless.
  useEffect(() => {
    if (!trip || !scope) { setDerivedSessions([]); return; }
    let cancelled = false;
    fetchTripChargeSessions(scope, trip)
      .then((result) => { if (!cancelled) setDerivedSessions(result); })
      .catch(() => { if (!cancelled) setDerivedSessions([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed off the
    // trip's stable identity/window fields, not the trips-array reference
    // (which is re-created on every operational-snapshot refresh).
  }, [trip?.id, trip?.vehicleId, trip?.startAt, trip?.endAt, scope]);

  // Persists a manual cost correction (G5 remediation) and reflects it in
  // local state immediately — the pure applyManualChargeCostOverride inside
  // CostOverrideField already computed `next`, so no refetch is needed for
  // the row itself to show the new value/provenance right away.
  async function saveCostOverride(session: DerivedChargeSession) {
    if (!scope) throw new Error("This workspace can't save cost corrections right now.");
    await saveManualChargeCostOverride(scope, {
      vehicleId: session.vehicleId,
      tripId: session.tripId,
      sessionStartedAtMs: session.startedAt,
      costUsd: session.costUsd ?? 0,
    });
    setDerivedSessions((prev) => prev.map((s) => (s.id === session.id ? session : s)));
  }
  const globalPolicyPct = useMemo(
    () => parseReturnPolicyPct(config.rental.returnChargeLevel),
    [config.rental.returnChargeLevel],
  );
  const policyPct = resolveVehiclePolicyPct(vehicle, globalPolicyPct);

  if (!hydrated) {
    return <Card className="p-6 text-center text-sm text-muted">Loading trip…</Card>;
  }

  if (!trip) {
    return (
      <EmptyState
        title="Trip not found."
        detail={`No trip with id "${tripId}" — it may have been reassigned or the link is stale.`}
      >
        <Link
          href="/owner/trips"
          className="text-sm font-medium text-brand hover:underline"
        >
          Back to trips
        </Link>
      </EmptyState>
    );
  }

  const belowPolicy = trip.batteryEndPct !== null && trip.batteryEndPct < policyPct;
  const showCostRecovery =
    trip.status === "completed" &&
    (energy.superchargerCostUsd > 0 || belowPolicy) &&
    !(belowPolicy && ownerState.tripChecklists[trip.id]?.chargedToPolicy);

  async function createGuestLink() {
    setGeneratingLink(true);
    setLinkError(null);
    try {
      const url = await regenerateGuestOnboardingLink(trip!.id);
      setGuestUrl(url);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        setLinkError("The new link is ready. Select and copy it from the field above.");
      }
    } catch (caught) {
      setLinkError(caught instanceof Error ? caught.message : "A new link could not be generated.");
    } finally {
      setGeneratingLink(false);
    }
  }

  async function handleCancelClick() {
    if (!confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelTrip(trip!.id);
      setConfirmCancel(false);
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : "The trip could not be cancelled.");
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Trip handoff" title={driver?.name || "Trip"} description={`${vehicle?.displayName || config.car.model} · ${formatDateRange(trip.startAt, trip.endAt)}`} action={<TripStatusBadge status={trip.status} />} />
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {driver ? (
              <Link
                href={`/owner/drivers/${driver.id}`}
                className="text-lg font-semibold tracking-tight text-ink hover:text-brand"
              >
                {driver.name || "Unnamed guest"}
              </Link>
            ) : (
              <span className="text-lg font-semibold tracking-tight text-ink">Unassigned</span>
            )}
            <div className="mt-0.5 text-sm text-muted">
              {vehicle ? (
                <Link
                  href={`/owner/vehicles/${vehicle.id}`}
                  className="inline-flex items-center gap-1.5 hover:text-brand"
                >
                  <span>
                    {vehicle.displayName} {vehicle.trim} · {vehicle.color}
                  </span>
                  {vehicle.status === "archived" && <Badge tone="neutral">Removed</Badge>}
                </Link>
              ) : (
                `${config.car.year} ${config.car.model} ${config.car.trim} · ${config.car.color}`
              )}
            </div>
          </div>
          <Link href="/owner/trips" className="text-sm font-semibold text-brand">Back to trips</Link>
        </div>
        <div className="mt-3 text-sm text-ink-soft">
          {formatDateRange(trip.startAt, trip.endAt)}
        </div>
        <dl className="mt-4 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-muted">Pickup location</dt><dd className="mt-1 font-medium text-ink">{trip.pickupLocation ?? "Use tenant pickup instructions"}</dd></div>
          <div><dt className="text-xs text-muted">Return location</dt><dd className="mt-1 font-medium text-ink">{trip.returnLocation ?? trip.pickupLocation ?? "Use tenant return instructions"}</dd></div>
          <div><dt className="text-xs text-muted">Tesla access</dt><dd className="mt-1 font-medium capitalize text-ink">{trip.accessStatus?.replaceAll("_", " ") ?? "No real grant"}</dd></div>
          <div><dt className="text-xs text-muted">Last reminder</dt><dd className="mt-1 font-medium text-ink">{trip.reminderLastSentAt ? formatDateTime(trip.reminderLastSentAt) : "Not sent"}</dd></div>
        </dl>

        {trip.status === "upcoming" && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-xs leading-relaxed text-muted">
              Generate a replacement private link only when the guest needs it. The previous link is invalidated immediately.
            </p>
            {guestUrl ? (
              <input
                aria-label="Latest private guest link"
                readOnly
                value={guestUrl}
                className="field mt-3 w-full px-3 py-2.5 text-base text-ink"
              />
            ) : null}
            {linkError ? <p role="alert" className="mt-2 text-sm text-danger">{linkError}</p> : null}
            <Button
              variant="secondary"
              onClick={() => void createGuestLink()}
              disabled={generatingLink}
              className="mt-3"
            >
              {generatingLink ? "Generating…" : copied ? "New link copied" : "Generate new guest link"}
            </Button>
            {!driver?.progress?.isDone ? <ReminderButton tripId={trip.id} className="mt-3" /> : null}
          </div>
        )}
      </Card>

      {cancellable && (
        <Card className="p-4">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
            Cancel trip
          </div>
          <p role="status" aria-live="polite" className="sr-only">
            {confirmCancel
              ? "Confirm cancellation: the guest link will stop working and any Tesla access will be revoked."
              : ""}
          </p>
          {cancelError ? (
            <p role="alert" className="mt-3 rounded-md border border-danger/20 bg-danger/[0.04] p-3 text-sm text-danger">
              {cancelError}
            </p>
          ) : null}
          {confirmCancel ? (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-ink-soft">
                Cancel this trip? The guest&rsquo;s private link stops working immediately, any Tesla
                access is revoked, and the trip is kept in history — this cannot be undone.
              </p>
              <div className="flex gap-2">
                <Button ref={cancelConfirmRef} variant="secondary" onClick={handleCancelClick} disabled={cancelling}>
                  {cancelling ? "Cancelling…" : "Confirm cancellation"}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
                  Keep trip
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <Button ref={cancelTriggerRef} variant="secondary" onClick={handleCancelClick}>
                Cancel trip
              </Button>
            </div>
          )}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Miles driven" value={miles === null ? "—" : formatMiles(miles)} />
        <StatTile
          label="Energy cost"
          value={formatUsd(energy.costUsd)}
          sub={
            energy.superchargerCostUsd > 0
              ? `${formatUsd(energy.superchargerCostUsd)} Supercharging`
              : undefined
          }
        />
        <StatTile
          label="Battery start → end"
          value={
            trip.batteryStartPct === null
              ? "—"
              : `${trip.batteryStartPct}% → ${trip.batteryEndPct === null ? "…" : `${trip.batteryEndPct}%`}`
          }
        />
      </div>

      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Return charge vs. policy
        </div>
        <div className="mt-3">
          <BatteryReturnGauge
            startPct={trip.batteryStartPct}
            endPct={trip.batteryEndPct}
            policyPct={policyPct}
            ariaLabel={`Battery ${trip.batteryStartPct ?? "unknown"}% at pickup, ${trip.batteryEndPct ?? "not yet returned"}% at return, policy ${policyPct}%`}
          />
        </div>
      </Card>

      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Trip timeline
        </div>
        <div className="mt-3">
          <TripTimeline
            trip={trip}
            sessions={sessions}
            ariaLabel={`Trip timeline with ${sessions.length} charging session${sessions.length === 1 ? "" : "s"}`}
          />
        </div>
      </Card>

      {showCostRecovery && (
        <Card className="border-warn/30 bg-warn/5 p-4">
          <div className="flex items-start gap-3">
            <IconAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
            <div>
              <div className="text-[14px] font-semibold text-ink">Money to pass through</div>
              <ul className="mt-1.5 space-y-1 text-sm leading-relaxed text-ink-soft">
                {energy.superchargerCostUsd > 0 && (
                  <li>{formatUsd(energy.superchargerCostUsd)} in Supercharging billed to the car.</li>
                )}
                {belowPolicy && (
                  <li>
                    Returned at {trip.batteryEndPct}%, below the {policyPct}% return policy.
                  </li>
                )}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <div>
        <div className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
          Charging sessions
        </div>
        <ChargingSessionList sessions={sessions} />
      </div>

      {derivedSessions.length > 0 && (
        <Card className="p-4">
          <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
            Cost detail
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Each session shows where its cost came from — a reconciled Tesla invoice, your
            configured home rate, or a correction you enter yourself.
          </p>
          <ul className="mt-3 space-y-3">
            {derivedSessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-white p-3.5">
                <span className="text-sm text-ink-soft">
                  {session.kind === "dc_fast" ? "Supercharging" : "Home / AC charging"} · {formatSessionKwhLabel(session)}
                  {session.gapAffected ? " (gap-affected)" : ""}
                </span>
                <CostOverrideField session={session} enteredBy="owner" saveAction={saveCostOverride} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {(trip.status === "active" || trip.status === "completed") && (
        <ReturnChecklistCard tripId={trip.id} />
      )}
    </div>
  );
}
