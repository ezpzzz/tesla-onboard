import { expect, test, type Page } from "@playwright/test";
import {
  CID_IMAGE,
  CSS_EXFIL_URL,
  HOSTILE_TRACKING_HOST,
  JAVASCRIPT_HREF,
  KITCHEN_SINK_EGRESS,
  META_REFRESH,
  REMOTE_IMAGE,
  SCRIPT_EXECUTION_FIXTURES,
  SCRIPT_INLINE,
  SCRIPT_SRC,
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

  test('iframe carries sandbox="" with no allow-scripts, ever', async ({ page }) => {
    await openHarness(page, SCRIPT_INLINE);
    const sandbox = await page.locator(FRAME_SELECTOR).getAttribute("sandbox");
    expect(sandbox).toBe("");
  });

  test("default CSP blocks scripts and non-data image sources", async ({ page }) => {
    await openHarness(page, SCRIPT_INLINE);
    const frame = page.frameLocator(FRAME_SELECTOR);
    const cspContent = await frame.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    expect(cspContent).toContain("script-src 'none'");
    expect(cspContent).toContain("img-src data:");
    expect(cspContent).not.toContain("https:");
  });

  test.describe("zero third-party network egress", () => {
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
