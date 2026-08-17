import { describe, expect, it } from "vitest";
import {
  assembleSrcdoc,
  buildMailCsp,
  computeScaleToFit,
  rewriteCidReferences,
} from "@/components/owner/mail-render-prep";

describe("buildMailCsp", () => {
  it("returns the exact base directive string from Premise 2", () => {
    expect(buildMailCsp(false)).toBe(
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; "
      + "connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; "
      + "form-action 'none'; base-uri 'none'",
    );
  });

  it("widens only img-src when remote images are opted in, byte-identical otherwise", () => {
    expect(buildMailCsp(true)).toBe(
      "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'none'; "
      + "connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; "
      + "form-action 'none'; base-uri 'none'",
    );
  });

  it("never mixes the two img-src values", () => {
    expect(buildMailCsp(false)).not.toContain("https:");
    expect(buildMailCsp(true)).not.toMatch(/img-src data:;/);
  });
});

describe("rewriteCidReferences", () => {
  const inlineMap = { "logo@evhost": "data:image/png;base64,AAAA", "photo-1": "data:image/jpeg;base64,BBBB" };

  it("rewrites a double-quoted src=\"cid:...\" reference", () => {
    const html = '<img src="cid:logo@evhost" alt="logo">';
    expect(rewriteCidReferences(html, inlineMap)).toBe('<img src="data:image/png;base64,AAAA" alt="logo">');
  });

  it("rewrites a single-quoted reference", () => {
    const html = "<img src='cid:photo-1'>";
    expect(rewriteCidReferences(html, inlineMap)).toBe("<img src='data:image/jpeg;base64,BBBB'>");
  });

  it("rewrites a CSS url(cid:...) background reference", () => {
    const html = '<div style="background:url(cid:logo@evhost)"></div>';
    expect(rewriteCidReferences(html, inlineMap)).toBe(
      '<div style="background:url(data:image/png;base64,AAAA)"></div>',
    );
  });

  it("rewrites multiple references in one document", () => {
    const html = '<img src="cid:logo@evhost"><img src="cid:photo-1">';
    expect(rewriteCidReferences(html, inlineMap)).toBe(
      '<img src="data:image/png;base64,AAAA"><img src="data:image/jpeg;base64,BBBB">',
    );
  });

  it("leaves an unmapped cid: reference untouched rather than guessing", () => {
    const html = '<img src="cid:unknown-attachment">';
    expect(rewriteCidReferences(html, inlineMap)).toBe(html);
  });

  it("leaves html with no cid: references untouched", () => {
    const html = "<p>Hello guest</p>";
    expect(rewriteCidReferences(html, inlineMap)).toBe(html);
  });

  it("is a no-op with an empty inline map", () => {
    const html = '<img src="cid:logo@evhost">';
    expect(rewriteCidReferences(html, {})).toBe(html);
  });
});

describe("assembleSrcdoc", () => {
  it("assembles the exact document structure", () => {
    const csp = "default-src 'none'";
    const html = "<p>hi</p>";
    expect(assembleSrcdoc(html, csp)).toBe(
      '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'"></head>'
      + '<body><p>hi</p></body></html>',
    );
  });

  it("embeds the given CSP verbatim, including a widened img-src", () => {
    const csp = buildMailCsp(true);
    const out = assembleSrcdoc("<p>hi</p>", csp);
    expect(out).toContain(`content="${csp}"`);
  });

  it("handles empty body html", () => {
    expect(assembleSrcdoc("", "default-src 'none'")).toBe(
      '<!doctype html><html><head><meta charset="utf-8">'
      + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'"></head>'
      + '<body></body></html>',
    );
  });
});

describe("computeScaleToFit", () => {
  it("scales down a wider-than-viewport fixed-width table", () => {
    expect(computeScaleToFit(650, 390)).toBeCloseTo(390 / 650, 10);
  });

  it("never upscales past 1 when content is already narrower than the viewport", () => {
    expect(computeScaleToFit(400, 800)).toBe(1);
  });

  it("returns exactly 1 when content and viewport widths match", () => {
    expect(computeScaleToFit(650, 650)).toBe(1);
  });

  it.each([0, -100, NaN, Infinity])("falls back to 1 for an invalid contentWidth (%p)", (contentWidth) => {
    expect(computeScaleToFit(contentWidth, 400)).toBe(1);
  });

  it.each([0, -100, NaN, Infinity])("falls back to 1 for an invalid viewportWidth (%p)", (viewportWidth) => {
    expect(computeScaleToFit(650, viewportWidth)).toBe(1);
  });
});
