import { expect, test } from "@playwright/test";

test("mobile owner navigation stays fixed while the content pane scrolls", async ({
  isMobile,
  page,
}) => {
  test.skip(!isMobile, "The bottom tab bar is a mobile-only control.");

  await page.goto("/owner/settings");
  const navigation = page.getByRole("navigation", { name: "Owner tabs" });
  const content = page.locator("main");

  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const before = await navigation.boundingBox();
  expect(before).not.toBeNull();

  await content.evaluate((element) => {
    element.scrollTo({ top: element.scrollHeight, behavior: "instant" });
  });
  await expect.poll(() => content.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const after = await navigation.boundingBox();
  expect(after).not.toBeNull();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  const overscroll = await page.evaluate(() => ({
    body: getComputedStyle(document.body).overscrollBehaviorY,
    html: getComputedStyle(document.documentElement).overscrollBehaviorY,
    main: getComputedStyle(document.querySelector("main") as HTMLElement).overscrollBehaviorY,
  }));
  expect(overscroll).toEqual({ body: "none", html: "none", main: "contain" });

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
    const fontSize = await field.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
  }
});
