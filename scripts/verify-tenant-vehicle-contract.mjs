/**
 * Focused regression contract for the guest-safe vehicle snapshot.
 * Run with:
 *   node --experimental-strip-types scripts/verify-tenant-vehicle-contract.mjs
 */

import assert from "node:assert/strict";
import { normalizeTenantConfig } from "../lib/tenant-config.ts";
import {
  customTenantCar,
  tenantCarFromVehicle,
  tenantCarMatchesVehicle,
} from "../lib/tenant-vehicle.ts";

const vehicle = {
  id: "veh-07",
  guestSourceId: "a9f7a34c-47d8-4aa7-b782-8bedcb3f55bb",
  displayName: "Black Model 3",
  model: "Model 3",
  trim: "Performance",
  year: 2024,
  color: "Diamond Black",
  shifter: "screen",
  licensePlate: "PRIVATE",
  vin: "5YJPRIVATE",
  returnChargeLevelPct: 80,
  notes: "PRIVATE",
  wheelType: '20" Warp Wheels',
  interior: "White Interior",
  teslaInteriorCode: "IPW4",
  teslaPaintCode: "PX02",
  status: "active",
  createdAt: 100,
  updatedAt: 200,
};

const snapshot = tenantCarFromVehicle(vehicle);
assert.equal(snapshot.sourceVehicleId, vehicle.guestSourceId);
assert.equal(snapshot.sourceVehicleUpdatedAt, vehicle.updatedAt);
assert.equal(snapshot.color, "Diamond Black");
assert.equal("vin" in snapshot, false);
assert.equal("licensePlate" in snapshot, false);
assert.equal("notes" in snapshot, false);
assert.equal(tenantCarMatchesVehicle(snapshot, vehicle), true);
assert.equal(tenantCarMatchesVehicle(snapshot, { ...vehicle, wheelType: '18" Photon Wheels' }), false);

const custom = customTenantCar(snapshot, { color: "Ultra Red" });
assert.equal(custom.color, "Ultra Red");
assert.equal(custom.sourceVehicleId, null);
assert.equal(custom.sourceVehicleUpdatedAt, null);

const migrated = normalizeTenantConfig({
  version: 1,
  car: {
    model: "Model 3",
    trim: "74",
    year: 2018,
    color: "Solid Black",
    sourceVehicleUpdatedAt: 999,
  },
});
assert.equal(migrated.version, 2);
assert.equal(migrated.car.sourceVehicleId, null);
assert.equal(migrated.car.sourceVehicleUpdatedAt, null);

console.log("tenant vehicle contract: pass");
