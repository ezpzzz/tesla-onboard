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
