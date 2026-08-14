#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const repoRoot = path.resolve(import.meta.dirname, "..");
const nodeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function resolveWorkspaceModule(request, parentFile) {
  const base = request.startsWith("@/")
    ? path.join(repoRoot, request.slice(2))
    : path.resolve(path.dirname(parentFile), request);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function loadWorkspaceModule(filePath) {
  const absolutePath = path.resolve(filePath);
  const cached = moduleCache.get(absolutePath);
  if (cached) return cached.exports;

  const module = { exports: {} };
  moduleCache.set(absolutePath, module);
  const source = fs.readFileSync(absolutePath, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: absolutePath,
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  function localRequire(request) {
    if (request.startsWith(".") || request.startsWith("@/")) {
      const workspaceModule = resolveWorkspaceModule(request, absolutePath);
      if (!workspaceModule) {
        throw new Error(`Cannot resolve ${request} from ${absolutePath}`);
      }
      return loadWorkspaceModule(workspaceModule);
    }
    return nodeRequire(request);
  }

  const execute = new Function("require", "module", "exports", compiled);
  execute(localRequire, module, module.exports);
  return module.exports;
}

const media = loadWorkspaceModule(path.join(repoRoot, "lib/vehicle-media.ts"));
const { ConfiguredVehicleIllustration } = loadWorkspaceModule(
  path.join(repoRoot, "components/vehicle/ConfiguredVehicleIllustration.tsx"),
);
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");

const screenshotTuple = {
  model: "Model 3",
  color: "Solid Black",
  trim: "74",
  wheelType: 'Glider 18"',
  interior: "White 2",
  interiorCode: null,
  paintCode: "PBSB",
  year: 2018,
};

assert.equal(
  media.resolveTeslaVehicleMedia(
    screenshotTuple.model,
    screenshotTuple.color,
    screenshotTuple.trim,
    screenshotTuple.wheelType,
    screenshotTuple.year,
    screenshotTuple.interior,
    screenshotTuple.interiorCode,
    screenshotTuple.paintCode,
  ),
  null,
  "legacy tuples must not be coerced into a current Tesla compositor image",
);
assert.equal(media.vehiclePaintHex(screenshotTuple.color), "#171a20");
assert.equal(media.vehicleWheelFamily(screenshotTuple.wheelType), "aero");
assert.equal(
  media.vehicleInteriorFamily(
    screenshotTuple.interior,
    screenshotTuple.interiorCode,
  ),
  "white",
);
assert.equal(media.vehicleInteriorFamily("White Interior", "IPB4"), "unknown");

const markup = renderToStaticMarkup(
  React.createElement(ConfiguredVehicleIllustration, screenshotTuple),
);
assert.match(markup, /data-vehicle-artwork="configured"/);
assert.match(markup, /data-wheel-family="aero"/);
assert.match(markup, /data-interior-family="white"/);
assert.match(markup, /fill="#171a20"/);
assert.match(markup, /fill="#f1f2f3"/);
assert.doesNotMatch(markup, /unavailable/i);

const currentModel3 = media.resolveTeslaVehicleMedia(
  "Model 3",
  "Stealth Grey",
  "Performance",
  '20\" Warp',
  2024,
  "White Interior",
  "IPW4",
  "PN01",
);
assert.ok(
  currentModel3,
  "verified current Model 3 compositor mapping must remain available",
);
assert.equal(currentModel3.kind, "vehicle-configurator");

console.log("vehicle media regression: 13 assertions passed");
