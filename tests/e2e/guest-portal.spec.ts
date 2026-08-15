import { expect, test } from "@playwright/test";

const token = process.env.EVHOST_E2E_GUEST_TOKEN;

test("a real private trip capability exposes the complete guest portal", async ({ isMobile, page }) => {
  test.skip(!token, "Set EVHOST_E2E_GUEST_TOKEN to a controlled staging trip capability.");
  const base = `/trip/${token}`;
  const browserErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(base);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: isMobile ? "Guest tabs" : "Guest portal" });
  await expect(navigation.getByRole("link")).toHaveCount(4);
  await expect(navigation.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  const tripRibbon = page.getByTestId("trip-ribbon");
  await expect(tripRibbon).toBeVisible();
  const ribbonOverflow = await tripRibbon.locator("*").evaluateAll((elements) => elements
    .filter((element) => element instanceof HTMLElement && element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
    .map((element) => element.textContent?.trim()).filter(Boolean));
  expect(ribbonOverflow, "trip schedule text should wrap rather than clip").toEqual([]);
  const homeDimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(homeDimensions.scrollWidth, "home should not overflow").toBeLessThanOrEqual(homeDimensions.width);
  if (isMobile) {
    const homeTarget = await page.getByRole("link", { name: "Trip home" }).boundingBox();
    expect(homeTarget?.height).toBeGreaterThanOrEqual(44);
  }

  for (const [segment, label] of [["guide", "Guide"], ["vehicle", "Vehicle"], ["help", "Help"]] as const) {
    await navigation.getByRole("link", { name: label }).click();
    await expect(page).toHaveURL(`${base}/${segment}`);
    await expect(page.getByRole("navigation", { name: isMobile ? "Guest tabs" : "Guest portal" }).getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(dimensions.scrollWidth, `${segment} should not overflow`).toBeLessThanOrEqual(dimensions.width);
  }

  await expect(page.locator('a[href^="tel:"], a[href^="mailto:"]').first()).toHaveAttribute("rel", /noreferrer/);
  await page.goto(`${base}/details`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(`${base}/help`);
  await page.goForward();
  await expect(page).toHaveURL(`${base}/details`);
  expect(browserErrors).toEqual([]);
});
