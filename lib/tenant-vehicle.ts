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

function hasGuestVehicleDetails(car: TenantCarConfig): boolean {
  return Boolean(
    car.model.trim()
    || car.trim.trim()
    || car.year
    || car.color.trim()
    || car.wheelType?.trim()
    || car.interior?.trim()
    || car.teslaInteriorCode?.trim()
    || car.teslaPaintCode?.trim(),
  );
}

/**
 * Resolve the guest-vehicle snapshot shown when the settings form first
 * opens. A linked active fleet record is authoritative and should display
 * its latest imported Tesla spec. A completely empty first-run draft can
 * safely select the sole active fleet vehicle. Multiple active vehicles are
 * intentionally left unselected because guessing would publish the wrong car
 * to a renter. Existing custom drafts are never overwritten.
 */
export function tenantCarForSettingsDraft(
  car: TenantCarConfig,
  vehicles: Vehicle[],
): TenantCarConfig {
  if (car.sourceVehicleId) {
    const linked = vehicles.find((vehicle) =>
      vehicle.guestSourceId === car.sourceVehicleId && vehicle.status === "active"
    );
    return linked ? tenantCarFromVehicle(linked) : car;
  }

  if (hasGuestVehicleDetails(car)) return car;

  const active = vehicles.filter((vehicle) => vehicle.status === "active");
  return active.length === 1 ? tenantCarFromVehicle(active[0]) : car;
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
