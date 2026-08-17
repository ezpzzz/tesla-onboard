import { describe, expect, it } from "vitest";
import type { NormalizedEmailManifest } from "@evhost/email-ingest-contract";
import { parseTuroEmail } from "./turo-parser";
import {
  MESSAGE_TEXT_MAX_CHARS,
  SNIPPET_MAX_CHARS,
  buildSnippet,
  capText,
  decodeHtmlEntities,
  extractEmailMessageText,
  extractEmailPlainText,
  htmlToReadableText,
} from "./plaintext";

function manifest(overrides: Partial<NormalizedEmailManifest>): NormalizedEmailManifest {
  return {
    version: 1,
    from: "Turo <noreply@mail.turo.com>",
    to: "proxy@mail.evhost.app",
    subject: "Riley's trip with your Tesla Model 3 is booked!",
    messageId: "<synthetic-1@example>",
    date: "2026-08-15T12:00:00Z",
    text: "",
    html: null,
    receiverAuth: { dkim: "pass", dmarc: "pass", spf: "pass", arc: "unknown" },
    ...overrides,
  };
}

describe("plaintext extractor — search-equals-card pin", () => {
  it("produces exactly the messageText the parser stores in proposedState, from an html-only email", () => {
    const email = manifest({
      text: "",
      html: "<p>Hi Riley,</p><p>Your trip is <b>confirmed</b>.</p><div>See you soon &amp; drive safe.</div>",
    });

    const parsed = parseTuroEmail(email, new Set());
    const extracted = extractEmailMessageText(email);

    expect(parsed.proposedState.messageText).toBe(extracted);
    expect(extracted).not.toBeNull();
  });

  it("produces exactly the messageText the parser stores in proposedState, from a text-part email", () => {
    const email = manifest({
      text: "Hi Riley,\n\nYour trip is confirmed.\nSee you soon.",
      html: "<p>ignored because text part exists</p>",
    });

    const parsed = parseTuroEmail(email, new Set());
    const extracted = extractEmailMessageText(email);

    expect(parsed.proposedState.messageText).toBe(extracted);
  });

  it("agrees on the null case (no subject-less email exists, but body can be empty)", () => {
    const email = manifest({ subject: "  ", text: "", html: null });

    const parsed = parseTuroEmail(email, new Set());
    const extracted = extractEmailMessageText(email);

    // Convention: an unreadable message omits the field entirely rather than
    // writing null/"" — proposedState.messageText is undefined here, extractor is null.
    expect(parsed.proposedState.messageText ?? null).toBe(extracted);
    expect(extracted).toBeNull();
  });

  it("agrees under the 20K cap on a very long body", () => {
    const longHtml = `<p>${"guest message ".repeat(3000)}</p>`;
    const email = manifest({ text: "", html: longHtml });

    const parsed = parseTuroEmail(email, new Set());
    const extracted = extractEmailMessageText(email);

    expect(parsed.proposedState.messageText).toBe(extracted);
    expect(extracted!.length).toBeLessThanOrEqual(MESSAGE_TEXT_MAX_CHARS + 1); // +1 for the ellipsis char
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes the common entities used in Turo templates", () => {
    expect(decodeHtmlEntities("Tom &amp; Jerry&#39;s &quot;trip&quot; &rsquo;&nbsp;&lt;done&gt;")).toBe(
      "Tom & Jerry's \"trip\" ’ <done>",
    );
  });
});

describe("htmlToReadableText", () => {
  it("turns block-level tags into line breaks and strips scripts/styles", () => {
    const html =
      "<style>.x{color:red}</style><p>Line one</p><p>Line two</p><script>evil()</script><div>Line three</div>";
    expect(htmlToReadableText(html)).toBe("Line one\nLine two\nLine three");
  });
});

describe("extractEmailPlainText / extractEmailMessageText", () => {
  it("prefers the text part over html", () => {
    const email = { subject: "S", text: "plain text body", html: "<p>html body</p>" };
    expect(extractEmailPlainText(email)).toBe("Subject: S\n\nplain text body");
  });

  it("falls back to html when text is empty", () => {
    const email = { subject: "S", text: "  ", html: "<p>html body</p>" };
    expect(extractEmailPlainText(email)).toBe("Subject: S\n\nhtml body");
  });

  it("returns null only when subject and body are both empty", () => {
    expect(extractEmailPlainText({ subject: "  ", text: "", html: null })).toBeNull();
    expect(extractEmailPlainText({ subject: "Subj", text: "", html: null })).toBe("Subject: Subj");
  });

  it("caps combined text at MESSAGE_TEXT_MAX_CHARS with an ellipsis", () => {
    const email = { subject: "S", text: "x".repeat(MESSAGE_TEXT_MAX_CHARS + 500), html: null };
    const result = extractEmailMessageText(email)!;
    expect(result.length).toBe(MESSAGE_TEXT_MAX_CHARS + 1);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("capText", () => {
  it("leaves short values untouched", () => {
    expect(capText("hello", 10)).toBe("hello");
  });

  it("truncates and appends an ellipsis when over the cap", () => {
    expect(capText("hello world", 5)).toBe("hello…");
  });
});

describe("buildSnippet", () => {
  it("collapses whitespace/newlines to a single line and caps at SNIPPET_MAX_CHARS by default", () => {
    const text = "Subject: Hi\n\nLine one\nLine two   with   extra   spaces";
    expect(buildSnippet(text)).toBe("Subject: Hi Line one Line two with extra spaces");
  });

  it("caps long text at the given maxChars", () => {
    const text = "word ".repeat(100);
    const snippet = buildSnippet(text, 20);
    expect(snippet.length).toBe(21); // +1 for ellipsis
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("is a single-line prefix of the parser's messageText for a real candidate", () => {
    const email = manifest({
      text: "",
      html: "<p>Hi Riley,</p><p>Your trip is confirmed for next week.</p>",
    });
    const parsed = parseTuroEmail(email, new Set());
    const cardText = parsed.proposedState.messageText!;
    const snippet = buildSnippet(cardText, 20);
    expect(snippet).not.toMatch(/\n/);
    expect(cardText.replace(/\s+/g, " ").trim().startsWith(snippet.replace("…", ""))).toBe(true);
  });
});
