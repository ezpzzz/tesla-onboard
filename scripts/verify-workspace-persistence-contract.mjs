/**
 * Structural regression contract for the production tenant persistence split.
 * Run with: node scripts/verify-workspace-persistence-contract.mjs
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const repository = read("lib/owner/vehicle-repository.ts");
const state = read("lib/owner/vehicle-state.ts");
const tenantProvider = read("components/owner/OwnerTenantProvider.tsx");
const publicProjection = read("lib/tenant-vehicle.ts");

assert.match(repository, /\.from\("onlyevs_vehicles"\)/);
assert.match(repository, /\.eq\("workspace_id", scope\.workspaceId\)/);
assert.match(repository, /\.eq\("shop_slug", scope\.shopSlug\)/);
assert.match(repository, /\.eq\("revision", existing\.remoteRevision \?\? 1\)/);
assert.doesNotMatch(repository, /migrateBrowserVehicles/);

const remoteLoad = state.indexOf("await fetchWorkspaceVehicles(scope)");
const migrationCompletion = state.indexOf("completeBrowserMigration(tenantSlug)");
assert.ok(remoteLoad >= 0 && migrationCompletion > remoteLoad);
assert.doesNotMatch(state, /await migrateBrowserVehicles\(/);
assert.match(state, /localStorage\.removeItem\(scopedStorageKey\(VEHICLE_KEY, tenantSlug\)\)/);
assert.match(state, /persistence: scope \? "workspace" as const : "browser" as const/);

assert.match(
  tenantProvider,
  /\.update\(\{ features, display_name: config\.companyName \}\)/,
);
assert.match(tenantProvider, /if \(!workspace \|\| !hydrated \|\| error \|\| !sourceId\) return/);

const projectionBody = publicProjection.match(
  /export function tenantCarFromVehicle[\s\S]*?\n}\n/,
)?.[0] ?? "";
for (const privateField of ["vin", "licensePlate", "notes", "teslaImportKey", "remoteRevision"]) {
  assert.equal(
    new RegExp(`vehicle\\.${privateField}\\b`).test(projectionBody),
    false,
    `${privateField} must not enter public workspace_branding`,
  );
}

console.log("workspace persistence contract: pass");
