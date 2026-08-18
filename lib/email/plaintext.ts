// ---------------------------------------------------------------------------
// Shared HTML→plaintext extraction core.
//
// Originally lived only inside turo-parser.ts as `buildMessageText` (the
// subject+body fallback stored in every candidate's `proposedState.messageText`).
// Lifted out so the same tag-strip/entity-decode/whitespace-normalize logic backs
// three consumers instead of three copies drifting apart:
//   1. turo-parser.ts's candidate messageText (byte-identical to before this split —
//      see the pin test in plaintext.test.ts).
//   2. the email worker's tsvector search-index text.
//   3. the email worker's list-view snippet.
// Search text and card text must read the same body the same way, or a guest's
// search hit and the card they click through to can silently disagree — the pin
// test below is what keeps that property true.
// ---------------------------------------------------------------------------

/** Hard cap on combined subject+body text, matching the executor spec's "sane
 * bound" — generous enough for any real Turo template while keeping a single
 * jsonb value (or index row) bounded regardless of what an inbound message
 * contains. */
export const MESSAGE_TEXT_MAX_CHARS = 20_000;

/** Default length of the single-line list-view snippet derived from extracted text. */
export const SNIPPET_MAX_CHARS = 200;

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#x2019;|&rsquo;/gi, "’")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/**
 * Best-effort HTML → readable plain text: a simple tag-strip, not a full HTML
 * renderer. Block-level tags become line breaks first (so paragraphs/list items/table
 * rows don't run together into one unreadable line) before the remaining markup is
 * discarded and entities are decoded.
 */
export function htmlToReadableText(html: string): string {
  const withBreaks = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(withBreaks)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Minimal shape this module needs from an inbound email — a structural subset of
 * `@evhost/email-ingest-contract`'s `NormalizedEmailManifest`, kept narrow so this
 * module has no dependency on that package. */
export interface PlainTextEmailInput {
  subject: string;
  text: string;
  html: string | null;
}

/**
 * Subject + plain-text body, uncapped. Prefers the message's own `text` part
 * (already plain text per the email-ingest contract); falls back to stripping
 * tags from `html` only when no text part was captured. Returns null when
 * there's nothing readable at all (no subject-less email exists, but text/html
 * can both be empty) — callers should omit the field rather than write an
 * empty string, matching every other optional proposedState field's convention.
 */
export function extractEmailPlainText(email: PlainTextEmailInput): string | null {
  const body = email.text.trim().length > 0
    ? email.text.trim()
    : email.html
      ? htmlToReadableText(email.html)
      : "";
  if (!body && !email.subject.trim()) return null;
  return `Subject: ${email.subject}\n\n${body}`.trim();
}

/** Truncates `value` to `maxChars`, appending an ellipsis when truncated. */
export function capText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

/**
 * Subject + plain-text body, capped at `MESSAGE_TEXT_MAX_CHARS`. This is the exact
 * extraction turo-parser stores as `proposedState.messageText` — also the text the
 * email worker indexes into the tsvector search column, so a search hit and the
 * candidate card it links to are guaranteed to agree on what the message says.
 */
export function extractEmailMessageText(email: PlainTextEmailInput): string | null {
  const combined = extractEmailPlainText(email);
  return combined === null ? null : capText(combined, MESSAGE_TEXT_MAX_CHARS);
}

/**
 * First ~`maxChars` of extracted text, collapsed to a single line — the list-view
 * snippet. Built from the same extraction as the search index and the card text, so
 * the snippet a guest sees while scanning the list is never a different reading of
 * the message than the one search matched against or the detail view renders.
 */
export function buildSnippet(text: string, maxChars: number = SNIPPET_MAX_CHARS): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return capText(singleLine, maxChars);
}
