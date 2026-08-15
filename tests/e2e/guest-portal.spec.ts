import { expect, test } from "@playwright/test";

const token = process.env.EVHOST_E2E_GUEST_TOKEN;

test("a real private trip capability exposes the complete guest portal", async ({ isMobile, page }) => {
  test.skip(!token, "Set EVHOST_E2E_GUEST_TOKEN to a controlled staging trip capability.");
  const base = `/trip/${token}`;

  await page.goto(base);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: isMobile ? "Guest tabs" : "Guest portal" });
  await expect(navigation.getByRole("link")).toHaveCount(4);
  await expect(navigation.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

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
});
