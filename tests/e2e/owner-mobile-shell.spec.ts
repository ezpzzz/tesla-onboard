import { expect, test } from "@playwright/test";

test("mobile owner navigation exposes five stable tabs and keeps workspace actions in the avatar menu", async ({
  isMobile,
  page,
}) => {
  test.skip(!isMobile, "The bottom tab bar is a mobile-only control.");

  await page.goto("/owner/trips");
  const navigation = page.getByRole("navigation", { name: "Owner tabs" });

  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link")).toHaveCount(5);
  const activeTab = navigation.getByRole("link", { name: "Trips" });
  await expect(activeTab).toHaveAttribute("aria-current", "page");
  await expect(activeTab.locator(".bg-signal")).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Inbox" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Workspace settings" })).toHaveCount(0);
  const ownerHomeTarget = await page.getByRole("link", { name: "EVhost Today" }).boundingBox();
  expect(ownerHomeTarget?.height).toBeGreaterThanOrEqual(44);

  const before = await navigation.boundingBox();
  expect(before).not.toBeNull();

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(0);

  const after = await navigation.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1);

  await page.locator('summary[aria-label="Open account menu"]').click();
  await expect(page.getByRole("link", { name: "Integrations" })).toBeVisible();
  const settingsLink = page.getByRole("link", { name: "Settings", exact: true });
  await expect(settingsLink).toBeVisible();

  await settingsLink.click();
  await expect(page).toHaveURL("/owner/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator('details:has(summary[aria-label="Open account menu"])')).not.toHaveAttribute("open", "");
  await expect(page.getByRole("textbox", { name: /Company name/ })).toBeVisible();

  const fields = page.locator("input, select, textarea");
  const fieldCount = await fields.count();
  expect(fieldCount).toBeGreaterThan(0);
  for (let index = 0; index < fieldCount; index += 1) {
    await expect(fields.nth(index)).toHaveAttribute("name", /\S+/);
  }

  const zoomableFields = page.locator(
    'input:not([type="file"]):not([type="color"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea',
  );
  const zoomableFieldCount = await zoomableFields.count();
  expect(zoomableFieldCount).toBeGreaterThan(0);
  for (let index = 0; index < zoomableFieldCount; index += 1) {
    const field = zoomableFields.nth(index);
    if (!(await field.isVisible())) continue;
    const fontSize = await field.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
  }
});
