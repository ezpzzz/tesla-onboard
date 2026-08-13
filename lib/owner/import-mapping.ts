/**
 * Pure mapping between a Tesla Fleet API vehicle (as read into a
 * `TeslaProfile`) and this app's own `Vehicle` record. No state, no
 * localStorage — the setup wizard's Import step is the only caller, and it
 * owns committing the result via useVehicleState().
 */

import type { TeslaVehicle } from "@/lib/tesla";
import type {
  TeslaImportedSpec,
  Vehicle,
  VehicleInput,
  VehicleShifter,
} from "./types";

/** Stable dedupe key for a Tesla vehicle: VIN when we have one (live mode,
 * or a mock persona that sets it), otherwise the Tesla-side id. */
export function teslaKeyOf(tv: TeslaVehicle): string {
  return tv.vin ?? String(tv.id);
}

/** Model 3 went stalk-less ("Highland") in the 2024 refresh; Model Y follows
 * suit from the 2025 refresh. S/X keep the column stalk. Anything else
 * (unknown model, or a VIN year we couldn't decode) defaults to screen, the
 * more common configuration across the current lineup. */
function shifterFor(model: string, year: number): VehicleShifter {
  if (model === "Model 3" && year >= 2024) return "screen";
  if (model === "Model Y" && year >= 2025) return "screen";
  if (model === "Model S" || model === "Model X") {
    return year >= 2021 ? "screen" : "stalk";
  }
  if (model === "Roadster") return "console";
  return "screen";
}

function importedSpec(input: VehicleInput): TeslaImportedSpec {
  return {
    displayName: input.displayName,
    model: input.model,
    trim: input.trim,
    year: input.year,
    color: input.color,
    shifter: input.shifter,
    vin: input.vin,
    wheelType: input.wheelType ?? null,
    interior: input.interior ?? null,
    teslaInteriorCode: input.teslaInteriorCode ?? null,
    teslaPaintCode: input.teslaPaintCode ?? null,
  };
}

export function vehicleInputFromTesla(tv: TeslaVehicle, fallbackYear: number): VehicleInput {
  const year = tv.year ?? fallbackYear;
  const displayName = tv.displayName?.trim() || `${year} ${tv.model}`;
  const input: VehicleInput = {
    displayName,
    model: tv.model,
    trim: tv.trim ?? "",
    year,
    color: tv.color ?? "",
    shifter: shifterFor(tv.model, year),
    licensePlate: null,
    vin: tv.vin ?? null,
    returnChargeLevelPct: null,
    notes: "",
    wheelType: tv.wheelType ?? null,
    interior: tv.interior ?? null,
    teslaInteriorCode: tv.interiorCode ?? null,
    teslaPaintCode: tv.paintCode ?? null,
    teslaSpecSource: tv.specSource ?? null,
    teslaImportKey: teslaKeyOf(tv),
  };
  return { ...input, teslaImportedSpec: importedSpec(input) };
}

/** Re-importing a vehicle already on the fleet shouldn't clobber whatever the
 * host has since filled in by hand — keep their trim/color/plate/notes/pct,
 * only refreshing the fields Tesla actually reports. */
export function mergePreservingOwnerFields(fresh: VehicleInput, existing: Vehicle): VehicleInput {
  const prior = existing.teslaImportedSpec;
  const ownerValue = <K extends keyof TeslaImportedSpec>(key: K): TeslaImportedSpec[K] => {
    const current = existing[key];
    if (prior && Object.is(current, prior[key])) return importedSpec(fresh)[key];
    // Pre-provenance imports can still accept newly available Fleet fields,
    // while any value the owner already supplied remains untouched.
    if (!prior && (current === undefined || current === null || current === "")) {
      return importedSpec(fresh)[key];
    }
    return (current ?? null) as TeslaImportedSpec[K];
  };
  const merged = {
    ...fresh,
    displayName: ownerValue("displayName"),
    model: ownerValue("model"),
    trim: ownerValue("trim"),
    year: ownerValue("year"),
    color: ownerValue("color"),
    shifter: ownerValue("shifter"),
    vin: ownerValue("vin"),
    wheelType: ownerValue("wheelType"),
    interior: ownerValue("interior"),
    teslaInteriorCode: ownerValue("teslaInteriorCode"),
    teslaPaintCode: ownerValue("teslaPaintCode"),
    teslaSpecSource: fresh.teslaSpecSource,
    teslaImportedSpec: importedSpec(fresh),
    teslaImportKey: existing.teslaImportKey ?? fresh.teslaImportKey,
    licensePlate: existing.licensePlate,
    returnChargeLevelPct: existing.returnChargeLevelPct,
    notes: existing.notes,
  };
  return merged;
}
