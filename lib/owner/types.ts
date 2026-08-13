/**
 * Owner-dashboard domain types.
 *
 * These describe the host's view of the fleet: drivers (guests, mock or the
 * real browser-local guest), trips, charging sessions, and the alerts derived
 * from them. Nothing here talks to a data source directly — see
 * `data-source.ts` for the fetch seam and `derive.ts` / `alerts.ts` for the
 * pure functions that turn a snapshot into what the UI renders.
 */

import type { ExperienceLevel } from "@/lib/tesla";
import type { ProgressSummary } from "@/lib/flow";

export type TripStatus = "upcoming" | "active" | "completed";

export type DriverStatus = "not-started" | "in-progress" | "ready" | "stalled";

export type VehicleStatus = "active" | "archived";

export interface Vehicle {
  id: string; // "veh-01", "veh-02", ... zero-padded sequential
  displayName: string;
  model: string;
  trim: string;
  year: number;
  color: string;
  shifter: "stalk" | "screen";
  licensePlate: string | null;
  vin: string | null;
  returnChargeLevelPct: number | null; // null = fall back to global policy
  notes: string;
  // Dedupe key from the Tesla side (vin, or the Tesla vehicle id when no vin
  // is available) for the vehicle this record was imported from. Optional/
  // nullable so pre-existing vehicles (manually added, or seeded) round-trip
  // unchanged; only import-mapping.ts sets it, on the Tesla -> Vehicle path.
  teslaImportKey?: string | null;
  status: VehicleStatus;
  createdAt: number;
  updatedAt: number;
}

export type VehicleInput = Omit<Vehicle, "id" | "status" | "createdAt" | "updatedAt">;

export interface VehicleStats {
  vehicleId: string;
  tripCount: number;
  milesRented: number;
  energyCostUsd: number;
  avgReturnChargePct: number | null;
}

export interface Driver {
  id: string; // mock rows "drv-01".."drv-08"; the real browser-local guest is ALWAYS "guest-local"
  name: string;
  email: string;
  source: "mock" | "guest-local";
  progress: ProgressSummary | null; // null = never opened onboarding
}

export interface ChargingSession {
  id: string; // "chg-01"..
  tripId: string;
  startedAt: number;
  endedAt: number;
  location: string; // e.g. "Supercharger - Gilroy, CA" or "Home charging (garage)"
  isSupercharger: boolean;
  kWhAdded: number;
  costUsd: number;
}

export interface Trip {
  id: string; // "trip-01".."trip-11"
  driverId: string | null; // null = unassigned; trip-11 MUST be seeded unassigned + upcoming (reserved for the ?trip= demo link)
  vehicleId: string; // "veh-01".. — which vehicle this trip was/is on
  status: TripStatus;
  startAt: number;
  endAt: number; // absolute epoch ms literals in mock data
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

// Re-exported so consumers of lib/owner/* don't need a second import from
// lib/tesla just for the experience-level union used on Driver progress.
export type { ExperienceLevel };
