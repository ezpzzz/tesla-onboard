/**
 * Pure seed-vehicle builder — directive-free (no "use client") so both the
 * client-only vehicle-state.ts store and the server-importable mock-data.ts
 * fixtures can share one source of truth for "veh-01" without either one
 * depending on the other.
 *
 * Deterministic: every field comes from hostConfig.car or the fixed
 * SEED_EPOCH literal below (no Date.now()), so server-rendered and
 * first-client-paint output byte-match.
 */

import { hostConfig } from "@/lib/config";
import type { Vehicle } from "./types";

// Fixed literal, not Date.now() — keeps the seed deterministic across every
// fresh load (server, first client paint, any browser that never wrote the
// key yet), matching mock-data.ts's "no relative-time math" rule.
export const SEED_EPOCH = Date.UTC(2026, 0, 1);

export function buildSeedVehicle(): Vehicle {
  return {
    id: "veh-01",
    displayName: `${hostConfig.car.year} ${hostConfig.car.model}`,
    model: hostConfig.car.model,
    trim: hostConfig.car.trim,
    year: hostConfig.car.year,
    color: hostConfig.car.color,
    shifter: hostConfig.car.shifter,
    licensePlate: null,
    vin: null,
    returnChargeLevelPct: null,
    notes: "",
    status: "active",
    createdAt: SEED_EPOCH,
    updatedAt: SEED_EPOCH,
  };
}
