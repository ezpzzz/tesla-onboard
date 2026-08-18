import { expect, test, type Page } from "@playwright/test";
import {
  BACKGROUND_ATTR_JAVASCRIPT,
  BASE_HREF_HIJACK,
  CID_IMAGE,
  CSS_EXFIL_URL,
  EGRESS_ONLY_FIXTURES,
  EMBED_TAG,
  FORM_ACTION_SUBMIT,
  HOSTILE_TRACKING_HOST,
  JAVASCRIPT_HREF,
  KITCHEN_SINK_EGRESS,
  META_REFRESH,
  OBJECT_TAG,
  POSTER_ATTR_JAVASCRIPT,
  REMOTE_IMAGE,
  SCRIPT_EXECUTION_FIXTURES,
  SCRIPT_INLINE,
  SCRIPT_SRC,
  SVG_XLINK_JAVASCRIPT,
  type HostileMailFixture,
} from "./fixtures/hostile-mail";

/**
 * T15 (design doc alex-email-inbox-design-20260817-123909.md, Eng Review
 * 6A). Drives the REAL rendering pipeline -- components/owner/mail-strip-html.ts's
 * DOMParser strip, components/owner/mail-render-prep.ts's CSP/cid/srcdoc
 * builders, and MailContentFrame.tsx's sandboxed iframe -- against synthetic
 * hostile fixtures (tests/e2e/fixtures/hostile-mail.ts) through
 * app/dev/mail-render-harness, the least-invasive seam that reaches this
 * pipeline without a live Supabase workspace (see that route's own comments
 * for why /owner/mail/[id] itself cannot be driven to a "content" state in
 * this e2e environment).
 *
 * Every assertion in this file EXECUTES against a real browser (chromium +
 * mobile-safari, per playwright.config.ts's two projects) -- nothing here is
 * a test.skip. "Zero script execution" and "zero third-party egress" are
 * the two structural guarantees Premise 2 claims; both are asserted
 * directly, not inferred.
 */

const HARNESS_URL = "/dev/mail-render-harness";
const FRAME_SELECTOR = 'iframe[title="Email content"]';

async function openHarness(page: Page, fixture: HostileMailFixture) {
  await page.addInitScript((f) => {
    window.__MAIL_TEST_FIXTURE__ = { html: f.html, text: "", inline: f.inline ?? {} };
  }, fixture);
  await page.goto(HARNESS_URL);
  await page.getByTestId("mail-harness-root").waitFor();
}

/**
 * Egress tracking, scoped to the synthetic tracking host only.
 *
 * Browsers differ in *when* a CSP-blocked load is reported: WebKit never
 * emits a `request` event for it at all, while Chromium emits `request`
 * immediately followed by `requestfailed` with a CSP block reason -- the
 * request object is created and the DevTools event fires before the CSP
 * check aborts it, so no bytes ever reach the network either way. A
 * `response` event is the one signal that means a real round trip
 * happened; that is the actual "did egress occur" question, so it is the
 * primary assertion below. `failures` additionally lets the opt-in test
 * distinguish "blocked by CSP" (errorText `csp`) from "CSP allowed it, DNS
 * failed" (errorText `net::ERR_NAME_NOT_RESOLVED`) -- proof the opt-in
 * genuinely widened the policy rather than the request coincidentally
 * failing anyway.
 */
interface HostileNetworkTracker {
  requests: string[];
  responses: string[];
  failures: string[];
}

function trackHostileNetwork(page: Page): HostileNetworkTracker {
  const tracker: HostileNetworkTracker = { requests: [], responses: [], failures: [] };
  page.on("request", (req) => {
    if (req.url().includes(HOSTILE_TRACKING_HOST)) tracker.requests.push(req.url());
  });
  page.on("response", (res) => {
    if (res.url().includes(HOSTILE_TRACKING_HOST)) tracker.responses.push(res.url());
  });
  page.on("requestfailed", (req) => {
    if (req.url().includes(HOSTILE_TRACKING_HOST)) tracker.failures.push(req.failure()?.errorText ?? "unknown");
  });
  return tracker;
}

function expectNoEgress(tracker: HostileNetworkTracker) {
  expect(tracker.responses, "no response should ever be received from the tracking host -- zero bytes crossed the wire").toEqual([]);
  expect(
    tracker.requests.length,
    "every client-side attempt to reach the tracking host must have failed, never resolved",
  ).toBe(tracker.failures.length);
}

test.describe("hostile mail render security (T15, 6A)", () => {
  for (const fixture of SCRIPT_EXECUTION_FIXTURES) {
    test(`${fixture.id}: zero script execution`, async ({ page }) => {
      const dialogs: string[] = [];
      page.on("dialog", (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });
      const hostileConsole: string[] = [];
      page.on("console", (msg) => {
        if (msg.text().includes("HOSTILE_EXEC")) hostileConsole.push(msg.text());
      });

      await openHarness(page, fixture);
      const frame = page.frameLocator(FRAME_SELECTOR);

      if (fixture.id === "javascript-href") {
        // The strip pass removes the href attribute outright, so clicking a
        // hrefless anchor is a no-op -- but attempt the real adversarial
        // action a guest would take, rather than only checking the markup.
        await frame.locator("#hostile-link").click({ force: true }).catch(() => undefined);
      }
      if (fixture.id === "svg-xlink-javascript") {
        // Same real-click discipline for the SVG-namespaced sibling of
        // javascript-href: the strip removes xlink:href, so clicking the
        // hrefless SVG <a> must be a no-op too.
        await frame.locator("#hostile-svg-link").click({ force: true }).catch(() => undefined);
      }

      // Give any handler that survived stripping+sandboxing a moment to
      // fire before asserting silence.
      await page.waitForTimeout(300);

      expect(dialogs, "no alert/confirm/prompt dialog should ever fire").toEqual([]);
      expect(hostileConsole, "no HOSTILE_EXEC console marker should ever log").toEqual([]);

      if (fixture.markerAttribute) {
        await expect(frame.locator(`body[${fixture.markerAttribute}]`)).toHaveCount(0);
      }
    });
  }

  test("javascript: href is stripped from the DOM entirely, not just neutralized on click", async ({ page }) => {
    await openHarness(page, JAVASCRIPT_HREF);
    const frame = page.frameLocator(FRAME_SELECTOR);
    await expect(frame.locator("#hostile-link")).toHaveCount(1);
    expect(await frame.locator("#hostile-link").getAttribute("href")).toBeNull();
  });

  test("javascript: xlink:href is stripped from the DOM entirely, not just neutralized on click", async ({ page }) => {
    await openHarness(page, SVG_XLINK_JAVASCRIPT);
    const frame = page.frameLocator(FRAME_SELECTOR);
    await expect(frame.locator("#hostile-svg-link")).toHaveCount(1);
    expect(await frame.locator("#hostile-svg-link").getAttribute("xlink:href")).toBeNull();
  });

  test("javascript: background= attribute is stripped from the DOM entirely", async ({ page }) => {
    await openHarness(page, BACKGROUND_ATTR_JAVASCRIPT);
    const frame = page.frameLocator(FRAME_SELECTOR);
    await expect(frame.locator("#hostile-bg-table")).toHaveCount(1);
    expect(await frame.locator("#hostile-bg-table").getAttribute("background")).toBeNull();
  });

  test("javascript: poster= attribute is stripped from the DOM entirely", async ({ page }) => {
    await openHarness(page, POSTER_ATTR_JAVASCRIPT);
    const frame = page.frameLocator(FRAME_SELECTOR);
    await expect(frame.locator("#hostile-poster-video")).toHaveCount(1);
    expect(await frame.locator("#hostile-poster-video").getAttribute("poster")).toBeNull();
  });

  test("<object> and <embed> are removed from the DOM entirely, not merely blocked from fetching", async ({ page }) => {
    await openHarness(page, OBJECT_TAG);
    await expect(page.frameLocator(FRAME_SELECTOR).locator("#hostile-object")).toHaveCount(0);

    await openHarness(page, EMBED_TAG);
    await expect(page.frameLocator(FRAME_SELECTOR).locator("#hostile-embed")).toHaveCount(0);
  });

  test("<form> is removed from the DOM entirely -- the submit control never renders at all", async ({ page }) => {
    await openHarness(page, FORM_ACTION_SUBMIT);
    const frame = page.frameLocator(FRAME_SELECTOR);
    await expect(frame.locator("#hostile-form")).toHaveCount(0);
    await expect(frame.locator("#hostile-submit")).toHaveCount(0);
  });

  test('iframe carries sandbox="" with no allow-scripts, ever', async ({ page }) => {
    await openHarness(page, SCRIPT_INLINE);
    const sandbox = await page.locator(FRAME_SELECTOR).getAttribute("sandbox");
    expect(sandbox).toBe("");
  });

  test("default CSP blocks scripts, non-data image sources, form submission, and base-uri rewriting", async ({ page }) => {
    await openHarness(page, SCRIPT_INLINE);
    const frame = page.frameLocator(FRAME_SELECTOR);
    const cspContent = await frame.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(cspContent).toContain("script-src 'none'");
    expect(cspContent).toContain("img-src data:");
    expect(cspContent).toContain("form-action 'none'");
    expect(cspContent).toContain("base-uri 'none'");
    expect(cspContent).not.toContain("https:");
  });

  test("<form> submission attempt causes no navigation, even though the <form> was already stripped", async ({ page }) => {
    const tracker = trackHostileNetwork(page);
    await openHarness(page, FORM_ACTION_SUBMIT);
    const startUrl = page.url();
    // The strip already removed the whole <form>, so there is nothing to
    // click -- attempt it anyway (force:true against a selector that no
    // longer exists resolves to zero elements and no-ops) so this test
    // would fail loudly if a future strip regression ever let the form
    // survive: form-action 'none' is the CSP's independent second wall.
    await page.frameLocator(FRAME_SELECTOR).locator("#hostile-submit").click({ force: true, timeout: 1000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    expect(page.url()).toBe(startUrl);
    expectNoEgress(tracker);
  });

  test("<base href> hijack never redirects the relative link's click, and never resolves through the tracking host", async ({ page }) => {
    const tracker = trackHostileNetwork(page);
    await openHarness(page, BASE_HREF_HIJACK);
    const frame = page.frameLocator(FRAME_SELECTOR);
    await expect(frame.locator("#hostile-relative-link")).toBeVisible();

    // Even if <base> survived the strip (it's not in REMOVED_TAG_NAMES),
    // base-uri 'none' must stop the browser from ever honoring it -- so
    // clicking the relative link must never resolve against the tracking
    // host. Same-document navigations inside a sandboxed, srcdoc iframe
    // with no allow-* top-level-navigation token are themselves blocked, so
    // this also proves the click is fully inert.
    await frame.locator("#hostile-relative-link").click({ force: true, timeout: 1000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    expect(page.url()).toContain(HARNESS_URL);
    expectNoEgress(tracker);
  });

  test.describe("zero third-party network egress", () => {
    for (const fixture of EGRESS_ONLY_FIXTURES) {
      test(`${fixture.id}: never reaches the network`, async ({ page }) => {
        const tracker = trackHostileNetwork(page);
        await openHarness(page, fixture);
        await page.waitForTimeout(300);
        expectNoEgress(tracker);
      });
    }

    test("external <script src> never reaches the network", async ({ page }) => {
      const tracker = trackHostileNetwork(page);
      await openHarness(page, SCRIPT_SRC);
      await page.waitForTimeout(300);
      expectNoEgress(tracker);
    });

    test("CSS url() background beacon never reaches the network", async ({ page }) => {
      const tracker = trackHostileNetwork(page);
      await openHarness(page, CSS_EXFIL_URL);
      await page.waitForTimeout(300);
      expectNoEgress(tracker);
    });

    test("meta refresh never navigates and never reaches the network", async ({ page }) => {
      const tracker = trackHostileNetwork(page);
      await openHarness(page, META_REFRESH);
      await page.waitForTimeout(500);
      expect(page.url()).toContain(HARNESS_URL);
      expectNoEgress(tracker);
    });

    test("remote <img> is blocked by default (no script involved)", async ({ page }) => {
      const tracker = trackHostileNetwork(page);
      await openHarness(page, REMOTE_IMAGE);
      await page.waitForTimeout(300);
      expectNoEgress(tracker);
      // Chromium reports the CSP block as a requestfailed with errorText
      // "csp" (see the shared tracker's doc comment); assert that's the
      // reason whenever a failure was observed, so this test would fail if
      // the block ever silently became a DNS-only coincidence instead.
      for (const reason of tracker.failures) expect(reason).toBe("csp");
    });

    test("remote <img> loads only after the explicit 'Load remote images' opt-in", async ({ page }) => {
      const tracker = trackHostileNetwork(page);
      await openHarness(page, REMOTE_IMAGE);

      await page.getByRole("button", { name: "Load remote images" }).click();
      await page.waitForTimeout(500);

      // The opt-in genuinely widens the CSP -- the attempt now reaches the
      // network layer (fails only on DNS, since .invalid never resolves),
      // proven by the failure reason no longer being a CSP block.
      expect(tracker.requests.length).toBeGreaterThan(0);
      expect(tracker.failures.some((reason) => reason !== "csp")).toBe(true);

      const frame = page.frameLocator(FRAME_SELECTOR);
      const cspContent = await frame.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
      expect(cspContent).toContain("img-src data: https:");
    });

    test("kitchen-sink combined vectors: zero egress to the tracking host across all of them", async ({ page }) => {
      const tracker = trackHostileNetwork(page);
      await openHarness(page, KITCHEN_SINK_EGRESS);
      await page.waitForTimeout(500);
      expectNoEgress(tracker);
    });
  });

  test("cid: image renders as an inlined data: URL, not a network fetch", async ({ page }) => {
    await openHarness(page, CID_IMAGE);
    const src = await page.frameLocator(FRAME_SELECTOR).getByTestId("cid-img").getAttribute("src");
    expect(src).toMatch(/^data:image\/png;base64,/);
  });
});
