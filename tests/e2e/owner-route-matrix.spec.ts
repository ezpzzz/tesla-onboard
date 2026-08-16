import { expect, test } from "@playwright/test";

const ROUTES = [
  ["/owner", "Today"],
  ["/owner/trips", "Trips"],
  ["/owner/drivers", "Guests"],
  ["/owner/vehicles", "Vehicles"],
  ["/owner/insights", "Insights"],
  ["/owner/integrations", "Integrations"],
  ["/owner/settings", "Settings"],
  ["/owner/account", "Account"],
] as const;

test("every owner destination uses the responsive shell without horizontal overflow", async ({ isMobile, page }) => {
  for (const [path, title] of ROUTES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByText("All systems", { exact: true })).toHaveCount(0);
    const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth, `${path} should not overflow`).toBeLessThanOrEqual(dimensions.width);
  }

  if (isMobile) {
    await expect(page.getByRole("navigation", { name: "Owner tabs" }).getByRole("link")).toHaveCount(5);
  } else {
    await expect(page.getByRole("navigation", { name: "Owner navigation" })).toBeVisible();
  }
});

test("integrations stays useful when background operations are disabled", async ({ page }) => {
  await page.goto("/owner/integrations");

  await expect(page.getByRole("heading", { name: "Tesla Fleet", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google Calendar", level: 2 })).toBeVisible();
  await expect(page.getByText("Operations integrations are disabled")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Import Tesla fleet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Setup required" })).toBeDisabled();

  await page.getByRole("link", { name: "Import Tesla fleet" }).click();
  await expect(page).toHaveURL(/\/owner\/setup$/);
  await expect(page.getByRole("heading", { name: "Connect your Tesla account" })).toBeVisible();
});

test("setup deep links accept known steps and ignore invalid ones", async ({ page }) => {
  await page.goto("/owner/setup?step=connect");
  await expect(page.getByRole("heading", { name: "Connect your Tesla account" })).toBeVisible();
  await expect(page).toHaveURL(/\/owner\/setup$/);

  await page.evaluate(() => window.localStorage.clear());
  await page.goto("/owner/setup?step=unsupported");
  await expect(page.getByRole("heading", { name: "Let's get your fleet set up." })).toBeVisible();
  await expect(page).toHaveURL(/\/owner\/setup\?step=unsupported$/);
});

test("Google Calendar OAuth outcomes are announced and removed from browser history", async ({ page }) => {
  await page.goto("/owner/integrations?google_calendar_error=denied");
  await expect(page.getByRole("status")).toContainText("Google Calendar access was cancelled");
  await expect(page).toHaveURL(/\/owner\/integrations$/);

  await page.goto("/owner/integrations?google_calendar_connected=1");
  await expect(page.getByRole("status")).toContainText("Imported events are ready to review on Trips");
  await expect(page).toHaveURL(/\/owner\/integrations$/);
});
