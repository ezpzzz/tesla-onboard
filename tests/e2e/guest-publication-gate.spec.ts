import { expect, test } from "@playwright/test";

test("an empty workspace cannot start guest onboarding", async ({ page }) => {
  await page.goto("/?tenant=local-demo");

  await expect(
    page.getByRole("heading", { name: "Guest onboarding is not ready yet." }),
  ).toBeVisible();
  await expect(page.getByText("The owner must finish fleet setup and publish an active vehicle"))
    .toBeVisible();
  await expect(page.getByText("Model 3 Performance")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /get started/i })).toHaveCount(0);
});
