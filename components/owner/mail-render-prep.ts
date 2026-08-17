/**
 * Pure renderer-prep functions for the sandboxed mail viewer (T12, design
 * doc alex-email-inbox-design-20260817-123909.md Premise 2). No DOM, no
 * "use client" -- every function here is plain string/number transforms and
 * is vitest-node-testable (see tests/mail-render-prep.test.ts). The one
 * DOM-dependent step (the defense-in-depth strip pass) lives separately in
 * components/owner/mail-strip-html.ts, which this module's outputs assume
 * has already run -- rewriteCidReferences is documented below as applying
 * AFTER that strip, never before it.
 *
 * Egress model this module encodes (Premise 2): sandbox="" (no
 * allow-scripts) plus this CSP is the load-bearing wall. Zero third-party
 * egress by default -- inline images arrive as `data:` payloads already
 * embedded server-side (T11's inline map), oversized ones only via a
 * same-origin authed fetch, and remote images load only on the explicit
 * per-message opt-in that swaps in the widened CSP below.
 */

/** The exact base CSP directive string from Premise 2. img-src stays
 * `data:` only until the caller explicitly opts a render into remote
 * images -- widened, never additive, so a stale wide policy can't survive a
 * re-render with the opt-in off. */
const MAIL_CSP_BASE_DIRECTIVES = [
  "default-src 'none'",
  "img-src data:",
  "style-src 'unsafe-inline'",
  "script-src 'none'",
  "connect-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
];

const MAIL_CSP_REMOTE_IMAGES_DIRECTIVE = "img-src data: https:";

/**
 * Builds the exact inner CSP string for the srcdoc iframe. `remoteImagesAllowed`
 * is per-render, per-message -- passing true widens `img-src` to `data: https:`
 * for this render only; every other directive is byte-identical either way.
 */
export function buildMailCsp(remoteImagesAllowed: boolean): string {
  const directives = remoteImagesAllowed
    ? [MAIL_CSP_BASE_DIRECTIVES[0], MAIL_CSP_REMOTE_IMAGES_DIRECTIVE, ...MAIL_CSP_BASE_DIRECTIVES.slice(2)]
    : MAIL_CSP_BASE_DIRECTIVES;
  return directives.join("; ");
}

/**
 * Matches `cid:<token>` wherever it appears inside a quoted attribute value
 * (src="cid:...", src='cid:...') or an unquoted/CSS `url(cid:...)` form,
 * capturing the token up to the next quote/paren/whitespace/`>`. String-level
 * on purpose (4A-style shared-core discipline: one regex pass, not a DOM
 * walk) -- it must run AFTER components/owner/mail-strip-html.ts's DOMParser
 * strip pass, never before, so it never resurrects markup the strip removed.
 */
const CID_REFERENCE_PATTERN = /cid:([^"'()\s>]+)/gi;

/**
 * Rewrites every `cid:<token>` reference in `html` to the matching `data:`
 * URL from `inlineMap` (keyed by contentId, exactly T11's `inline` response
 * field). A token with no entry in `inlineMap` is left as `cid:<token>` --
 * harmless under the CSP above (not a `data:`/`https:` URL, so it simply
 * fails to load), never rewritten to a guessed or empty value.
 */
export function rewriteCidReferences(html: string, inlineMap: Record<string, string>): string {
  return html.replace(CID_REFERENCE_PATTERN, (match, token: string) => {
    const dataUrl = inlineMap[token];
    return dataUrl ?? match;
  });
}

/**
 * Assembles the full srcdoc document: a minimal head carrying only the CSP
 * meta tag (no external stylesheet, no script) and the already-stripped,
 * already-cid-rewritten body markup. Fixed, documented structure so
 * assembleSrcdoc's output is exact-match testable.
 */
export function assembleSrcdoc(strippedHtml: string, csp: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${csp}"></head>`
    + `<body>${strippedHtml}</body></html>`
  );
}

/**
 * Initial scale-to-fit transform for fixed-width transactional HTML (Turo's
 * 600-650px mail tables are the norm) inside the phone-width shell:
 * min(1, viewportWidth / contentWidth), never upscaled past 1. Non-finite or
 * non-positive inputs fall back to 1 (no transform) rather than producing
 * NaN/Infinity/a negative scale.
 */
export function computeScaleToFit(contentWidth: number, viewportWidth: number): number {
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) return 1;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 1;
  return Math.min(1, viewportWidth / contentWidth);
}
