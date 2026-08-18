import { expect, test } from "@playwright/test";

const email = process.env.EVHOST_E2E_OWNER_EMAIL;
const password = process.env.EVHOST_E2E_OWNER_PASSWORD;

test("an authenticated owner can use every operational surface and detail route", async ({ isMobile, page }) => {
  test.skip(!email || !password, "Set controlled owner credentials for the durable workspace matrix.");
  const browserErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/login?next=/owner");
  const emailField = page.getByLabel("Email", { exact: true });
  await emailField.fill(email!);
  await expect(emailField).toHaveValue(email!);
  await page.getByLabel("Password").fill(password!);
  await expect(emailField).toHaveValue(email!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("/owner");
  await expect(page.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await expect(page.getByText("All systems", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("readiness-rail").first()).toBeVisible();

  const invite = page.getByRole("region", { name: "Invite your next guest" });
  const trigger = invite.getByRole("button", { name: "New onboarding" });
  await expect(trigger).toBeEnabled();
  const inviteTop = await invite.evaluate((element) => element.getBoundingClientRect().top);
  const handoffTop = await page.getByText("Next handoff", { exact: true })
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(inviteTop).toBeLessThan(handoffTop);

  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Trip and guest details" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(/Guest name/)).toBeFocused();
  const geometry = await dialog.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { bottom: box.bottom, left: box.left, right: box.right, top: box.top, viewportHeight: innerHeight, viewportWidth: innerWidth };
  });
  if (isMobile) {
    expect(Math.abs(geometry.viewportHeight - geometry.bottom)).toBeLessThanOrEqual(1);
    expect(geometry.left).toBe(0);
    expect(geometry.right).toBe(geometry.viewportWidth);
  } else {
    expect(geometry.left).toBeGreaterThan(0);
    expect(geometry.right).toBeLessThan(geometry.viewportWidth);
    expect(Math.abs((geometry.top + geometry.bottom) / 2 - geometry.viewportHeight / 2)).toBeLessThanOrEqual(2);
  }
  const fieldSizes = await dialog.locator("input, select").evaluateAll((elements) =>
    elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize)),
  );
  expect(fieldSizes.every((size) => size >= 16)).toBe(true);
  if (isMobile) {
    const scrollRegion = dialog.locator(".overflow-y-auto");
    const horizontalGeometry = await scrollRegion.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft,
      scrollWidth: element.scrollWidth,
    }));
    expect(horizontalGeometry.scrollLeft).toBe(0);
    expect(horizontalGeometry.scrollWidth).toBeLessThanOrEqual(horizontalGeometry.clientWidth);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  const routes = [
    ["/owner/trips", "Trips"],
    ["/owner/drivers", "Guests"],
    ["/owner/vehicles", "Vehicles"],
    ["/owner/inbox", "Inbox"],
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

  await page.goto("/owner/account");
  await expect(page.getByRole("heading", { name: "Profile photo" })).toBeVisible();
  const avatarUploadButton = page.getByRole("button", { name: /Upload photo|Replace photo/ });
  await expect(avatarUploadButton).toBeVisible();
  await expect(avatarUploadButton).toBeEnabled();

  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  if (!isMobile) {
    await page.locator('input[name="owner-avatar"]').setInputFiles({
      name: "owner-avatar.png",
      mimeType: "image/png",
      buffer: onePixelPng,
    });
    await expect(page.getByRole("status")).toContainText("Profile photo updated");
    await expect(page.locator('[data-owner-avatar="image"]').first()).toBeVisible();
    await page.getByRole("button", { name: "Remove upload" }).click();
    await expect(page.getByRole("status")).toContainText(/sign-in provider photo|initials/);
  }

  await page.goto("/owner/settings");
  await expect(page.getByText("Business logo", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Upload|Replace/ }).first()).toBeEnabled();
  if (!isMobile) {
    await page.locator('input[name="onlyevs-business-logo"]').setInputFiles({
      name: "business-logo.png",
      mimeType: "image/png",
      buffer: onePixelPng,
    });
    await expect(page.getByRole("status")).toContainText("Logo uploaded");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
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

  if (isMobile) await expect(page.getByRole("navigation", { name: "Owner tabs" }).getByRole("link")).toHaveCount(6);
  else await expect(page.getByRole("navigation", { name: "Owner navigation" })).toBeVisible();
  expect(browserErrors).toEqual([]);
});
