import type { ChargingSession, DerivedChargeSession } from "./types";
import type { VehicleStatsHistoryPoint } from "./access-types";
import { CHARGE_SESSION_GAP_MS } from "./telemetry-policy";

/**
 * Charging-session derivation and cost reconciliation (Phase 3, TODO 2
 * choice C, mechanism Issue 9 choice 9B).
 *
 * Sessions are segmented from DetailedChargeState transitions in
 * onlyevs_vehicle_stats_history: a session closes on a non-charging state,
 * or when no charging signal arrives for CHARGE_SESSION_GAP_MS (30 min,
 * telemetry-policy.ts) — a session that spans the gap is `gapAffected`
 * rather than silently merged or split. Cost has three honest provenances
 * only (DerivedChargeSession.costProvenance): 'rate' (home/AC, owner's
 * configured $/kWh), 'invoice' (DC-fast, Tesla charging-history API),
 * 'manual' (owner override/entry) — never a guessed price.
 *
 * Manual overrides (persisted in onlyevs_manual_charge_cost_entries,
 * lib/owner/charge-session-repository.ts's fetch/save pair) always win at
 * read time — applyManualChargeCostOverrides is applied last, after invoice
 * reconciliation, so the effective precedence is manual > invoice > rate.
 *
 * DC-fast vs AC classification: Phase 1's ingested history schema carries
 * only battery_pct / estimated_range_mi / odometer_mi / charging_state /
 * locked (baseline fields — no charge-power or site-type signal), so there
 * is nothing in the stream itself to tell a 11kW home charge apart from a
 * 250kW Supercharge. Tesla's charging-history API is specifically a
 * Supercharger-network billing feed, so it is the authoritative classifier:
 * every segmented session starts out `ac_home` (the safe default — home/AC
 * charging is unbilled and the common case) and reconcileChargingInvoices
 * below is what promotes a session to `dc_fast` when a real invoice
 * overlaps it.
 */

const ACTIVE_CHARGING_STATES = new Set(["Starting", "Charging"]);

function isChargingState(state: string | null): boolean {
  return state !== null && ACTIVE_CHARGING_STATES.has(state);
}

export interface SegmentChargeSessionsInput {
  vehicleId: string;
  /** Ordered ascending by observedAt. */
  history: VehicleStatsHistoryPoint[];
  /** Trips this vehicle had in the covered window, for trip-boundary
   * attribution by observed_at overlap. Unmatched sessions attach to the
   * vehicle only (tripId: null), never fabricated onto a trip. */
  tripWindows: Array<{ tripId: string; startsAtMs: number; endsAtMs: number }>;
  /**
   * Optional usable battery capacity (kWh) for this vehicle, used only to
   * estimate a segmented ac_home session's kWhAdded from its battery_pct
   * delta — the ingested history has no charge-energy field to read this
   * from directly. Without it, ac_home kWhAdded is an honestly unknown
   * measurement (see isChargeSessionKwhUnknown) — never a fabricated 0.
   * dc_fast sessions never use this: their kWhAdded comes from the
   * reconciled Tesla invoice instead (authoritative).
   */
  batteryCapacityKwh?: number | null;
}

function attributeTripId(
  tripWindows: SegmentChargeSessionsInput["tripWindows"],
  startedAt: number,
  endedAt: number,
): string | null {
  const byStart = tripWindows.find((w) => startedAt >= w.startsAtMs && startedAt <= w.endsAtMs);
  if (byStart) return byStart.tripId;
  const byEnd = tripWindows.find((w) => endedAt >= w.startsAtMs && endedAt <= w.endsAtMs);
  return byEnd ? byEnd.tripId : null;
}

function kWhFromBatteryDelta(
  startPct: number | null,
  endPct: number | null,
  capacityKwh: number | null | undefined,
): number {
  // No usable battery capacity on file, or a missing percent reading: the
  // kWh added genuinely cannot be estimated from a percent delta. NaN is
  // the "unknown measurement" sentinel (see isChargeSessionKwhUnknown) —
  // never a fabricated 0 presented as a real reading.
  if (!capacityKwh || capacityKwh <= 0 || startPct === null || endPct === null) return NaN;
  const deltaPct = endPct - startPct;
  return deltaPct > 0 ? (deltaPct / 100) * capacityKwh : 0;
}

/** True when a segmented ac_home session's kWh could not be estimated
 * (no battery capacity on file, or no percent reading at one of its edges)
 * — the honest-absence sentinel from kWhFromBatteryDelta above. dc_fast
 * sessions are never unknown: their kWh always comes from a reconciled
 * Tesla invoice, which is a real measured value. */
export function isChargeSessionKwhUnknown(session: DerivedChargeSession): boolean {
  return Number.isNaN(session.kWhAdded);
}

/** Copy shown wherever a session's kWh is unknown (isChargeSessionKwhUnknown)
 * — centralized so every surface renders the same honest guidance instead of
 * "0.0 kWh" or a blank. */
export const BATTERY_CAPACITY_MISSING_KWH_COPY =
  "Set battery capacity to estimate home-charging energy";

/** Human label for a session's kWh — the honest-absence copy above when
 * unknown, otherwise the measured/estimated figure to one decimal. */
export function formatSessionKwhLabel(session: DerivedChargeSession): string {
  if (isChargeSessionKwhUnknown(session)) return BATTERY_CAPACITY_MISSING_KWH_COPY;
  return `${session.kWhAdded.toFixed(1)} kWh`;
}

interface OpenSession {
  startedAt: number;
  lastObservedAt: number;
  startBatteryPct: number | null;
  lastBatteryPct: number | null;
  gapAffected: boolean;
}

/** Segments history into DC-fast vs. AC/home sessions. Does not attach
 * cost — see reconcileHomeRateCost / reconcileChargingInvoices below. */
export function segmentChargeSessions(
  input: SegmentChargeSessionsInput,
): DerivedChargeSession[] {
  const { vehicleId, tripWindows, batteryCapacityKwh } = input;
  const sorted = [...input.history].sort((a, b) => a.observedAt - b.observedAt);
  const sessions: DerivedChargeSession[] = [];
  let open: OpenSession | null = null;

  const close = (endedAt: number, endBatteryPct: number | null) => {
    if (!open) return;
    sessions.push({
      id: `${vehicleId}:${open.startedAt}`,
      tripId: attributeTripId(tripWindows, open.startedAt, endedAt),
      vehicleId,
      kind: "ac_home",
      startedAt: open.startedAt,
      endedAt,
      kWhAdded: kWhFromBatteryDelta(open.startBatteryPct, endBatteryPct, batteryCapacityKwh),
      gapAffected: open.gapAffected,
      costUsd: null,
      costProvenance: null,
    });
    open = null;
  };

  for (const point of sorted) {
    if (isChargingState(point.chargingState)) {
      if (!open) {
        open = {
          startedAt: point.observedAt,
          lastObservedAt: point.observedAt,
          startBatteryPct: point.batteryPct,
          lastBatteryPct: point.batteryPct,
          gapAffected: false,
        };
      } else {
        if (point.observedAt - open.lastObservedAt >= CHARGE_SESSION_GAP_MS) {
          // Stream gap spanned mid-session: never silently merge into a
          // fresh session or split — keep it one session, caveat it.
          open.gapAffected = true;
        }
        open.lastObservedAt = point.observedAt;
        open.lastBatteryPct = point.batteryPct ?? open.lastBatteryPct;
      }
    } else if (open) {
      // The closing (non-charging) point's own battery reading is the true
      // final value — e.g. "Complete" arrives with the topped-off percent
      // that the last "Charging" sample hadn't caught up to yet.
      close(point.observedAt, point.batteryPct ?? open.lastBatteryPct);
    }
  }
  if (open) {
    // The stream ended (or the query window closed) while still charging —
    // we can't confirm the session actually ended here, so caveat it too.
    open.gapAffected = true;
    close(open.lastObservedAt, open.lastBatteryPct);
  }

  return sessions;
}

export interface HomeRateCostInput {
  session: DerivedChargeSession;
  /** Owner-configured $/kWh; undefined/null renders the session kWh-only
   * (costUsd/costProvenance both null) — never a guessed price. */
  ratePerKwh: number | null;
}

/** Prices a home/AC session at kWh x the configured rate (costProvenance:
 * 'rate'). Returns the session unchanged (cost fields left null) when no
 * rate is configured, when the session isn't ac_home (DC-fast pricing only
 * ever comes from a reconciled invoice, never a guessed rate), or when the
 * session's kWh itself is unknown (isChargeSessionKwhUnknown — no battery
 * capacity on file, so there is nothing real to multiply by the rate). */
export function reconcileHomeRateCost(input: HomeRateCostInput): DerivedChargeSession {
  const { session, ratePerKwh } = input;
  if (session.kind !== "ac_home" || ratePerKwh === null || ratePerKwh <= 0) return session;
  if (isChargeSessionKwhUnknown(session)) return session;
  return { ...session, costUsd: session.kWhAdded * ratePerKwh, costProvenance: "rate" };
}

export interface ChargingInvoice {
  /** Opaque provider invoice id, for duplicate-invoice idempotency. */
  providerInvoiceId: string;
  vehicleId: string;
  startedAtMs: number;
  endedAtMs: number;
  kWhAdded: number;
  costUsd: number;
}

export interface ChargingInvoiceReconciliationResult {
  sessions: DerivedChargeSession[];
  /** Invoices whose window did not overlap any derived session —
   * attach to the vehicle, never fabricated onto a trip. */
  unmatchedInvoices: ChargingInvoice[];
}

function windowsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Reconciles synced Tesla charging-history invoices to derived sessions by
 * vehicle + time-window overlap (costProvenance: 'invoice'); a match also
 * promotes the session's kind to 'dc_fast' — see the module doc comment for
 * why the invoice, not the telemetry stream, is the DC/AC classifier.
 * Test matrix per the plan: matched, unmatched-invoice, partial-overlap,
 * duplicate-invoice idempotency (by providerInvoiceId), invoice-outside-trip. */
export function reconcileChargingInvoices(
  sessions: DerivedChargeSession[],
  invoices: ChargingInvoice[],
): ChargingInvoiceReconciliationResult {
  const seenInvoiceIds = new Set<string>();
  const dedupedInvoices = invoices.filter((invoice) => {
    if (seenInvoiceIds.has(invoice.providerInvoiceId)) return false;
    seenInvoiceIds.add(invoice.providerInvoiceId);
    return true;
  });

  const nextSessions = [...sessions];
  const matchedSessionIndexes = new Set<number>();
  const unmatchedInvoices: ChargingInvoice[] = [];

  for (const invoice of dedupedInvoices) {
    const matchIndex = nextSessions.findIndex((session, index) => (
      !matchedSessionIndexes.has(index) &&
      session.vehicleId === invoice.vehicleId &&
      windowsOverlap(session.startedAt, session.endedAt, invoice.startedAtMs, invoice.endedAtMs)
    ));
    if (matchIndex === -1) {
      unmatchedInvoices.push(invoice);
      continue;
    }
    matchedSessionIndexes.add(matchIndex);
    const session = nextSessions[matchIndex];
    nextSessions[matchIndex] = {
      ...session,
      kind: "dc_fast",
      kWhAdded: invoice.kWhAdded,
      costUsd: invoice.costUsd,
      costProvenance: "invoice",
    };
  }

  return { sessions: nextSessions, unmatchedInvoices };
}

export interface ManualChargeCostOverride {
  sessionId: string;
  costUsd: number;
  enteredBy: string;
}

/** Owner override/entry for a missing or wrong invoice on any session row
 * (costProvenance: 'manual'), labeled as owner-provided wherever rendered —
 * that labeling is a UI concern; this function only sets provenance. */
export function applyManualChargeCostOverride(
  session: DerivedChargeSession,
  override: ManualChargeCostOverride,
): DerivedChargeSession {
  if (session.id !== override.sessionId) return session;
  return { ...session, costUsd: override.costUsd, costProvenance: "manual" };
}

/** Read-time reconciliation of persisted owner overrides onto derived
 * sessions — apply this AFTER reconcileChargingInvoices so the precedence
 * is always manual > invoice > rate (a manual correction covers a missing
 * or wrong invoice, per the plan). Each override is matched and applied via
 * applyManualChargeCostOverride above; an override whose sessionId matches
 * nothing (e.g. the session fell outside the read window) is silently a
 * no-op, exactly like a single applyManualChargeCostOverride call. */
export function applyManualChargeCostOverrides(
  sessions: DerivedChargeSession[],
  overrides: ManualChargeCostOverride[],
): DerivedChargeSession[] {
  return overrides.reduce(
    (acc, override) => acc.map((session) => applyManualChargeCostOverride(session, override)),
    sessions,
  );
}

/** Re-keyed supercharging-unrecovered alert (design/eng Issue 7A): sums
 * DC-fast kWh for comparison against SUPERCHARGING_UNRECOVERED_KWH_THRESHOLD
 * (telemetry-policy.ts) — the threshold comparison itself lives in
 * alerts.ts, never inlined here. */
export function totalDcFastKwh(sessions: DerivedChargeSession[]): number {
  return sessions.reduce((sum, session) => (
    session.kind === "dc_fast" ? sum + session.kWhAdded : sum
  ), 0);
}

/**
 * Adapts real DerivedChargeSession rows onto the legacy ChargingSession
 * shape (remediation: wires real charge sessions into every surface that
 * still reads `OwnerSnapshot.chargingSessions` — the vehicle-details ledger,
 * the vehicles-list Energy tile, the trip-detail page's charging list, and
 * the health charts — without changing those surfaces' existing, CRITICAL-
 * regression-tested `ChargingSession` signatures. A null `tripId` (an
 * unreconciled invoice outside any trip window) maps to `""`, which never
 * matches a real trip id, so it stays vehicle-attributed only and is never
 * fabricated onto a trip. `costUsd` falls back to 0 (never a guessed price)
 * when a session has no known cost yet (`costProvenance: null`) — callers
 * that must distinguish "priced at $0" from "unpriced" should read
 * `DerivedChargeSession.costProvenance` directly instead. `kWhAdded`
 * similarly falls back to 0 when the session's kWh is an honest unknown
 * (isChargeSessionKwhUnknown, no battery capacity on file) — the legacy
 * `ChargingSession` shape has no room for an "unknown" sentinel, and 0 keeps
 * every legacy consumer's own sums (e.g. the lifetime Energy tile) from
 * ever inflating with a fabricated NaN; callers that need to render the
 * honest-absence copy instead should read `DerivedChargeSession` directly
 * via formatSessionKwhLabel, not this legacy adapter. */
export function toLegacyChargingSessions(sessions: DerivedChargeSession[]): ChargingSession[] {
  return sessions.map((session) => ({
    id: session.id,
    tripId: session.tripId ?? "",
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    location: session.kind === "dc_fast" ? "Supercharging" : "Home / AC charging",
    isSupercharger: session.kind === "dc_fast",
    kWhAdded: isChargeSessionKwhUnknown(session) ? 0 : session.kWhAdded,
    costUsd: session.costUsd ?? 0,
  }));
}
