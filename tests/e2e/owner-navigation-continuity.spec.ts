import { expect, test } from "@playwright/test";

test("owner route changes preserve shell geometry and avoid visible layout shift", async ({ isMobile, page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { __evhostCls: number };
    state.__evhostCls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput?: boolean; value?: number }>) {
        if (!entry.hadRecentInput) state.__evhostCls += entry.value ?? 0;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  await page.goto("/owner");
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(page.getByText("Loading today’s handoffs…")).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { __evhostCls: number }).__evhostCls = 0; });

  const refreshFlashed = await page.evaluate(async () => {
    const loadingSelector = '[aria-label="Loading today’s handoffs"]';
    let flashed = Boolean(document.querySelector(loadingSelector));
    const observer = new MutationObserver(() => {
      flashed ||= Boolean(document.querySelector(loadingSelector));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.dispatchEvent(new Event("onlyevs:owner-trips-changed"));
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    observer.disconnect();
    return flashed;
  });
  expect(refreshFlashed, "background refresh should keep settled owner content visible").toBe(false);

  const shellHeader = page.locator("header").first();
  const initialHeader = await shellHeader.boundingBox();
  const navigation = isMobile
    ? page.getByRole("navigation", { name: "Owner tabs" })
    : page.getByRole("navigation", { name: "Owner navigation" });

  for (const destination of ["Trips", "Vehicles", "Guests"]) {
    await navigation.getByRole("link", { name: destination, exact: true }).click();
    await expect(page.getByRole("heading", { name: destination, level: 1 })).toBeVisible();
    const header = await shellHeader.boundingBox();
    expect(header?.y).toBe(initialHeader?.y);
    expect(header?.height).toBe(initialHeader?.height);
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scrollbarGutter: getComputedStyle(document.documentElement).scrollbarGutter,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
    expect(dimensions.scrollbarGutter).toContain("stable");
  }

  const cls = await page.evaluate(() => (window as unknown as { __evhostCls: number }).__evhostCls);
  expect(cls).toBeLessThan(0.1);
});
