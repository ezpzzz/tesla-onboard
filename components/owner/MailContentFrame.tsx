"use client";

/**
 * Sandboxed full-content mail renderer (T12, design doc
 * alex-email-inbox-design-20260817-123909.md Premise 2). Consumes the
 * decrypt-on-read response shape from GET /api/owner/mail/[id]/content
 * (app/api/owner/mail/[id]/content/route.ts): { html, text, inline }.
 *
 * Security model, front to back:
 *   1. mail-strip-html.ts's DOMParser pass removes the obvious hostile
 *      surface (script/iframe/object/embed/form/meta-refresh, on* handlers,
 *      javascript: URLs, external stylesheets) -- a genuine second layer,
 *      not the boundary itself.
 *   2. mail-render-prep.ts's rewriteCidReferences swaps cid: references for
 *      the server-inlined data: payloads, AFTER the strip.
 *   3. assembleSrcdoc wraps the result with the CSP from buildMailCsp.
 *   4. The iframe below carries `sandbox=""` -- no allow-scripts, ever --
 *      so even markup that survived every prior layer cannot execute.
 * Height is solved without in-frame JS: a fixed max-height plus internal
 * scroll, never a postMessage height handshake, so "zero script execution"
 * stays literally true.
 */

import { useMemo, useRef, useState } from "react";
import { Button, Card, cn } from "../ui";
import { assembleSrcdoc, buildMailCsp, computeScaleToFit, rewriteCidReferences } from "./mail-render-prep";
import { stripUntrustedHtml } from "./mail-strip-html";

/** Fixed-width transactional HTML norm (Turo's own templates run
 * 600-650px tables) -- the scale-to-fit reference width until the real
 * rendered content width is measured. */
const ASSUMED_MAIL_CONTENT_WIDTH = 650;
const FRAME_MAX_HEIGHT_PX = 720;

export interface MailContentFrameProps {
  html: string | null;
  text: string;
  /** Keyed by contentId -- exactly T11's `inline` response field. */
  inline: Record<string, string>;
  className?: string;
}

type ViewTab = "html" | "text";

export function MailContentFrame({ html, text, inline, className }: MailContentFrameProps) {
  const [remoteImagesAllowed, setRemoteImagesAllowed] = useState(false);
  const [tab, setTab] = useState<ViewTab>(html ? "html" : "text");
  const containerRef = useRef<HTMLDivElement>(null);

  const srcdoc = useMemo(() => {
    if (!html) return null;
    const stripped = stripUntrustedHtml(html);
    const withInlineImages = rewriteCidReferences(stripped, inline);
    const csp = buildMailCsp(remoteImagesAllowed);
    return assembleSrcdoc(withInlineImages, csp);
  }, [html, inline, remoteImagesAllowed]);

  // Best-effort initial scale: the container's own current width against the
  // fixed-width mail-table assumption above. Re-measuring on resize is
  // deliberately out of scope here -- this is the *initial* scale-to-fit the
  // design calls for, not a live-tracking transform; the horizontal-scroll
  // container remains the escape hatch either way.
  const scale = computeScaleToFit(
    ASSUMED_MAIL_CONTENT_WIDTH,
    containerRef.current?.clientWidth ?? ASSUMED_MAIL_CONTENT_WIDTH,
  );

  return (
    <Card className={cn("overflow-hidden", className)}>
      {html && (
        <div className="flex items-center gap-1 border-b border-line px-3 py-2">
          <button
            type="button"
            onClick={() => setTab("html")}
            className={cn(
              "rounded-md px-3 py-1.5 text-[13px] font-semibold",
              tab === "html" ? "bg-ink text-white" : "text-ink-muted hover:bg-line/40",
            )}
            aria-pressed={tab === "html"}
          >
            Message
          </button>
          <button
            type="button"
            onClick={() => setTab("text")}
            className={cn(
              "rounded-md px-3 py-1.5 text-[13px] font-semibold",
              tab === "text" ? "bg-ink text-white" : "text-ink-muted hover:bg-line/40",
            )}
            aria-pressed={tab === "text"}
          >
            Plain text
          </button>
          {tab === "html" && !remoteImagesAllowed && (
            <Button
              type="button"
              variant="secondary"
              className="ml-auto min-h-8 px-3 py-1.5 text-[12px]"
              onClick={() => setRemoteImagesAllowed(true)}
            >
              Load remote images
            </Button>
          )}
        </div>
      )}

      {tab === "html" && srcdoc ? (
        <div
          ref={containerRef}
          className="overflow-x-auto overflow-y-hidden bg-white"
          style={{ maxHeight: FRAME_MAX_HEIGHT_PX }}
        >
          <div style={{ width: ASSUMED_MAIL_CONTENT_WIDTH * scale }}>
            <iframe
              title="Email content"
              srcDoc={srcdoc}
              sandbox=""
              className="border-0"
              style={{
                width: ASSUMED_MAIL_CONTENT_WIDTH,
                height: FRAME_MAX_HEIGHT_PX,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        </div>
      ) : (
        <pre
          className="max-h-[720px] overflow-auto whitespace-pre-wrap break-words p-4 text-[13px] text-ink"
          style={{ maxHeight: FRAME_MAX_HEIGHT_PX }}
        >
          {text || "No plain-text content."}
        </pre>
      )}
    </Card>
  );
}
