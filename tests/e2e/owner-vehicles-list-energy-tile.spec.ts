import { expect, test } from "@playwright/test";

/**
 * Regression pin for a behavior change introduced by the Vehicle Telemetry &
 * Trip Evidence Ledger diff: app/owner/vehicles/page.tsx's VehicleCard
 * "Energy" stat tile used to render a dollar amount
 * (formatUsd(stats.energyCostUsd)) and now renders lifetime kWh
 * (formatKwh(lifetimeKwh(buildLedgerRows(...)))) instead — design review
 * Issue 7 (7A): "kWh, never dollars, until a trusted cost source ships
 * fleet-wide," matching the vehicle-details ledger's own lifetime tile.
 *
 * That switch had no test at all: components/owner/ledger-view.test.ts
 * covers formatKwh/lifetimeKwh as pure functions, but nothing asserted the
 * fleet list's VehicleCard actually renders the tile in the new unit, or
 * that it no longer renders a "$" figure the way it did before this diff.
 * A revert to formatUsd would pass every existing unit test untouched.
 */

const vehicle = {
  id: "veh-energy-tile-demo",
  guestSourceId: "8b6f2a1c-3d4e-4f5a-9b6c-7d8e9f0a1b2c",
  displayName: "Fleet Model 3",
  model: "Model 3",
  trim: "Long Range AWD",
  year: 2024,
  color: "Pearl White",
  shifter: "stalk",
  licensePlate: null,
  vin: null,
  returnChargeLevelPct: null,
  notes: "",
  wheelType: null,
  interior: null,
  teslaInteriorCode: null,
  teslaPaintCode: null,
  status: "active",
  createdAt: 1_787_000_000_000,
  updatedAt: 1_787_000_000_000,
};

test("the vehicles-list Energy tile renders lifetime kWh, never a dollar amount", async ({ page }) => {
  await page.addInitScript((seed) => {
    window.localStorage.setItem(
      "rtr:vehicles:v1:local-demo",
      JSON.stringify({ version: 2, vehicles: { [seed.id]: seed } }),
    );
  }, vehicle);

  await page.goto("/owner/vehicles");

  const card = page.getByRole("link", { name: new RegExp(vehicle.displayName) });
  await expect(card).toBeVisible();

  // Demo mode has no Supabase workspace, so chargingSessions is always the
  // honest empty list — lifetime kWh for this never-driven vehicle is
  // exactly 0, formatted as "0 kWh" (components/owner/ledger-view.ts).
  await expect(card.getByText("Energy")).toBeVisible();
  await expect(card.getByText("0 kWh", { exact: true })).toBeVisible();

  // Guard against a regression back to the pre-diff dollar-amount tile.
  await expect(card.getByText("$", { exact: false })).toHaveCount(0);
});
