/**
 * Focused regression contract for raw Tesla Fleet API configuration names.
 * Run with:
 *   pnpm dlx tsx scripts/verify-tesla-media-contract.mjs
 */

import assert from "node:assert/strict";
import { parseTeslaVehicleConfig } from "../lib/tesla-vehicle-config.ts";
import { resolveTeslaVehicleMedia } from "../lib/vehicle-media.ts";

function compositorOptions(media) {
  assert.ok(media, "expected exact Tesla media");
  assert.equal(media.provider, "tesla");
  assert.equal(media.kind, "vehicle-configurator");
  const url = new URL(media.imageUrl);
  assert.equal(url.hostname, "static-assets.tesla.com");
  assert.equal(url.searchParams.get("view"), "STUD_FRONT34");
  return url.searchParams.get("options");
}

const longRange = parseTeslaVehicleConfig({
  car_type: "model3",
  trim_badging: "74",
  exterior_color: "SolidBlack",
  wheel_type: "Glider18",
  interior_trim_type: "White2",
}, "Model 3");
assert.equal(longRange.trim, "Long Range RWD");
assert.equal(longRange.color, "Solid Black");
assert.equal(longRange.wheelType, '18" Photon Wheels');
assert.equal(longRange.interior, "White Interior");

assert.equal(
  compositorOptions(resolveTeslaVehicleMedia(
    "Model 3",
    "Solid Black",
    "74",
    'Glider 18"',
    2024,
    "White 2",
  )),
  "$MT369,$PBSB,$W38A,$IPW2",
);

const performance = parseTeslaVehicleConfig({
  car_type: "model3",
  trim_badging: "P74D",
  exterior_color: "SolidBlack",
  wheel_type: "Wishbone20Staggered",
  interior_trim_type: "White2",
}, "Model 3");
assert.equal(performance.trim, "Performance");
assert.equal(performance.wheelType, '20" Warp Wheels');
assert.equal(performance.interior, "White Interior");

assert.equal(
  compositorOptions(resolveTeslaVehicleMedia(
    "Model 3",
    "Solid Black",
    "P74D",
    'Wishbone 20"Staggered',
    2024,
    "White 2",
  )),
  "$MT371,$PBSB,$W30P,$IPW4,$T30A",
);

console.log("Tesla media contract: pass");
