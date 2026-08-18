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

export type MailAttachmentInlineState = "inlined" | "too_large" | "error";

/**
 * Structural shape this module needs off an attachment manifest entry --
 * matches (but does not import) lib/owner/mail-content-client.ts's
 * MailAttachmentManifestEntry, same "redeclare, don't import" discipline
 * that module documents for staying decoupled from the server-only file it
 * shadows. `inlineState` is the contract's source of truth; `inlined` is
 * read only as a fallback for a manifest entry that predates that field
 * (an older server response, or a fixture) -- resolved to "inlined" or
 * "error", never guessed as "too_large" (that distinction requires the real
 * field).
 */
export interface MailCidAttachmentRef {
  contentId: string | null;
  inlineState?: MailAttachmentInlineState | null;
  inlined?: boolean;
}

export function resolveAttachmentInlineState(attachment: MailCidAttachmentRef): MailAttachmentInlineState {
  if (attachment.inlineState === "inlined" || attachment.inlineState === "too_large" || attachment.inlineState === "error") {
    return attachment.inlineState;
  }
  return attachment.inlined ? "inlined" : "error";
}

/**
 * Matches a complete `<img ...>` tag whose `src` is still a literal
 * `cid:<token>` reference -- i.e. one `rewriteCidReferences` above did NOT
 * rewrite to a `data:` URL, because no inline payload was available for it.
 * Must run AFTER `rewriteCidReferences`, never before, so an image that
 * genuinely was inlined is never mistaken for one that wasn't.
 */
const CID_IMG_TAG_PATTERN = /<img\b[^>]*\bsrc=(["'])cid:([^"'()\s>]+)\1[^>]*>/gi;

/** Inert (no src, no script, no network egress) placeholder markup -- safe
 * under the strictest `sandbox=""` + CSP the mail viewer ever applies. Never
 * promises a fetch the sandbox cannot make; the real bytes stay reachable
 * only through the same-origin, authed attachment-download route. */
const CID_PLACEHOLDER_MARKUP =
  '<span data-evhost-cid-placeholder="true" '
  + 'style="display:inline-block;padding:4px 8px;border:1px solid #d0d5dd;border-radius:4px;'
  + 'background:#f2f4f7;color:#475467;font-size:12px;line-height:1.4;">'
  + "Image attachment — available for download</span>";

/**
 * Replaces every remaining `cid:`-sourced `<img>` with an honest inert
 * placeholder, for any `cid:` token that matches a known attachment's
 * `contentId` whose `inlineState` is not `"inlined"` (`"too_large"` or
 * `"error"`). A `cid:` token with no matching attachment at all is left
 * alone -- rewriteCidReferences's own "harmless, simply fails to load"
 * fallback -- since there is nothing concrete to offer a download for.
 * `attachments` defaults to `[]` so a caller that never learned the
 * attachment manifest (e.g. an older fixture) gets byte-identical output.
 */
export function renderUninlinedCidPlaceholders(
  html: string,
  attachments: readonly MailCidAttachmentRef[] = [],
): string {
  const nonInlinedContentIds = new Set(
    attachments
      .filter((attachment) => attachment.contentId && resolveAttachmentInlineState(attachment) !== "inlined")
      .map((attachment) => attachment.contentId as string),
  );
  if (nonInlinedContentIds.size === 0) return html;
  return html.replace(CID_IMG_TAG_PATTERN, (match: string, _quote: string, token: string) =>
    nonInlinedContentIds.has(token) ? CID_PLACEHOLDER_MARKUP : match,
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
