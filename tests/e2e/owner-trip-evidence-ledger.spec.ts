import { expect, test } from "@playwright/test";

/**
 * Design doc Phase 5 (evidence ledger rows) + Phase 2 (bookend capture
 * contract) + success criteria's degraded-state checklist: a completed
 * trip's ledger row shows odometer/battery deltas vs. policy, a text+shape
 * status badge, and (Phase 3) charging session kWh with gap-affected
 * caveats where applicable — all in the return-review view.
 *
 * A real row needs a trip with worker-written bookends
 * (private.onlyevs_trip_bookends) and, for charging, derived charge
 * sessions from vehicle_stats_history — both written only by
 * services/onlyevs-worker against a Supabase workspace. This e2e webServer
 * runs with no Supabase configured (playwright.config.ts), and per the
 * mission's hard rules this suite must not fake that data through a
 * storage layer the app itself would never write it to (there is no
 * localStorage-backed trip/bookend store the way there is for vehicles).
 * Every scenario below is written to the plan's committed copy/behavior and
 * skipped with that one reason, ready for a staged backend.
 */

test.skip(
  "a clean return renders a 'Clean return' status badge (text+shape) with miles/battery deltas vs. policy — needs a real trip + bookend pair from the worker",
  async ({ page }) => {
    await page.goto("/owner/vehicles/veh-ledger-demo");
    const row = page.getByRole("link", { name: /Clean return/i }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText(/of \d+ mi/);
    await expect(row).toContainText(/%/);
  },
);

test.skip(
  "a return below the policy charge floor renders a 'Needs attention' badge and the return-below-policy alert fires — needs a real bookend pair with battery below the configured policy percentage",
  async ({ page }) => {
    await page.goto("/owner/vehicles/veh-ledger-demo");
    await expect(page.getByRole("link", { name: /Needs attention/i }).first()).toBeVisible();
  },
);

test.skip(
  "a stale bookend field renders its offset from the trip edge instead of a bare value — needs a real bookend recorded outside the 30-minute freshness window",
  async ({ page }) => {
    await page.goto("/owner/vehicles/veh-ledger-demo");
    await expect(page.getByText(/as of \d+m (before|after)/)).toBeVisible();
  },
);

test.skip(
  "an absent bookend field renders 'Not captured at pickup/return', never a fabricated or carried-forward value — needs a real bookend row with a null field",
  async ({ page }) => {
    await page.goto("/owner/vehicles/veh-ledger-demo");
    await expect(page.getByText(/Not captured at (pickup|return)/)).toBeVisible();
  },
);

test.skip(
  "a gap-affected charging session renders its kWh with an explicit caveat rather than silently merging or splitting — needs derived charge sessions from vehicle_stats_history spanning a stream gap",
  async ({ page }) => {
    await page.goto("/owner/vehicles/veh-ledger-demo");
    await expect(page.getByText(/gap-affected/i)).toBeVisible();
  },
);

test.skip(
  "tapping a ledger row opens the trip detail page, which shows the same deltas and badge in return-review — needs a real trip",
  async ({ page }) => {
    await page.goto("/owner/vehicles/veh-ledger-demo");
    await page.getByRole("link", { name: /Clean return|Needs attention/i }).first().click();
    await expect(page).toHaveURL(/\/owner\/trips\/[^/]+$/);
    await expect(page.getByText(/of \d+ mi/)).toBeVisible();
  },
);
