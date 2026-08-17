/**
 * Defense-in-depth HTML strip pass (T12, design doc Premise 2 / Eng Review
 * 6A). Runs client-side using the browser's native `DOMParser` -- a real
 * HTML parser, zero dependencies, never a hand-rolled server regex. This is
 * NOT the security boundary: sandbox="" (no allow-scripts) on the srcdoc
 * iframe plus the CSP from mail-render-prep.ts's buildMailCsp are the
 * load-bearing wall (a script tag surviving this strip still cannot execute
 * inside that sandbox). This pass is a genuine second, parser-backed layer
 * -- not false confidence -- but its own regression net is the Playwright
 * hostile-fixture suite (6A: script/css-exfil/cid/entity/malformed-nesting
 * vectors, run in real chromium + mobile-safari), not a vitest unit test,
 * because DOMParser requires a real browser DOM and this repo adds no jsdom
 * dependency (NOT in scope, per the design doc's constraints).
 *
 * Requires `document`/`DOMParser` -- browser-only. Never import this from a
 * server module or a vitest-node test file.
 */

const REMOVED_TAG_NAMES = ["script", "iframe", "object", "embed", "form"];
const JAVASCRIPT_URL_PATTERN = /^\s*javascript:/i;

function stripUrlAttribute(element: Element, attrName: string): void {
  const value = element.getAttribute(attrName);
  if (value !== null && JAVASCRIPT_URL_PATTERN.test(value)) {
    element.removeAttribute(attrName);
  }
}

/**
 * Removes script/iframe/object/embed/form/meta-refresh nodes, every `on*`
 * event-handler attribute, `javascript:` URLs on href/src/action/formaction,
 * and external stylesheet `<link rel="stylesheet">` tags; then serializes
 * the sanitized document body back to a string.
 */
export function stripUntrustedHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  for (const tagName of REMOVED_TAG_NAMES) {
    for (const node of Array.from(doc.querySelectorAll(tagName))) node.remove();
  }

  // meta http-equiv="refresh" is a navigation vector as real as a script tag
  // (it can drop the sandboxed viewer out to an attacker page); every other
  // <meta> (charset, etc.) is harmless and left alone.
  for (const meta of Array.from(doc.querySelectorAll('meta[http-equiv]'))) {
    if ((meta.getAttribute("http-equiv") ?? "").toLowerCase() === "refresh") meta.remove();
  }

  for (const link of Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))) link.remove();

  for (const element of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(element.attributes)) {
      if (attr.name.toLowerCase().startsWith("on")) element.removeAttribute(attr.name);
    }
    stripUrlAttribute(element, "href");
    stripUrlAttribute(element, "src");
    stripUrlAttribute(element, "action");
    stripUrlAttribute(element, "formaction");
  }

  return doc.body.innerHTML;
}
