import { expect, test } from "@playwright/test";

test("owner overview gives guest onboarding a prominent durable-workspace CTA", async ({ page }) => {
  await page.goto("/owner");

  const section = page.getByRole("region", { name: "Invite your next guest" });
  await expect(section.getByRole("heading", { name: "Invite your next guest" })).toBeVisible();
  await expect(section.getByRole("button", { name: "New onboarding" })).toBeVisible();
  await expect(section).toContainText("booking-specific link");

  // The test server deliberately has no Supabase workspace. The product must
  // advertise the action without pretending a browser-only link is trackable.
  await expect(section.getByRole("button", { name: "New onboarding" })).toBeDisabled();
  await expect(section).toContainText("durable EVhost workspace is required");
});
