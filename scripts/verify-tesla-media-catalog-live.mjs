/**
 * Exhaustively verify every admitted Model 3 and Model Y compositor tuple.
 *
 * This is intentionally a live release audit rather than a build step: it
 * performs hundreds of requests to Tesla's first-party static asset service.
 * Keep these matrices in sync with lib/vehicle-media.ts and run:
 *
 *   node scripts/verify-tesla-media-catalog-live.mjs
 */

import assert from "node:assert/strict";

const cases = [];

function addCases(model, view, trim, paints, wheels, interiors, extras = []) {
  for (const paint of paints) {
    for (const wheel of wheels) {
      for (const interior of interiors) {
        cases.push({ model, view, options: [trim, paint, wheel, interior, ...extras] });
      }
    }
  }
}

addCases(
  "m3",
  "STUD_FRONT34",
  "MT371",
  ["PN01", "PN00", "PX02", "PB00", "PPSB", "PBSB", "PPSW", "PR01"],
  ["W30P"],
  ["IPB4", "IPW4"],
  ["T30A"],
);
addCases(
  "m3",
  "STUD_FRONT34",
  "MT370",
  ["PN01", "PN00", "PX02", "PPSB", "PBSB", "PPSW", "PR01"],
  ["W38A", "W39G"],
  ["IPB3", "IPW3"],
);
addCases(
  "m3",
  "STUD_FRONT34",
  "MT369",
  ["PN01", "PN00", "PX02", "PPSB", "PBSB", "PPSW", "PR01"],
  ["W38A", "W39G"],
  ["IPB2", "IPW2"],
);
addCases(
  "m3",
  "STUD_FRONT34",
  "MT367",
  ["PN01", "PN00", "PX02", "PPSB", "PBSB", "PPSW", "PR01"],
  ["W38A", "W38C", "W39G"],
  ["IBB4"],
);

const legacyModelYPaints = [
  "PBSB", "PPSB", "PPSW", "PR00", "PR01", "PPMR", "PMNG", "PN01", "PN00",
];
addCases(
  "my",
  "FRONT34",
  "MTY38",
  legacyModelYPaints,
  ["WY21P"],
  ["INPB0", "INPW0"],
);
for (const trim of ["MTY37", "MTY35"]) {
  addCases(
    "my",
    "FRONT34",
    trim,
    legacyModelYPaints,
    ["WY19B", "WY19C", "WY20P"],
    ["INPB0", "INPW0"],
  );
}

addCases(
  "my",
  "FRONT34",
  "MTY70",
  ["PN00", "PN01", "PPSW", "PR01", "PX02", "PB00", "PB01", "PB02"],
  ["WY21A"],
  ["IPB14", "IPW14"],
);
addCases(
  "my",
  "FRONT34",
  "MTY83",
  ["PN03", "PX02", "PB01", "PN01", "PR01"],
  ["WY19L", "WY20L"],
  ["IPB17", "IPW17"],
);
for (const trim of ["MTY48", "MTY60"]) {
  addCases(
    "my",
    "FRONT34",
    trim,
    ["PN01", "PN00", "PPSW", "PR01", "PX02", "PB01", "PB02"],
    ["WY19P", "WY20B"],
    ["IPB12", "IPW12"],
  );
}
for (const trim of ["MTY77", "MTY61"]) {
  addCases(
    "my",
    "FRONT34",
    trim,
    ["PN01", "PN00", "PPSW", "PR01", "PX02", "PB01", "PB02"],
    ["WY18P", "WY19P"],
    ["IBB6"],
  );
}

let cursor = 0;
const failures = [];

async function verifyNext() {
  while (cursor < cases.length) {
    const current = cases[cursor++];
    const url = new URL("https://static-assets.tesla.com/configurator/compositor");
    url.search = new URLSearchParams({
      context: "design_studio_2",
      options: current.options.map((option) => `$${option}`).join(","),
      view: current.view,
      model: current.model,
      size: "256",
      bkba_opt: "2",
      crop: "0,0,0,0",
      overlay: "0",
    }).toString();

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const contentType = response.headers.get("content-type") ?? "";
      if (response.status !== 200 || !contentType.startsWith("image/")) {
        failures.push(`${response.status} ${current.model} ${current.options.join("/")}`);
      }
    } catch (error) {
      failures.push(`network error ${current.model} ${current.options.join("/")}`);
    }
  }
}

await Promise.all(Array.from({ length: 12 }, () => verifyNext()));
assert.deepEqual(failures, [], failures.join("\n"));
console.log(`Tesla exact catalog: ${cases.length} tuples available`);
