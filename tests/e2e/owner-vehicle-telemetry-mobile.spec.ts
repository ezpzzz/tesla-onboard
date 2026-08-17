import { expect, test } from "@playwright/test";

/**
 * Design doc Phase 7 responsive spec (decided 6A): the evidence ledger
 * renders as a table on desktop and as stacked two-line tap-through entries
 * on mobile (line 1: dates · guest · status badge; line 2: miles delta ·
 * battery delta · kWh; tap -> the existing trip detail page). Both
 * renderings are committed e2e coverage.
 *
 * This file runs at a fixed 375px viewport regardless of the configured
 * Playwright project, per the mission brief. The row-level assertions
 * (stacked two-line layout, tap-through to a trip) need at least one real
 * trip with bookend data, which this e2e environment cannot produce (no
 * Supabase workspace configured — see owner-vehicle-telemetry-states.spec.ts
 * for the full explanation). What IS honestly testable here — that the
 * ledger's own empty state, and the page around it, never overflow
 * horizontally at mobile width — is exercised below.
 */

const vehicleId = "veh-telemetry-mobile";
const vehicle = {
  id: vehicleId,
  guestSourceId: "3f6a2b8c-7d4e-4a1b-9c3d-2e5f6a7b8c9d",
  displayName: "Fleet Model Y",
  model: "Model Y",
  trim: "Long Range AWD",
  year: 2024,
  color: "Deep Blue Metallic",
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

test.use({ viewport: { width: 375, height: 812 } });

test("evidence ledger empty state fits 375px without horizontal overflow", async ({ page }) => {
  await page.addInitScript((seed) => {
    window.localStorage.setItem(
      "rtr:vehicles:v1:local-demo",
      JSON.stringify({ version: 2, vehicles: { [seed.id]: seed } }),
    );
  }, vehicle);

  await page.goto(`/owner/vehicles/${vehicleId}`);
  await expect(page.getByText("No trips yet. Evidence starts recording with your first trip.")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth, "vehicle details at 375px should not overflow horizontally").toBeLessThanOrEqual(
    dimensions.width,
  );
});

test.skip(
  "a ledger row with real bookend data stacks as two lines (dates · guest · badge / miles delta · battery delta · kWh) and tapping it opens the trip detail page — needs a real completed trip with bookends, which only the worker writes (private.onlyevs_trip_bookends); this e2e demo environment has no Supabase workspace to hold one",
  async ({ page }) => {
    await page.addInitScript((seed) => {
      window.localStorage.setItem(
        "rtr:vehicles:v1:local-demo",
        JSON.stringify({ version: 2, vehicles: { [seed.id]: seed } }),
      );
    }, vehicle);

    await page.goto(`/owner/vehicles/${vehicleId}`);
    const row = page.getByRole("link", { name: /mi ·.*% ·.*kWh/i }).first();
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box?.width).toBeLessThanOrEqual(375);
    await row.click();
    await expect(page).toHaveURL(/\/owner\/trips\/[^/]+$/);
  },
);
