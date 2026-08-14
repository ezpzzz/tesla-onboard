/**
 * Exact Tesla media regression contract.
 *
 * Static catalog checks:
 *   pnpm dlx tsx scripts/verify-tesla-media-contract.mjs
 *
 * Static checks plus first-party Tesla compositor availability:
 *   pnpm dlx tsx scripts/verify-tesla-media-contract.mjs --live
 */

import assert from "node:assert/strict";
import {
  displayTeslaColor,
  displayTeslaTrim,
  displayTeslaWheel,
  parseTeslaVehicleConfig,
  teslaPaintOptionCode,
} from "../lib/tesla-vehicle-config.ts";
import {
  resolveTeslaVehicleMedia,
  teslaPaintCode,
  vehicleMediaImageUrl,
} from "../lib/vehicle-media.ts";

const exactMedia = [];

function expectOptions(name, args, expectedOptions, expectedView) {
  const media = resolveTeslaVehicleMedia(...args);
  assert.ok(media, `${name}: expected exact Tesla media`);
  assert.equal(media.provider, "tesla", `${name}: provider`);
  assert.equal(media.kind, "vehicle-configurator", `${name}: kind`);
  assert.equal(media.paintMatched, true, `${name}: paint match`);
  assert.equal(media.trimMatched, true, `${name}: trim match`);
  assert.equal(media.wheelsMatched, true, `${name}: wheel match`);
  assert.equal(media.interiorMatched, true, `${name}: interior match`);
  assert.equal(media.yearMatched, true, `${name}: year match`);
  const url = new URL(media.imageUrl);
  assert.equal(url.hostname, "static-assets.tesla.com", `${name}: host`);
  assert.equal(url.searchParams.get("view"), expectedView, `${name}: view`);
  assert.equal(url.searchParams.get("options"), expectedOptions, `${name}: options`);
  exactMedia.push([name, media]);
}

function expectUnavailable(name, args) {
  assert.equal(resolveTeslaVehicleMedia(...args), null, `${name}: must fail closed`);
}

// Paint and legacy label normalization. These names come from Tesla service
// documentation, but only codes separately proven in a live compositor tuple
// are admitted to exact media below.
assert.equal(teslaPaintCode("Frost Blue Metallic"), "PB00");
assert.equal(teslaPaintCode("Marine Blue"), "PB02");
assert.equal(teslaPaintCode("Midnight Cherry Red"), "PR00");
assert.equal(teslaPaintCode("Red Multi-Coat"), "PPMR");
assert.equal(teslaPaintCode("Midnight Silver Metallic"), "PMNG");
assert.equal(displayTeslaColor("PBCW"), "Base White");
assert.equal(displayTeslaColor("PM00"), "Pearl White Pro Multi-Coat");
assert.equal(displayTeslaColor("PMMB"), "Blue Metallic");
assert.equal(displayTeslaColor("PMAB"), "Brown Metallic");
assert.equal(displayTeslaColor("PMTG"), "Grey Metallic");
assert.equal(displayTeslaColor("PMSG"), "Green Metallic");
assert.equal(displayTeslaTrim("P85+", "Model S"), "P85+");
assert.equal(displayTeslaWheel("Uberturbine", "Model 3"), '20" Uber Turbine Wheels');
assert.equal(displayTeslaWheel("Uberturbine", "Model Y"), '21" Uberturbine Wheels');
assert.equal(displayTeslaWheel("Slipstream", "Model S"), '19" Slipstream Wheels');
assert.equal(displayTeslaWheel("Slipstream", "Model X"), '20" Slipstream Wheels');
assert.equal(displayTeslaWheel("Halo22", "Model X"), '22" Halo Wheels');
assert.equal(displayTeslaWheel("Warp", "Model 3"), "Warp Wheels");
assert.equal(displayTeslaWheel("Warp19", "Model 3"), '19" Warp Wheels');
assert.equal(
  teslaPaintOptionCode("$AD15, $PMSS, $WTTB"),
  "PMSS",
  "legacy paint option codes must survive import",
);

const conflictingInterior = parseTeslaVehicleConfig({
  interior_trim_type: "White",
  option_codes: "$IPB4",
}, "Model 3");
assert.equal(conflictingInterior.interior, "White Interior");
assert.equal(conflictingInterior.interiorCode, undefined);

// Current Model 3 Fleet spellings and exact option tuples.
const longRange = parseTeslaVehicleConfig({
  car_type: "model3",
  trim_badging: "74",
  exterior_color: "SolidBlack",
  wheel_type: "Glider18",
  interior_trim_type: "White2",
}, "Model 3");
assert.deepEqual(longRange, {
  trim: "Long Range RWD",
  color: "Solid Black",
  wheelType: '18" Photon Wheels',
  interior: "White Interior",
  interiorCode: undefined,
  paintCode: undefined,
  model: undefined,
});
expectOptions(
  "Model 3 Long Range RWD / Solid Black / Photon / White",
  ["Model 3", "Solid Black", "74", 'Glider 18"', 2024, "White 2"],
  "$MT369,$PBSB,$W38A,$IPW2",
  "STUD_FRONT34",
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
expectOptions(
  "Model 3 Performance / Solid Black / Warp / White",
  ["Model 3", "Solid Black", "P74D", 'Wishbone 20"Staggered', 2024, "White 2"],
  "$MT371,$PBSB,$W30P,$IPW4,$T30A",
  "STUD_FRONT34",
);
expectUnavailable(
  "Model 3 rejects a Model Y-only Marine Blue paint despite compositor tolerance",
  ["Model 3", "Marine Blue", "74D", '19" Nova Wheels', 2024, "Black", "IPB3", "PB02"],
);
expectOptions(
  "Model 3 base / Deep Blue / Photon / Black",
  ["Model 3", "Deep Blue Metallic", "Rear-Wheel Drive", '18" Photon Wheels', 2024, "Black Interior", "IBB4", "PPSB"],
  "$MT367,$PPSB,$W38A,$IBB4",
  "STUD_FRONT34",
);
expectUnavailable(
  "Model 3 base white interior is not a published tuple",
  ["Model 3", "Pearl White Multi-Coat", "Rear-Wheel Drive", '18" Prismata Wheels', 2024, "White Interior"],
);
expectUnavailable(
  "conflicting explicit Model 3 interior signals",
  ["Model 3", "Solid Black", "Performance", '20" Warp Wheels', 2024, "White Interior", "IPB4", "PBSB"],
);
expectUnavailable(
  "future Model 3 years never inherit the current catalog",
  ["Model 3", "Solid Black", "Performance", '20" Warp Wheels', 2027, "Black Interior", "IPB4", "PBSB"],
);

// 2020-2024 Model Y: Tesla renamed wheel labels across Fleet generations.
// Both spellings resolve to the same exact compositor option only where the
// trim's allowed wheel catalog permits it.
const legacyModelY = parseTeslaVehicleConfig({
  car_type: "modely",
  trim_badging: "Performance",
  exterior_color: "SolidBlack",
  wheel_type: "Uberturbine21",
  interior_trim_type: "White",
}, "Model Y");
assert.equal(legacyModelY.wheelType, '21" Uberturbine Wheels');
expectOptions(
  "2024 Model Y Performance / Solid Black / Uberturbine / White",
  ["Model Y", "Solid Black", "Performance", legacyModelY.wheelType, 2024, "White Interior"],
  "$MTY38,$PBSB,$WY21P,$INPW0",
  "FRONT34",
);
expectOptions(
  "2024 Model Y LR AWD / Midnight Cherry Red / Apollo Dark / Black",
  ["Model Y", "Midnight Cherry Red", "Long Range AWD", '19" Apollo Dark Wheels', 2024, "Black Interior", "INPB0", "PR00"],
  "$MTY37,$PR00,$WY19C,$INPB0",
  "FRONT34",
);
expectOptions(
  "2024 Model Y LR RWD / Red Multi-Coat / Induction / White",
  ["Model Y", "Red Multi-Coat", "Long Range RWD", '20" Induction Wheels', 2024, "White Interior", "INPW0", "PPMR"],
  "$MTY35,$PPMR,$WY20P,$INPW0",
  "FRONT34",
);
expectOptions(
  "2024 Model Y Performance / Midnight Silver / Uberturbine / Black",
  ["Model Y", "Midnight Silver Metallic", "Performance", '21" Uberturbine Wheels', 2024, "Black Interior", "INPB0", "PMNG"],
  "$MTY38,$PMNG,$WY21P,$INPB0",
  "FRONT34",
);
expectUnavailable(
  "2024 Model Y Silver Metallic is documented but not published by the compositor",
  ["Model Y", "Silver Metallic", "Long Range AWD", '19" Gemini Wheels', 2024, "Black Interior", "INPB0", "PMSS"],
);

// Refreshed Model Y base trims have a black-only exact catalog. This guards
// against reintroducing the prior letter-substitution heuristic ($IBB6->$IBW6).
expectOptions(
  "refreshed Model Y AWD / Pearl White / Aperture / Black",
  ["Model Y", "Pearl White Multi-Coat", "All-Wheel Drive", '18" Aperture Wheels', 2025, "Black Interior", "IBB6", "PPSW"],
  "$MTY77,$PPSW,$WY18P,$IBB6",
  "FRONT34",
);
expectOptions(
  "refreshed Model Y RWD / Marine Blue / Crossflow / Black",
  ["Model Y", "Marine Blue", "Rear-Wheel Drive", '19" Crossflow Wheels', 2025, "Black Interior", "IBB6", "PB02"],
  "$MTY61,$PB02,$WY19P,$IBB6",
  "FRONT34",
);
expectOptions(
  "refreshed Model Y L / Ultra Red / Machina / White",
  ["Model Y", "Ultra Red", "Model Y L", '19" Machina 2.0 Wheels', 2025, "White Interior", "IPW17", "PR01"],
  "$MTY83,$PR01,$WY19L,$IPW17",
  "FRONT34",
);
expectUnavailable(
  "Model Y L Pearl White Pro is documented but not published by the compositor",
  ["Model Y", "Pearl White Pro Multi-Coat", "Model Y L", '19" Machina 2.0 Wheels', 2025, "Black Interior", "IPB17", "PM00"],
);
expectUnavailable(
  "refreshed Model Y AWD white interior is not a published tuple",
  ["Model Y", "Pearl White Multi-Coat", "All-Wheel Drive", '18" Aperture Wheels', 2025, "White Interior", undefined, "PPSW"],
);

expectOptions(
  "Cybertruck AWD / Core",
  ["Cybertruck", "Stainless Steel", "Dual Motor AWD", '20" Core Wheels', 2025],
  "$MTC07,$WH0A,$IG05",
  "STUD_SIDEVIEW",
);

if (process.argv.includes("--live")) {
  for (const [name, media] of exactMedia) {
    const response = await fetch(vehicleMediaImageUrl(media, 512), {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(response.status, 200, `${name}: Tesla returned ${response.status}`);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^image\//,
      `${name}: Tesla returned a non-image content type`,
    );
  }
  console.log(`Tesla live media contract: ${exactMedia.length} exact tuples available`);
}

console.log("Tesla media contract: pass");
