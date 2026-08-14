import { expect, test } from "@playwright/test";

const vehicle = {
  id: "veh-removable",
  guestSourceId: "d9633f1a-4d42-4b02-85aa-b959b82dc291",
  displayName: "Test Model Y",
  model: "Model Y",
  trim: "Long Range AWD",
  year: 2024,
  color: "Stealth Grey",
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

test("an owner can remove the last vehicle and restore it later", async ({ page }) => {
  await page.addInitScript((seed) => {
    window.localStorage.setItem(
      "rtr:vehicles:v1:local-demo",
      JSON.stringify({ version: 2, vehicles: { [seed.id]: seed } }),
    );
  }, vehicle);

  await page.goto(`/owner/vehicles/${vehicle.id}`);
  await expect(page.getByRole("button", { name: "Remove vehicle" })).toBeVisible();

  await page.getByRole("button", { name: "Remove vehicle" }).click();
  await expect(page.getByText(/historical trips stay intact/i)).toBeVisible();
  await page.getByRole("button", { name: "Confirm removal" }).click();

  await expect(page.getByText("Removed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore vehicle" })).toBeVisible();

  await page.getByRole("button", { name: "Restore vehicle" }).click();
  await expect(page.getByRole("button", { name: "Remove vehicle" })).toBeVisible();
});
