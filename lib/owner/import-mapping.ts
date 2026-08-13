/**
 * Pure mapping between a Tesla Fleet API vehicle (as read into a
 * `TeslaProfile`) and this app's own `Vehicle` record. No state, no
 * localStorage — the setup wizard's Import step is the only caller, and it
 * owns committing the result via useVehicleState().
 */

import type { TeslaVehicle } from "@/lib/tesla";
import type { Vehicle, VehicleInput } from "./types";

/** Stable dedupe key for a Tesla vehicle: VIN when we have one (live mode,
 * or a mock persona that sets it), otherwise the Tesla-side id. */
export function teslaKeyOf(tv: TeslaVehicle): string {
  return tv.vin ?? String(tv.id);
}

/** Model 3 went stalk-less ("Highland") in the 2024 refresh; Model Y follows
 * suit from the 2025 refresh. S/X keep the column stalk. Anything else
 * (unknown model, or a VIN year we couldn't decode) defaults to screen, the
 * more common configuration across the current lineup. */
function shifterFor(model: string, year: number): "stalk" | "screen" {
  if (model === "Model 3" && year >= 2024) return "screen";
  if (model === "Model Y" && year >= 2025) return "screen";
  if (model === "Model S" || model === "Model X") return "stalk";
  return "screen";
}

export function vehicleInputFromTesla(tv: TeslaVehicle, fallbackYear: number): VehicleInput {
  const year = tv.year ?? fallbackYear;
  const displayName = tv.displayName?.trim() || `${year} ${tv.model}`;
  return {
    displayName,
    model: tv.model,
    trim: "",
    year,
    color: "",
    shifter: shifterFor(tv.model, year),
    licensePlate: null,
    vin: tv.vin ?? null,
    returnChargeLevelPct: null,
    notes: "",
    teslaImportKey: teslaKeyOf(tv),
  };
}

/** Re-importing a vehicle already on the fleet shouldn't clobber whatever the
 * host has since filled in by hand — keep their trim/color/plate/notes/pct,
 * only refreshing the fields Tesla actually reports. */
export function mergePreservingOwnerFields(fresh: VehicleInput, existing: Vehicle): VehicleInput {
  return {
    ...fresh,
    trim: existing.trim,
    color: existing.color,
    licensePlate: existing.licensePlate,
    returnChargeLevelPct: existing.returnChargeLevelPct,
    notes: existing.notes,
  };
}
