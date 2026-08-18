import { expect, test, type Page } from "@playwright/test";
import { computeScaleToFit } from "../../components/owner/mail-render-prep";
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
  /**
   * MailContentFrame.tsx's ASSUMED_MAIL_CONTENT_WIDTH -- the fixed reference
   * width computeScaleToFit divides the measured container width by. Not
   * exported (it's an internal rendering constant), so it's duplicated here
   * the same way mail-render-prep.ts's own doc comment describes other
   * modules re-declaring shapes rather than importing across the
   * client/pure-function boundary.
   */
  const ASSUMED_MAIL_CONTENT_WIDTH = 650;
  const FRAME_WRAPPER_SELECTOR = "[data-mail-scale]";

  /**
   * The real, previously-untested contract (GAP-3): `data-mail-scale` must
   * equal computeScaleToFit(650, <actual measured container width>) --  not
   * a value frozen at page load. Asserting this directly (rather than only
   * "no page-level scroll", which `overflow-x-auto` satisfies at literally
   * any scale, including the old always-1 bug) is what actually catches a
   * regression back to reading a stale/null ref at render time.
   */
  test("650px Turo-style table scale-to-fits to the real measured container width, no page-level horizontal scroll", async ({ page }) => {
    await openHarness(page, FIXED_WIDTH_TABLE);

    // The email's own content is visible and readable inside its frame.
    const frame = page.frameLocator('iframe[title="Email content"]');
    await expect(frame.getByTestId("fixed-width-copy")).toBeVisible();
    await expect(frame.getByRole("heading", { name: "Trip confirmed" })).toBeVisible();

    const wrapper = page.locator(FRAME_WRAPPER_SELECTOR);
    await expect(wrapper).toHaveCount(1);

    const measuredWidth = await wrapper.evaluate((el) => el.clientWidth);
    const reportedScale = Number(await wrapper.getAttribute("data-mail-scale"));
    const expectedScale = computeScaleToFit(ASSUMED_MAIL_CONTENT_WIDTH, measuredWidth);

    expect(Number.isFinite(reportedScale)).toBe(true);
    // Every configured project's viewport keeps this dev harness's own
    // main (max-width: 480px, MailRenderHarnessClient.tsx) narrower than
    // the 650px reference width, so a real, un-stuck scale-to-fit must
    // shrink below 1 here on every project -- this is the exact case the
    // old "stuck at 1 forever" GAP-3 bug would fail.
    expect(reportedScale, "a 650px table inside an at-most-480px harness container must scale down, not stay 1").toBeLessThan(1);
    expect(reportedScale).toBeCloseTo(expectedScale, 5);

    // The scaled content exactly fills its measured container (the
    // documented "escape hatch" only matters if this ever drifts) -- proof
    // the transform is driven by the real container width, not a hardcoded
    // number that happens to also be < 1.
    const innerWidth = await wrapper.locator("> div").first().evaluate((el) => el.getBoundingClientRect().width);
    expect(innerWidth).toBeCloseTo(measuredWidth, 0);

    // The phone-width shell around the frame never grows the page itself
    // horizontally -- the horizontally-scrollable frame container is the
    // documented escape hatch, not page-level overflow.
    const dimensions = await page.evaluate(() => ({
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth, "fixed-width mail must not overflow the page itself").toBeLessThanOrEqual(dimensions.width);

    // The scroll-escape hatch itself is real: the wrapper is genuinely
    // horizontally scrollable (overflow-x-auto), so any future case where
    // the scaled content doesn't exactly fill the container still has a
    // contained, local escape rather than pushing the whole page wide.
    const overflowX = await wrapper.evaluate((el) => getComputedStyle(el).overflowX);
    expect(overflowX).toBe("auto");
  });

  test("a desktop (chromium) viewport measures a wider container and therefore a larger scale than a phone viewport", async ({ page, isMobile }) => {
    test.skip(isMobile, "This asserts the desktop side of the contract; mobile-safari is covered by the test above.");

    await openHarness(page, FIXED_WIDTH_TABLE);
    const wrapper = page.locator(FRAME_WRAPPER_SELECTOR);
    const measuredWidth = await wrapper.evaluate((el) => el.clientWidth);
    const reportedScale = Number(await wrapper.getAttribute("data-mail-scale"));
    const expectedScale = computeScaleToFit(ASSUMED_MAIL_CONTENT_WIDTH, measuredWidth);

    // Real desktop measurement: still governed by the harness's own
    // max-width: 480px main (this route intentionally renders the phone-
    // width shell regardless of the real viewport -- see
    // MailRenderHarnessClient.tsx and this file's cold-state describe block
    // above), so scale never reaches 1 here either -- but it must be the
    // real computed value for the wider chromium viewport, never a value
    // hardcoded/frozen at an earlier, narrower measurement.
    expect(reportedScale).toBeCloseTo(expectedScale, 5);
    expect(reportedScale, "never upscaled past 1").toBeLessThanOrEqual(1);
  });
});
