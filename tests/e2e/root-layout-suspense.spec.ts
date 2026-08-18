import { expect, test } from "@playwright/test";

/**
 * Regression guard for app/layout.tsx's Suspense boundary (added alongside
 * the Vehicle Telemetry Evidence Ledger diff, unrelated to telemetry itself).
 *
 * TenantConfigProvider's useSearchParams() requires a Suspense ancestor.
 * Root layout used to pass `fallback={children}` — but Suspense renders its
 * fallback and its real content as two separate passes during SSR
 * streaming, so reusing `children` as the fallback server-rendered the
 * entire page's markup twice into the initial HTML response (duplicate
 * landmarks/shells, e.g. two <aside> sidebars, two account menus). Client
 * hydration reconciles this away in the browser DOM, so a page.goto()-based
 * assertion never observes it — this spec instead fetches the raw
 * server-rendered HTML directly (no JS execution/hydration) via the
 * `request` fixture, the only way to actually observe the bug. Nothing in
 * the existing suite asserted single-render at the SSR-HTML level, so a
 * future "cleanup" reverting to `fallback={children}` (it looks more
 * idiomatic at a glance) would silently reintroduce doubled initial HTML
 * with no test catching it.
 *
 * Verified locally against the old `fallback={children}`: this spec fails
 * (each landmark count 2) on the buggy code and passes on the fix.
 */

test("owner page's raw SSR HTML renders each landmark exactly once, never doubled by the Suspense fallback", async ({ request, baseURL }) => {
  const response = await request.get(`${baseURL}/owner`);
  const html = await response.text();

  const countOccurrences = (needle: string) => html.split(needle).length - 1;

  expect(countOccurrences('aria-label="Owner navigation"')).toBe(1);
  expect(countOccurrences('aria-label="Workspace navigation"')).toBe(1);
  expect(countOccurrences('aria-label="Open account menu"')).toBe(1);
  expect(countOccurrences("<aside")).toBe(1);
});
