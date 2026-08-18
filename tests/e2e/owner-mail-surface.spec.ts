import { expect, test, type Page } from "@playwright/test";
import { FIXED_WIDTH_TABLE, type HostileMailFixture } from "./fixtures/hostile-mail";

/**
 * T15 (design doc alex-email-inbox-design-20260817-123909.md), the surface
 * half of the mission: cold/empty states on /owner/mail in this e2e
 * environment's demo mode (no NEXT_PUBLIC_SUPABASE_* configured --
 * OwnerMailList.tsx's own comment documents that `scope` is null here, so
 * every fetch is skipped and the real, honest empty state renders -- not a
 * fabricated one), plus mobile legibility of Turo's real fixed-width
 * (600-650px) transactional table layout inside the phone-width shell via
 * the same app/dev/mail-render-harness seam used by
 * owner-mail-render-security.spec.ts.
 *
 * Runs against both configured Playwright projects (chromium, mobile-safari)
 * -- no project-specific test files needed, `playwright test` already
 * fans this file out across projects.
 */

const HARNESS_URL = "/dev/mail-render-harness";

async function openHarness(page: Page, fixture: HostileMailFixture) {
  await page.addInitScript((f) => {
    window.__MAIL_TEST_FIXTURE__ = { html: f.html, text: "", inline: f.inline ?? {} };
  }, fixture);
  await page.goto(HARNESS_URL);
  await page.getByTestId("mail-harness-root").waitFor();
}

test.describe("/owner/mail cold state", () => {
  test("list page shows the honest empty state, not fabricated mail", async ({ page }) => {
    await page.goto("/owner/mail");

    await expect(page.getByRole("heading", { name: "Mail", level: 1 })).toBeVisible();
    await expect(page.getByText("No mail captured yet.")).toBeVisible();
    await expect(page.getByText("Once Turo email capture is live for this workspace, messages will appear here.")).toBeVisible();

    // Nothing that looks like a real message row.
    await expect(page.locator("ul > li")).toHaveCount(0);

    const dimensions = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, "no page-level horizontal overflow on the cold list").toBeLessThanOrEqual(dimensions.width);
  });

  test("search and filters render but a query still yields the honest empty state", async ({ page }) => {
    await page.goto("/owner/mail");
    // Wait for the cold-list empty state before interacting -- it only
    // renders once the client component has hydrated and its load effect
    // resolved, so this also guards against filling the search input
    // before React's event handlers are attached (a real cross-browser
    // hydration race, not merely a slow-CI wait).
    await expect(page.getByText("No mail captured yet.")).toBeVisible();
    await page.getByLabel("Search mail").fill("booking");
    await page.getByRole("button", { name: "Search" }).click();

    await expect(page.getByText("No mail captured yet.")).toBeVisible();
    await expect(page.getByText("No captured message matched that search.")).toBeVisible();
  });

  test("detail page for an unknown/unreachable message id fails closed, not silently", async ({ page }) => {
    await page.goto("/owner/mail/00000000-0000-0000-0000-000000000000");
    // Demo mode has no resolvable workspace scope, so the detail surface
    // cannot distinguish "not found" from "no backend" -- it must still show
    // a real, visible state rather than an infinite spinner or blank page.
    await expect(page.getByText(/Mail couldn't be loaded\.|Message not found\./)).toBeVisible();
  });
});

test.describe("fixed-width mail legibility", () => {
  test("650px Turo-style table stays legible with scale-to-fit, no page-level horizontal scroll", async ({ page }) => {
    await openHarness(page, FIXED_WIDTH_TABLE);

    // The email's own content is visible and readable inside its frame.
    const frame = page.frameLocator('iframe[title="Email content"]');
    await expect(frame.getByTestId("fixed-width-copy")).toBeVisible();
    await expect(frame.getByRole("heading", { name: "Trip confirmed" })).toBeVisible();

    // The phone-width shell around the frame never grows the page itself
    // horizontally -- the horizontally-scrollable frame container is the
    // documented escape hatch, not page-level overflow.
    const dimensions = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, "fixed-width mail must not overflow the page itself").toBeLessThanOrEqual(dimensions.width);
  });
});
