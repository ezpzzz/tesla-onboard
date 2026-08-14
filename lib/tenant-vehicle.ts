import type { Vehicle } from "./owner/types";
import type { TenantCarConfig } from "./tenant-config";

/**
 * Materialize only guest-safe presentation fields from the private owner
 * vehicle record. VIN, plate, notes, and operational data never enter the
 * public workspace_branding feature document.
 */
export function tenantCarFromVehicle(vehicle: Vehicle): TenantCarConfig {
  return {
    sourceVehicleId: vehicle.guestSourceId,
    sourceVehicleUpdatedAt: vehicle.updatedAt,
    model: vehicle.model,
    trim: vehicle.trim,
    year: vehicle.year,
    color: vehicle.color,
    shifter: vehicle.shifter,
    wheelType: vehicle.wheelType ?? null,
    interior: vehicle.interior ?? null,
    teslaInteriorCode: vehicle.teslaInteriorCode ?? null,
    teslaPaintCode: vehicle.teslaPaintCode ?? null,
  };
}

export function tenantCarMatchesVehicle(
  car: TenantCarConfig,
  vehicle: Vehicle,
): boolean {
  const current = tenantCarFromVehicle(vehicle);
  return (Object.keys(current) as Array<keyof TenantCarConfig>)
    .every((key) => Object.is(car[key], current[key]));
}

/** Manual edits are explicit custom configuration, not a claim that the
 * snapshot still represents the previously selected fleet record. */
export function customTenantCar(
  car: TenantCarConfig,
  patch: Partial<TenantCarConfig>,
): TenantCarConfig {
  return {
    ...car,
    ...patch,
    sourceVehicleId: null,
    sourceVehicleUpdatedAt: null,
  };
}
