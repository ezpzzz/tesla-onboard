import { expect, test } from "@playwright/test";

const email = process.env.EVHOST_E2E_OWNER_EMAIL;
const password = process.env.EVHOST_E2E_OWNER_PASSWORD;

test("an authenticated owner can use every operational surface and detail route", async ({ isMobile, page }) => {
  test.skip(!email || !password, "Set controlled owner credentials for the durable workspace matrix.");
  const browserErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/login?next=/owner");
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/owner");
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(page.getByText("All systems", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("readiness-rail").first()).toBeVisible();

  const routes = [
    ["/owner/trips", "Trips"],
    ["/owner/drivers", "Guests"],
    ["/owner/vehicles", "Vehicles"],
    ["/owner/insights", "Insights"],
    ["/owner/integrations", "Integrations"],
    ["/owner/settings", "Settings"],
    ["/owner/account", "Account"],
  ] as const;
  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth, `${path} should not overflow`).toBeLessThanOrEqual(dimensions.width);
  }

  for (const [path, prefix] of [
    ["/owner/trips", "/owner/trips/"],
    ["/owner/drivers", "/owner/drivers/"],
    ["/owner/vehicles", "/owner/vehicles/"],
  ] as const) {
    await page.goto(path);
    const detailLink = page.locator(`main a[href^="${prefix}"]:not([href="${path}"]):visible`).first();
    await expect(detailLink).toBeVisible();
    await detailLink.click();
    await expect(page).toHaveURL(new RegExp(`${prefix}[^/]+$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth, `${prefix} detail should not overflow`).toBeLessThanOrEqual(dimensions.width);
  }

  if (isMobile) await expect(page.getByRole("navigation", { name: "Owner tabs" }).getByRole("link")).toHaveCount(5);
  else await expect(page.getByRole("navigation", { name: "Owner navigation" })).toBeVisible();
  expect(browserErrors).toEqual([]);
});
