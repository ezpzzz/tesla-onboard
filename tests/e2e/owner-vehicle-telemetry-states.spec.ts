import { expect, test } from "@playwright/test";

/**
 * Vehicle Telemetry & Trip Evidence Ledger (design doc
 * alex-vehicle-telemetry-design-20260816-200500.md, Phase 5 + the
 * interaction-state table) — rebuilt vehicle details page states.
 *
 * The e2e webServer (see playwright.config.ts) runs with no
 * NEXT_PUBLIC_SUPABASE_* configured and no
 * NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED flag, which is the app's real
 * "demo/unconfigured" mode: `useOwnerData` never resolves a workspace scope,
 * so trips are always the honest EMPTY_OWNER_SNAPSHOT and
 * `fetchWorkspaceVehicleStats` (Tesla live telemetry) is never called
 * (lib/owner/use-owner-data.ts). That is a real, deliberate product state —
 * "never enrolled" — and it is exactly what most of the specs below assert.
 *
 * States that only exist with live Fleet Telemetry data (streamed battery/
 * odometer values, enrollment status rows, limit_reached/unsupported
 * responses from Tesla, trip bookends written by the worker) cannot be
 * produced in this environment: they live in Supabase tables the worker
 * writes, never in a browser-storage layer the app itself would populate.
 * Seeding them through localStorage would be fabricating data the app never
 * wrote, which the mission's hard rules forbid. Those cases are written out
 * in full (so they are ready the moment a live/staged backend is wired to
 * this suite) but marked test.skip with a one-line reason.
 */

const vehicleId = "veh-telemetry-demo";
const baseVehicle = {
  id: vehicleId,
  guestSourceId: "e2b6a9c1-9b3a-4c9d-8f5e-8a1c2d3e4f50",
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

async function seedVehicle(page: import("@playwright/test").Page, overrides: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([seed, extra]) => {
      window.localStorage.setItem(
        "rtr:vehicles:v1:local-demo",
        JSON.stringify({ version: 2, vehicles: { [(seed as { id: string }).id]: { ...(seed as object), ...(extra as object) } } }),
      );
    },
    [baseVehicle, overrides],
  );
}

test.describe("vehicle details — live state card", () => {
  test("never-enrolled vehicle renders the honest empty telemetry state, not a fabricated card", async ({ page }) => {
    await seedVehicle(page);
    await page.goto(`/owner/vehicles/${vehicleId}`);

    await expect(page.getByRole("heading", { name: baseVehicle.displayName })).toBeVisible();
    // Interaction-state table, "Live state card" row, EMPTY column.
    await expect(page.getByText("No telemetry yet")).toBeVisible();
    // No fabricated numbers: nothing claims a battery/odometer/signal value.
    await expect(page.getByText(/Latest signal/)).toHaveCount(0);
  });

  test.skip(
    "streamed live values render per-field freshness — needs a real onlyevs_vehicle_stats_current row written by the worker; ONLYEVS_OPERATIONS_ENABLED is off in this e2e environment so the client never fetches it, and nothing in the app writes telemetry to browser storage",
    async ({ page }) => {
      await seedVehicle(page);
      await page.goto(`/owner/vehicles/${vehicleId}`);
      await expect(page.getByText(/Latest signal/)).toBeVisible();
      await expect(page.getByText(/Battery/)).toBeVisible();
    },
  );

  test.skip(
    "a stale field (older than the 30-minute freshness window) renders its age instead of a fresh-looking number — needs live streamed data with a controllable observedAt, unavailable without a staged telemetry backend",
    async ({ page }) => {
      await seedVehicle(page);
      await page.goto(`/owner/vehicles/${vehicleId}`);
      await expect(page.getByText(/\d+m ago|stale/i)).toBeVisible();
    },
  );

  test.skip(
    "limit_reached (3-config contention) renders 'Telemetry contended — another app holds this vehicle's telemetry slots' with remediation guidance — this is a Tesla Fleet API enrollment response the app has no way to simulate locally",
    async ({ page }) => {
      await seedVehicle(page);
      await page.goto(`/owner/vehicles/${vehicleId}`);
      await expect(page.getByText("Telemetry contended — another app holds this vehicle's telemetry slots")).toBeVisible();
      await expect(page.getByText(/remove the competing app|manual-era/i)).toBeVisible();
    },
  );

  test.skip(
    "firmware-unsupported vehicles render their own distinct state, not the generic empty state — this is a Tesla enrollment response the app cannot manufacture",
    async ({ page }) => {
      await seedVehicle(page);
      await page.goto(`/owner/vehicles/${vehicleId}`);
      await expect(page.getByText(/firmware/i)).toBeVisible();
    },
  );

  test.skip(
    "cold-start status strip walks requested/configuring -> pending_sync -> error with enrolled-since age, then disappears permanently at first signal — needs onlyevs_telemetry_enrollments rows the worker writes; no app-writable local seam exists for enrollment status",
    async ({ page }) => {
      await seedVehicle(page);
      await page.goto(`/owner/vehicles/${vehicleId}`);
      await expect(page.getByText("Setting up telemetry — no action needed")).toBeVisible();
      await expect(page.getByText(/enrolled \d+[hm] ago/)).toBeVisible();
    },
  );
});

test.describe("vehicle details — trip evidence ledger", () => {
  test("a vehicle with no trips shows the ledger's committed empty-state copy", async ({ page }) => {
    await seedVehicle(page);
    await page.goto(`/owner/vehicles/${vehicleId}`);

    // Interaction-state table, "Evidence ledger" row, EMPTY column — literal copy.
    await expect(page.getByText("No trips yet. Evidence starts recording with your first trip.")).toBeVisible();
  });

  test.skip(
    "a manual-era trip (predates Phase 2, or the vehicle was never enrolled) renders 'Recorded manually — no telemetry for this trip' with no bookend delta claims — needs a durable trip, which requires a Supabase workspace this e2e environment deliberately has none of",
    async ({ page }) => {
      await seedVehicle(page);
      await page.goto(`/owner/vehicles/${vehicleId}`);
      await expect(page.getByText("Recorded manually — no telemetry for this trip")).toBeVisible();
    },
  );

  test.skip(
    "a pre-telemetry straddle trip (started before Phase 2 deployed) renders 'Start not captured (pre-telemetry)' with end-only data and no delta claims — needs a durable trip + a real end bookend from the worker",
    async ({ page }) => {
      await seedVehicle(page);
      await page.goto(`/owner/vehicles/${vehicleId}`);
      await expect(page.getByText("Start not captured (pre-telemetry)")).toBeVisible();
    },
  );

  test.skip(
    "odometer regression (end < start) renders an explicit data-error ledger row, never negative miles — needs a real bookend pair from the worker",
    async ({ page }) => {
      await seedVehicle(page);
      await page.goto(`/owner/vehicles/${vehicleId}`);
      await expect(page.getByText(/-\d+ mi/)).toHaveCount(0);
    },
  );
});

test.describe("vehicle details — health charts", () => {
  test("charts render the committed 24h empty-state copy before any history exists", async ({ page }) => {
    await seedVehicle(page);
    await page.goto(`/owner/vehicles/${vehicleId}`);

    // Interaction-state table, "Health charts" row, EMPTY column — literal copy.
    await expect(page.getByText("Charts appear after 24h of telemetry.")).toBeVisible();
  });
});

test.describe("vehicle details — active trip card", () => {
  test("the active trip card is absent entirely when there is no active trip (never a blank/loading card)", async ({ page }) => {
    await seedVehicle(page);
    await page.goto(`/owner/vehicles/${vehicleId}`);

    await expect(page.getByText(/miles pace|mileage allowance/i)).toHaveCount(0);
  });
});

test.describe("vehicle details — location evidence", () => {
  test.skip(
    "location evidence row states (no active trip / no consent / workspace not allowlisted) all render distinct honest absent reasons — the read path is founder-workspace-gated server-side (ONLYEVS_LOCATION_EVIDENCE_WORKSPACES) and requires an authenticated owner session; this e2e environment runs unauthenticated demo mode by design",
    async ({ page }) => {
      await seedVehicle(page);
      await page.goto(`/owner/vehicles/${vehicleId}`);
      await expect(page.getByText(/no active trip|no home area set|not allowlisted/i)).toBeVisible();
    },
  );
});
