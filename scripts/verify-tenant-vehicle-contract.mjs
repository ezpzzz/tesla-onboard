/**
 * Focused regression contract for the guest-safe vehicle snapshot.
 * Run with:
 *   node --experimental-strip-types scripts/verify-tenant-vehicle-contract.mjs
 */

import assert from "node:assert/strict";
import {
  DEFAULT_TENANT_CONFIG,
  featuresWithTenantConfig,
  normalizeTenantConfig,
  publishedTenantConfigFromFeatures,
  tenantConfigFromFeatures,
  tenantConfigPublicationIssues,
  tenantSetupCompletedAt,
} from "../lib/tenant-config.ts";
import {
  customTenantCar,
  tenantCarForSettingsDraft,
  tenantCarFromVehicle,
  tenantCarMatchesVehicle,
} from "../lib/tenant-vehicle.ts";
import { vehicleInputFromTesla } from "../lib/owner/import-mapping.ts";

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

const emptyCar = DEFAULT_TENANT_CONFIG.car;
assert.deepEqual(
  tenantCarForSettingsDraft(emptyCar, [vehicle]),
  snapshot,
  "the sole active imported vehicle should fill the first-run settings draft",
);
assert.equal(
  tenantCarForSettingsDraft(emptyCar, [vehicle, { ...vehicle, id: "veh-08", guestSourceId: "other" }]),
  emptyCar,
  "multiple active fleet vehicles must require an explicit owner choice",
);
assert.equal(
  tenantCarForSettingsDraft(emptyCar, [{ ...vehicle, status: "archived" }]),
  emptyCar,
  "archived vehicles must not fill the guest settings draft",
);

const staleLinked = { ...snapshot, color: "Old Fleet Paint", sourceVehicleUpdatedAt: 100 };
assert.deepEqual(
  tenantCarForSettingsDraft(staleLinked, [vehicle]),
  snapshot,
  "a linked draft should display the latest authoritative imported spec",
);

const customDraft = customTenantCar(snapshot, { color: "Owner Custom Paint" });
assert.equal(
  tenantCarForSettingsDraft(customDraft, [vehicle]),
  customDraft,
  "an owner-authored custom draft must not be overwritten by import",
);

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

assert.equal(DEFAULT_TENANT_CONFIG.companyName, "");
assert.equal(DEFAULT_TENANT_CONFIG.car.model, "");
assert.equal(DEFAULT_TENANT_CONFIG.car.trim, "");
assert.equal(DEFAULT_TENANT_CONFIG.car.year, 0);
assert.equal(DEFAULT_TENANT_CONFIG.car.color, "");
assert.equal(DEFAULT_TENANT_CONFIG.car.interior, null);
assert.deepEqual(DEFAULT_TENANT_CONFIG.houseRules, []);

const publishable = normalizeTenantConfig({
  version: 2,
  companyName: "Real Rentals",
  tagline: "A real workspace listing.",
  hostName: "Alex",
  hostPhone: "555-0101",
  supportEmail: "support@example.test",
  roadsidePhone: "555-0199",
  car: snapshot,
  rental: {
    keyAccess: "Phone key invitation before pickup.",
    chargeAccess: "Tesla Supercharging account.",
    chargingPolicy: "Guest pays actual charging cost.",
    returnChargeLevel: "80%",
    skipChargeOption: "Contact the host.",
    pickupNote: "Meet at the pickup location.",
    returnNote: "Lock the vehicle after return.",
    parkingNote: "Use the assigned space.",
  },
  houseRules: ["No smoking."],
});
assert.deepEqual(tenantConfigPublicationIssues(publishable), []);

const draftFeatures = featuresWithTenantConfig({}, publishable);
assert.ok(tenantConfigFromFeatures(draftFeatures));
assert.equal(tenantSetupCompletedAt(draftFeatures), null);
assert.equal(publishedTenantConfigFromFeatures(draftFeatures), null);

const publishedAt = 1_787_000_000_000;
const publishedFeatures = featuresWithTenantConfig(draftFeatures, publishable, { publishedAt });
assert.equal(tenantSetupCompletedAt(publishedFeatures), publishedAt);
assert.deepEqual(publishedTenantConfigFromFeatures(publishedFeatures), publishable);

const preservedFeatures = featuresWithTenantConfig(publishedFeatures, publishable);
assert.equal(tenantSetupCompletedAt(preservedFeatures), publishedAt);

const unlinked = { ...publishable, car: customTenantCar(publishable.car, {}) };
const invalidatedFeatures = featuresWithTenantConfig(publishedFeatures, unlinked);
assert.equal(tenantSetupCompletedAt(invalidatedFeatures), null);
assert.equal(publishedTenantConfigFromFeatures(invalidatedFeatures), null);

const legacyEnabledOnly = {
  onlyevs: { enabled: true, config: publishable },
};
assert.ok(tenantConfigFromFeatures(legacyEnabledOnly));
assert.equal(publishedTenantConfigFromFeatures(legacyEnabledOnly), null);

assert.throws(
  () => vehicleInputFromTesla({ id: "missing-year", model: "Model 3", source: "live" }),
  /did not provide a model year/,
);

console.log("tenant vehicle contract: pass");
