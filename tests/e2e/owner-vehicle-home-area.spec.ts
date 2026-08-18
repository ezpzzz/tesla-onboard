import { expect, test } from "@playwright/test";

/**
 * Design doc Phase 4 home-area sub-task (decided 8A): per-vehicle optional
 * home area (center lat/lng + radius miles) edited on the vehicle edit form.
 * Radius via presets (25/50/100/250 mi) + custom; manual lat/lng fields
 * remain as an advanced fallback; a "Use car's current location" button
 * performs a deliberate one-shot vehicle_data location read that fills the
 * form only, never a location table. Unset renders: "No home area set — add
 * one to enable out-of-area alerts."
 *
 * lib/owner/location-evidence-server.ts stores the home area on the
 * Supabase-backed private workspace vehicle record (VehicleHomeAreaRow) —
 * there is no local/localStorage seam for it the way there is for the rest
 * of the vehicle record (lib/owner/vehicle-state.ts). This e2e webServer
 * runs with no Supabase configured (playwright.config.ts), so there is no
 * workspace vehicle row to read or write a home area on, and the one-shot
 * "current location" read needs a real Tesla vehicle_data poll. Every
 * scenario below is written out per the plan's committed copy/interactions
 * and skipped with that one reason so it is ready once a staged Supabase +
 * Tesla-connected workspace backs this suite.
 */

test.skip(
  "an unset home area renders the committed out-of-area guidance copy — needs a Supabase-backed workspace vehicle row; none exists in this demo-mode e2e environment",
  async ({ page }) => {
    await page.goto("/owner/vehicles/veh-home-area-demo");
    await expect(page.getByText("No home area set — add one to enable out-of-area alerts.")).toBeVisible();
  },
);

test.skip(
  "an owner sets a home area via a radius preset and manual lat/lng fallback, and it persists on reload — needs a Supabase-backed workspace vehicle row to write to",
  async ({ page }) => {
    await page.goto("/owner/vehicles/veh-home-area-demo");

    await page.getByLabel(/latitude/i).fill("34.0522");
    await page.getByLabel(/longitude/i).fill("-118.2437");
    await page.getByRole("button", { name: "50 mi" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByRole("status").filter({ hasText: /saved/i })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/latitude/i)).toHaveValue("34.0522");
    await expect(page.getByRole("button", { name: "50 mi" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("No home area set")).toHaveCount(0);
  },
);

test.skip(
  "'Use car's current location' performs a one-shot read that fills the form only, never writes a location table — needs a live Tesla-connected owner integration; copy: 'Tap while the car is parked at home'",
  async ({ page }) => {
    await page.goto("/owner/vehicles/veh-home-area-demo");

    const useCurrentLocation = page.getByRole("button", { name: "Use car's current location" });
    await expect(useCurrentLocation).toBeVisible();
    await expect(page.getByText("Tap while the car is parked at home")).toBeVisible();

    await useCurrentLocation.click();
    await expect(page.getByLabel(/latitude/i)).not.toHaveValue("");
    await expect(page.getByLabel(/longitude/i)).not.toHaveValue("");
    // Coordinates fill the form only — never written to a location table —
    // so no location-evidence UI should light up as a side effect of this tap.
    await expect(page.getByText(/out of area|in area/i)).toHaveCount(0);
  },
);

test.skip(
  "out-of-area alerts never drive fees (CA §1939.01+ design stance): the row is informational only, with no fee/charge language nearby",
  async ({ page }) => {
    await page.goto("/owner/vehicles/veh-home-area-demo");
    const outOfAreaRow = page.getByText(/out of area/i);
    await expect(outOfAreaRow).toBeVisible();
    await expect(page.getByText(/fee|surcharge|fine/i)).toHaveCount(0);
  },
);
