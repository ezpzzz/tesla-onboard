"use client";

/**
 * Read-time charge-session derivation (Phase 3, TODO 2 choice C, mechanism
 * Issue 9 choice 9B — remediation for the gap where
 * fetchWorkspaceOperationalSnapshot/EmptyOwnerDataSource always returned
 * chargingSessions: [] and segmentChargeSessions was only ever invoked
 * inside the worker's evidence-packet composer).
 *
 * D2 remediation ("Server-side RPC"): fetchWorkspaceChargeSessions below no
 * longer selects raw onlyevs_vehicle_stats_history rows and re-segments
 * them client-side on every poll — that raw-select-then-segment path
 * shipped every history row for the workspace's whole trip window (bounded
 * only by the table's 13-month retention) to the browser and re-ran
 * segmentChargeSessions on every 30s poll. It now calls the hardened
 * public.get_onlyevs_charge_sessions() RPC (introduced in the same
 * migration as this table), which performs the identical segmentation
 * server-side with window functions, internally clamps its window to a
 * sane horizon, and hard-limits its output regardless of what the caller
 * passes.
 *
 * IMPORTANT — lockstep requirement: that RPC's SQL segmentation and
 * lib/owner/charge-sessions.ts's segmentChargeSessions() (still used
 * directly by the worker's evidence-packet composer, untouched by this
 * remediation) must be kept in lockstep. A change to either
 * implementation's session-boundary rules (charging-state edges,
 * CHARGE_SESSION_GAP_MS gapAffected rule, trip attribution, battery-delta
 * kWh estimate) must be mirrored in the other by hand.
 *
 * What stays client-side, unchanged: pricing ac_home sessions at the
 * owner's configured $/kWh rate, reconciling synced Tesla charging-history
 * invoices onto dc_fast sessions by vehicle + time-window overlap, and
 * finally applying any manager-entered manual cost corrections (always
 * last, so manual > invoice > rate) — exactly the same
 * reconcileHomeRateCost / reconcileChargingInvoices /
 * applyManualChargeCostOverrides calls as before, just fed from the RPC's
 * output instead of a client-side segmentChargeSessions call.
 *
 * fetchVehicleStatsHistoryRaw and fetchVehicleBatteryCapacitiesKwh below are
 * no longer called by fetchWorkspaceChargeSessions (the RPC does its own
 * server-side battery-capacity join) but are kept as standalone, tested
 * primitives — history-repository.ts's chart reads still go through the
 * separate bucketed RPC, never this raw select, per that module's own
 * header comment.
 */

import { createClient } from "@/lib/supabase/client";
import type { VehicleWorkspaceScope } from "./vehicle-repository";
import type { VehicleStatsHistoryPoint } from "./access-types";
import {
  applyManualChargeCostOverrides,
  reconcileChargingInvoices,
  reconcileHomeRateCost,
  type ChargingInvoice,
  type ManualChargeCostOverride,
} from "./charge-sessions";
import { HISTORY_RETENTION_MS } from "./telemetry-policy";
import type { DerivedChargeSession, Trip } from "./types";

interface HistoryRow {
  vehicle_id: string;
  observed_at: string;
  battery_pct: number | null;
  estimated_range_mi: number | null;
  odometer_mi: number | null;
  charging_state: string | null;
  locked: boolean | null;
}

/** Bounded, direct read of raw history rows for the whole workspace since
 * `sinceMs` — see the module doc comment for why this bypasses the bucketed
 * chart RPC. Honest empty on a not-yet-applied schema, matching every other
 * repository in this lane. */
export async function fetchVehicleStatsHistoryRaw(
  scope: VehicleWorkspaceScope,
  sinceMs: number,
): Promise<VehicleStatsHistoryPoint[]> {
  const { data, error } = await createClient()
    .from("onlyevs_vehicle_stats_history")
    .select("vehicle_id,observed_at,battery_pct,estimated_range_mi,odometer_mi,charging_state,locked")
    .eq("workspace_id", scope.workspaceId)
    .gte("observed_at", new Date(sinceMs).toISOString())
    .order("observed_at", { ascending: true });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as HistoryRow[]).map((row) => ({
    vehicleId: row.vehicle_id,
    observedAt: Date.parse(row.observed_at),
    batteryPct: row.battery_pct,
    estimatedRangeMi: row.estimated_range_mi,
    odometerMi: row.odometer_mi,
    chargingState: row.charging_state,
    locked: row.locked,
  }));
}

/** Owner's configured $/kWh home rate, or null when unset or the column
 * doesn't exist in this workspace yet — mirrors cost-rate-setting.tsx's own
 * missing-column handling. Never throws: an unpriceable rate read must never
 * take down session derivation, it just means ac_home sessions stay
 * kWh-only (7A's unit rule). */
export async function fetchHomeChargeRatePerKwh(scope: VehicleWorkspaceScope): Promise<number | null> {
  const { data, error } = await createClient()
    .from("workspace_branding")
    .select("home_charge_rate_usd_per_kwh")
    .eq("workspace_id", scope.workspaceId)
    .eq("shop_slug", scope.shopSlug)
    .maybeSingle<{ home_charge_rate_usd_per_kwh: number | null }>();
  if (error) return null;
  return data?.home_charge_rate_usd_per_kwh ?? null;
}

interface InvoiceRow {
  provider_invoice_id: string;
  vehicle_id: string;
  started_at: string;
  ended_at: string;
  kwh_added: number;
  cost_usd: number;
}

/** Synced Tesla charging-history invoices since `sinceMs` (public.onlyevs_
 * charging_invoices, worker-written only — see services/onlyevs-worker/
 * index.ts's syncChargingInvoices). Honest empty pre-migration or when the
 * founder hasn't re-consented the vehicle_charging_cmds scope yet, in which
 * case the table simply stays empty and every session renders kWh-only. */
export async function fetchWorkspaceChargingInvoices(
  scope: VehicleWorkspaceScope,
  sinceMs: number,
): Promise<ChargingInvoice[]> {
  const { data, error } = await createClient()
    .from("onlyevs_charging_invoices")
    .select("provider_invoice_id,vehicle_id,started_at,ended_at,kwh_added,cost_usd")
    .eq("workspace_id", scope.workspaceId)
    .gte("started_at", new Date(sinceMs).toISOString());
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as InvoiceRow[]).map((row) => ({
    providerInvoiceId: row.provider_invoice_id,
    vehicleId: row.vehicle_id,
    startedAtMs: Date.parse(row.started_at),
    endedAtMs: Date.parse(row.ended_at),
    kWhAdded: row.kwh_added,
    costUsd: row.cost_usd,
  }));
}

interface VehicleBatteryCapacityRow {
  id: string;
  battery_capacity_kwh: number | null;
}

/** Owner-set battery capacity (kWh) per vehicle in this workspace, keyed by
 * vehicle id — used only to estimate a segmented ac_home session's kWhAdded
 * from its battery_pct delta (segmentChargeSessions's kWhFromBatteryDelta,
 * G2 remediation). A vehicle absent from the map (capacity never set, zero/
 * negative, or the column doesn't exist yet in this workspace) renders its
 * ac_home sessions' kWh as an honest unknown measurement
 * (isChargeSessionKwhUnknown) rather than a guessed capacity. Honest empty
 * on a missing-column/table error, mirroring every other repository
 * function in this lane.
 */
export async function fetchVehicleBatteryCapacitiesKwh(
  scope: VehicleWorkspaceScope,
): Promise<Map<string, number>> {
  const { data, error } = await createClient()
    .from("onlyevs_vehicles")
    .select("id,battery_capacity_kwh")
    .eq("workspace_id", scope.workspaceId)
    .eq("shop_slug", scope.shopSlug);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205" || error.code === "42703") return new Map();
    throw new Error(error.message);
  }
  const capacities = new Map<string, number>();
  for (const row of (data ?? []) as VehicleBatteryCapacityRow[]) {
    if (row.battery_capacity_kwh !== null && row.battery_capacity_kwh > 0) {
      capacities.set(row.id, row.battery_capacity_kwh);
    }
  }
  return capacities;
}

interface ManualChargeCostEntryRow {
  vehicle_id: string;
  session_started_at: string;
  cost_usd: number;
  created_at: string;
}

/** Latest manager-entered cost correction per (vehicle, session start) since
 * `sinceMs`. onlyevs_manual_charge_cost_entries is insert-only with no
 * idempotency constraint on that pair (unlike source_message_id/
 * provider_invoice_id elsewhere in this schema) — a re-correction is always
 * an additional row, and "current" means the highest created_at for the
 * pair, mirroring the evidence-packet insert-only/highest-version
 * correction model used elsewhere in this build. Each row's key is built to
 * match segmentChargeSessions's own session.id construction
 * (`${vehicleId}:${startedAtMs}`) so applyManualChargeCostOverrides can
 * match by identity. Honest empty pre-migration, matching every other
 * repository function in this lane.
 */
export async function fetchWorkspaceManualChargeCostOverrides(
  scope: VehicleWorkspaceScope,
  sinceMs: number,
): Promise<ManualChargeCostOverride[]> {
  const { data, error } = await createClient()
    .from("onlyevs_manual_charge_cost_entries")
    .select("vehicle_id,session_started_at,cost_usd,created_at")
    .eq("workspace_id", scope.workspaceId)
    .gte("session_started_at", new Date(sinceMs).toISOString())
    .order("created_at", { ascending: true });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  // Ascending order + Map overwrite-on-set means the surviving value per key
  // is always the row with the greatest created_at — the latest correction.
  const latestByKey = new Map<string, ManualChargeCostEntryRow>();
  for (const row of (data ?? []) as ManualChargeCostEntryRow[]) {
    latestByKey.set(`${row.vehicle_id}:${row.session_started_at}`, row);
  }
  return Array.from(latestByKey.values()).map((row) => ({
    sessionId: `${row.vehicle_id}:${Date.parse(row.session_started_at)}`,
    costUsd: row.cost_usd,
    enteredBy: "owner",
  }));
}

export interface SaveManualChargeCostOverrideInput {
  vehicleId: string;
  /** Null when the session isn't attributed to a trip (unreconciled/
   * vehicle-only), mirroring onlyevs_charging_invoices' own attribution. */
  tripId: string | null;
  sessionStartedAtMs: number;
  costUsd: number;
}

/** Persists a manager-entered charge-session cost correction. RLS already
 * grants managers full insert access on onlyevs_manual_charge_cost_entries
 * under has_minimum_role (see the accompanying migration's
 * onlyevs_manual_charge_cost_managers_all policy) — same direct-client-write
 * pattern as cost-rate-setting.tsx's rate save and vehicle-form.tsx's home-
 * area save, no new API route needed. Insert-only: a re-correction of the
 * same session is a second row; fetchWorkspaceManualChargeCostOverrides
 * above always reads back the latest by created_at. `created_by` defaults to
 * auth.uid() at the database level, so this call never needs to know the
 * current user's id itself.
 */
export async function saveManualChargeCostOverride(
  scope: VehicleWorkspaceScope,
  input: SaveManualChargeCostOverrideInput,
): Promise<void> {
  const { error } = await createClient()
    .from("onlyevs_manual_charge_cost_entries")
    .insert({
      workspace_id: scope.workspaceId,
      vehicle_id: input.vehicleId,
      trip_id: input.tripId,
      session_started_at: new Date(input.sessionStartedAtMs).toISOString(),
      cost_usd: input.costUsd,
    });
  if (error) throw new Error(error.message);
}

/** Earliest point worth reading history from: the earliest linked trip's
 * start, capped by the table's own 13-month retention so a workspace with
 * very old trips never asks for rows that can't exist. Null when there are
 * no trips at all (nothing to derive sessions against). */
function earliestRelevantSinceMs(trips: Pick<Trip, "startAt">[]): number | null {
  if (trips.length === 0) return null;
  const earliestTripStart = Math.min(...trips.map((t) => t.startAt));
  return Math.max(earliestTripStart, Date.now() - HISTORY_RETENTION_MS);
}

interface ChargeSessionRpcRow {
  vehicle_id: string;
  trip_id: string | null;
  started_at: string;
  ended_at: string;
  kwh_added: number | null;
  gap_affected: boolean;
  kind: string;
}

/** Server-side segmented sessions via public.get_onlyevs_charge_sessions
 * (D2) — see the module doc comment for the lockstep requirement with
 * lib/owner/charge-sessions.ts's segmentChargeSessions(). Every row is kind
 * 'ac_home' (the RPC's own pre-reconciliation default); cost fields always
 * come back null/unset here, exactly like a freshly segmented session
 * before reconcileHomeRateCost/reconcileChargingInvoices/
 * applyManualChargeCostOverrides run below. `kwh_added: null` (no battery
 * capacity on file server-side, or a missing percent reading at a session
 * edge) maps to the NaN "unknown measurement" sentinel
 * isChargeSessionKwhUnknown expects — never a fabricated 0. Honest empty
 * pre-migration, matching every other RPC-backed repository function in
 * this lane (e.g. history-repository.ts's fetchVehicleStatsHistoryBuckets). */
async function fetchServerSegmentedChargeSessions(
  scope: VehicleWorkspaceScope,
  sinceMs: number,
  untilMs: number,
): Promise<DerivedChargeSession[]> {
  const { data, error } = await createClient().rpc("get_onlyevs_charge_sessions", {
    p_workspace_id: scope.workspaceId,
    p_since: new Date(sinceMs).toISOString(),
    p_until: new Date(untilMs).toISOString(),
  });
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as ChargeSessionRpcRow[]).map((row) => ({
    id: `${row.vehicle_id}:${Date.parse(row.started_at)}`,
    tripId: row.trip_id,
    vehicleId: row.vehicle_id,
    kind: row.kind as DerivedChargeSession["kind"],
    startedAt: Date.parse(row.started_at),
    endedAt: Date.parse(row.ended_at),
    kWhAdded: row.kwh_added === null ? NaN : row.kwh_added,
    gapAffected: row.gap_affected,
    costUsd: null,
    costProvenance: null,
  }));
}

/**
 * Workspace-wide charge-session derivation, read-time only. Segmentation
 * itself now happens server-side (fetchServerSegmentedChargeSessions, D2);
 * this function's own job is unchanged: price ac_home sessions at the
 * configured rate, reconcile any synced invoices onto dc_fast sessions, and
 * apply manual cost corrections last. `trips` supplies both the read window
 * (via earliestRelevantSinceMs) and — server-side inside the RPC — each
 * session's trip-boundary attribution.
 */
export async function fetchWorkspaceChargeSessions(
  scope: VehicleWorkspaceScope,
  trips: Pick<Trip, "id" | "vehicleId" | "startAt" | "endAt">[],
): Promise<DerivedChargeSession[]> {
  const sinceMs = earliestRelevantSinceMs(trips);
  if (sinceMs === null) return [];

  const [segmented, ratePerKwh, invoices, manualOverrides] = await Promise.all([
    fetchServerSegmentedChargeSessions(scope, sinceMs, Date.now()),
    fetchHomeChargeRatePerKwh(scope),
    fetchWorkspaceChargingInvoices(scope, sinceMs),
    fetchWorkspaceManualChargeCostOverrides(scope, sinceMs),
  ]);

  const priced = segmented.map((session) => reconcileHomeRateCost({ session, ratePerKwh }));
  const reconciled = reconcileChargingInvoices(priced, invoices).sessions;
  // Manual corrections apply last so the effective precedence is always
  // manual > invoice > rate (a manual entry covers a missing/wrong invoice).
  return applyManualChargeCostOverrides(reconciled, manualOverrides);
}

/** Same derivation scoped to one vehicle and one trip window (e.g. the trip
 * detail page) — avoids fetching every other vehicle's history when only
 * one trip's sessions are needed. */
export async function fetchTripChargeSessions(
  scope: VehicleWorkspaceScope,
  trip: Pick<Trip, "id" | "vehicleId" | "startAt" | "endAt">,
): Promise<DerivedChargeSession[]> {
  return fetchWorkspaceChargeSessions(scope, [trip]);
}
