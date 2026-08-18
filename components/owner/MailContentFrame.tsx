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
 *
 * Scale-to-fit (GAP-3 fix): the container's width is tracked in state via a
 * ResizeObserver set up in useLayoutEffect, never read off a ref during
 * render -- a ref is always null on a component's first render, so reading
 * `containerRef.current` inline made the initial scale permanently 1
 * whenever nothing else forced a re-render (the dev harness; a race
 * elsewhere). The wrapper below carries `data-mail-scale` with the exact
 * scale actually applied, an observable contract e2e tests assert against.
 */

import { useLayoutEffect, useMemo, useState } from "react";
import { Button, Card, cn } from "../ui";
import {
  assembleSrcdoc,
  buildMailCsp,
  computeScaleToFit,
  renderUninlinedCidPlaceholders,
  rewriteCidReferences,
  type MailCidAttachmentRef,
} from "./mail-render-prep";
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
  /** The content manifest's attachment entries (T11's `attachments` field) --
   * used only to render an honest inert placeholder for a `cid:` image that
   * has a known attachment but wasn't inlined (GAP-4). Optional/defaulted so
   * a caller that doesn't have the manifest (the dev/e2e harness fixture)
   * renders byte-identical to before. */
  attachments?: readonly MailCidAttachmentRef[];
  className?: string;
  /** The persisted per-message-per-workspace opt-in (design doc Open
   * Question 1) as of the last content fetch -- initializes the toggle so a
   * message someone already opted in stays opted in on a later visit,
   * rather than resetting every navigation. */
  initialRemoteImagesAllowed?: boolean;
  /** Fired once, the first time this render turns the opt-in on, so the
   * caller can persist it (setMailRemoteImagesAllowed) -- best-effort; a
   * failed persist never blocks or reverts the in-session render. */
  onRemoteImagesAllowed?: () => void;
}

type ViewTab = "html" | "text";

export function MailContentFrame({
  html,
  text,
  inline,
  attachments = [],
  className,
  initialRemoteImagesAllowed = false,
  onRemoteImagesAllowed,
}: MailContentFrameProps) {
  const [remoteImagesAllowed, setRemoteImagesAllowed] = useState(initialRemoteImagesAllowed);
  const [tab, setTab] = useState<ViewTab>(html ? "html" : "text");
  // A callback ref (state, not useRef) so the measuring effect below
  // re-runs when the wrapper element itself mounts/unmounts -- it only
  // exists in the DOM while `tab === "html" && srcdoc`, so a bare useRef
  // would silently stop tracking width across a tab switch.
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(ASSUMED_MAIL_CONTENT_WIDTH);

  const srcdoc = useMemo(() => {
    if (!html) return null;
    const stripped = stripUntrustedHtml(html);
    const withInlineImages = rewriteCidReferences(stripped, inline);
    const withPlaceholders = renderUninlinedCidPlaceholders(withInlineImages, attachments);
    const csp = buildMailCsp(remoteImagesAllowed);
    return assembleSrcdoc(withPlaceholders, csp);
  }, [html, inline, attachments, remoteImagesAllowed]);

  // Real scale-to-fit: measured off the container's actual rendered width,
  // tracked live via ResizeObserver -- never read off a ref during render
  // (a ref is always null on first render, which is exactly why the scale
  // used to stay 1 forever). Recomputes whenever the wrapper (re)mounts or
  // `srcdoc` changes (a new message), in addition to any real resize.
  useLayoutEffect(() => {
    if (!containerNode) return;
    const measure = () => setContainerWidth(containerNode.clientWidth || ASSUMED_MAIL_CONTENT_WIDTH);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(containerNode);
    return () => observer.disconnect();
  }, [containerNode, srcdoc]);

  const scale = computeScaleToFit(ASSUMED_MAIL_CONTENT_WIDTH, containerWidth);

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
              onClick={() => {
                setRemoteImagesAllowed(true);
                onRemoteImagesAllowed?.();
              }}
            >
              Load remote images
            </Button>
          )}
        </div>
      )}

      {tab === "html" && srcdoc ? (
        <div
          ref={setContainerNode}
          data-mail-scale={scale}
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
