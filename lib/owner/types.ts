/**
 * Owner-dashboard domain types.
 *
 * These describe the host's view of the fleet: real browser-local guests,
 * trips, charging sessions, vehicles, and the alerts derived
 * from them. Nothing here talks to a data source directly — see
 * `data-source.ts` for the fetch seam and `derive.ts` / `alerts.ts` for the
 * pure functions that turn a snapshot into what the UI renders.
 */

import type { ExperienceLevel } from "@/lib/tesla";
import type { ProgressSummary } from "@/lib/flow";
import type { BookendEdge } from "./access-types";

export type TripStatus = "upcoming" | "active" | "completed";

export type DriverStatus = "not-started" | "in-progress" | "ready" | "stalled";

export type VehicleStatus = "active" | "archived";
export type VehicleShifter = "stalk" | "screen" | "console";

/** Last Tesla-owned values, used to distinguish refreshable data from edits. */
export interface TeslaImportedSpec {
  displayName: string;
  model: string;
  trim: string;
  year: number;
  color: string;
  shifter: VehicleShifter;
  vin: string | null;
  wheelType: string | null;
  interior: string | null;
  teslaInteriorCode: string | null;
  teslaPaintCode: string | null;
}

export interface Vehicle {
  /** Database UUID in workspace mode; legacy veh-NN id in local demo mode. */
  id: string;
  /** Opaque, collision-resistant reference safe to publish in guest config. */
  guestSourceId: string;
  displayName: string;
  model: string;
  trim: string;
  year: number;
  color: string;
  shifter: VehicleShifter;
  licensePlate: string | null;
  vin: string | null;
  returnChargeLevelPct: number | null; // null = fall back to global policy
  notes: string;
  /** Optional Tesla configuration imported during the one-shot owner connect. */
  wheelType?: string | null;
  interior?: string | null;
  teslaInteriorCode?: string | null;
  teslaPaintCode?: string | null;
  teslaSpecSource?: "fleet-api" | null;
  /** Snapshot of Tesla-owned fields from the most recent import. */
  teslaImportedSpec?: TeslaImportedSpec | null;
  // Dedupe key from the Tesla side (vin, or the Tesla vehicle id when no vin
  // is available) for the vehicle this record was imported from. Optional/
  // nullable so pre-existing vehicles (manually added, or seeded) round-trip
  // unchanged; only import-mapping.ts sets it, on the Tesla -> Vehicle path.
  teslaImportKey?: string | null;
  status: VehicleStatus;
  /** Database-owned optimistic-concurrency token; absent in local demo mode. */
  remoteRevision?: number;
  createdAt: number;
  updatedAt: number;
}

export type VehicleInput = Omit<
  Vehicle,
  "id" | "guestSourceId" | "status" | "remoteRevision" | "createdAt" | "updatedAt"
>;

export interface VehicleStats {
  vehicleId: string;
  tripCount: number;
  milesRented: number;
  energyCostUsd: number;
  avgReturnChargePct: number | null;
}

export interface Driver {
  id: string; // the browser-local guest is always "guest-local"
  name: string;
  email: string;
  source: "live" | "guest-local";
  progress: ProgressSummary | null; // null = never opened onboarding
}

export interface ChargingSession {
  id: string;
  tripId: string;
  startedAt: number;
  endedAt: number;
  location: string; // e.g. "Supercharger - Gilroy, CA" or "Home charging (garage)"
  isSupercharger: boolean;
  kWhAdded: number;
  costUsd: number;
}

export interface Trip {
  id: string;
  driverId: string | null;
  vehicleId: string;
  status: TripStatus;
  startAt: number;
  endAt: number;
  pickupLocation?: string | null;
  returnLocation?: string | null;
  /** Real lifecycle state from the access worker; null means no grant exists. */
  accessStatus?: string | null;
  reminderLastSentAt?: number | null;
  odometerStartMi: number | null; // float, mirrors Fleet API vehicle_state.odometer; null for upcoming
  odometerEndMi: number | null; // null until completed
  batteryStartPct: number | null; // int, mirrors charge_state.battery_level
  batteryEndPct: number | null; // null until completed
  chargingSessionIds: string[];
}

export interface FleetStats {
  totalMilesRented: number;
  totalEnergyCostUsd: number;
  totalSuperchargingCostUsd: number;
  avgReturnChargePct: number | null;
  tripsBelowPolicy: number;
  tripCounts: Record<TripStatus, number>;
}

export type AlertKind =
  | "guest-not-started"
  | "guest-stalled"
  | "required-checklist-open"
  | "return-below-policy"
  | "supercharging-unrecovered";

export interface OwnerAlert {
  id: string;
  kind: AlertKind;
  severity: "warn" | "danger";
  message: string; // human sentence naming the driver/trip
  href: string; // deep link, e.g. "/owner/drivers/drv-03" or "/owner/trips/trip-05"
  driverId?: string;
  tripId?: string;
}

export interface OwnerSnapshot {
  drivers: Driver[];
  trips: Trip[];
  chargingSessions: ChargingSession[];
  vehicles: Vehicle[];
}

export interface OwnerDataSource {
  getSnapshot(): Promise<OwnerSnapshot>;
}

// --- Phase 7: durable guest identity -------------------------------------

/** Mirrors a row from public.onlyevs_guests. Replaces per-trip synthesized
 * driver ids on /owner/drivers once linking is wired up; Driver above is
 * untouched (additive). */
export interface Guest {
  id: string;
  displayName: string;
  createdAt: number;
  updatedAt: number;
}

/** The drivers-list/detail view model: identity first, then trip history,
 * then rollups (design review Issue 1, 1A — disputes reference trips, not
 * averages). `possibleDuplicate` is a hint, never a claim of completeness —
 * set only per the Phase 3 key-stability validation outcome. */
export interface GuestTripSummary {
  guest: Guest;
  tripIds: string[];
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  possibleDuplicate: boolean;
}

// --- Phase 3: charging cost attribution -----------------------------------

export type ChargeSessionKind = "ac_home" | "dc_fast";

/** Every dollar amount on a charge session must carry one of these. Never
 * a guessed price: an AC/home session with no configured $/kWh rate renders
 * kWh-only (costUsd/costProvenance both null), it never falls back to a
 * different provenance silently. */
export type ChargeSessionCostProvenance = "invoice" | "rate" | "manual";

/** Derived from DetailedChargeState transitions in vehicle_stats_history —
 * distinct from the legacy `ChargingSession` above, which this replaces once
 * derivation ships (kept additive; not removing ChargingSession here). A
 * session is `gapAffected` when its window crossed a stream gap
 * >= CHARGE_SESSION_GAP_MS (lib/owner/telemetry-policy.ts) rather than being
 * silently merged or split. */
export interface DerivedChargeSession {
  id: string;
  /** null = an unreconciled Tesla invoice outside any trip window; attaches
   * to the vehicle only, never fabricated onto a trip. */
  tripId: string | null;
  vehicleId: string;
  kind: ChargeSessionKind;
  startedAt: number;
  endedAt: number;
  kWhAdded: number;
  gapAffected: boolean;
  costUsd: number | null;
  costProvenance: ChargeSessionCostProvenance | null;
}

// --- Phase 6: immutable trip evidence packet ------------------------------

export interface EvidencePacketBookend {
  edge: BookendEdge;
  odometerMi: number | null;
  odometerObservedAt: number | null;
  batteryPct: number | null;
  batteryObservedAt: number | null;
  stale: boolean;
}

export interface EvidencePacketChargeSessionSummary {
  kind: ChargeSessionKind;
  kWhAdded: number;
  gapAffected: boolean;
}

/**
 * NEVER add a coordinate/lat-lng field to this type. The packet is
 * deliberately safe to render anywhere owner-side (Inbox card, reminder
 * email) without touching the sealed location table — out-of-area is an
 * occurrence count only, by design (Phase 6).
 */
export interface EvidencePacketPayload {
  tripId: string;
  vehicleId: string;
  guestName: string;
  startsAt: number;
  endsAt: number;
  /** Whichever of start/end were captured; absent edge means "not captured
   * at pickup/return", never a fabricated or carried-forward value. */
  bookends: EvidencePacketBookend[];
  milesDriven: number | null;
  milesAllowance: number | null;
  batteryDeltaPct: number | null;
  batteryPolicyPct: number | null;
  chargeSessions: EvidencePacketChargeSessionSummary[];
  outOfAreaOccurrences: number;
}

/** Mirrors a row from public.onlyevs_trip_evidence_packets. Insert-only and
 * versioned: a correction is a new row with `version` = previous max + 1 for
 * the same `tripId` (unique(trip_id, version)), never a mutation of this
 * one. The current packet for a trip is always the row with the highest
 * `version`. */
export interface EvidencePacket {
  id: string;
  tripId: string;
  version: number;
  composedAt: number;
  payload: EvidencePacketPayload;
}

// Re-exported so consumers of lib/owner/* don't need a second import from
// lib/tesla just for the experience-level union used on Driver progress.
export type { ExperienceLevel };
