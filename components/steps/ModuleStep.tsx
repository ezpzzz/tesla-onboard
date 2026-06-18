"use client";

import { Button, IconCircle, StepFrame } from "../ui";
import { VideoEmbed } from "../VideoEmbed";
import { IconArrowLeft, IconArrowRight } from "../icons";
import type { StepProps } from "../step-types";

/** Render copy with **bold** spans (lets host config emphasize e.g. a phone number). */
function renderRich(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
    seg.startsWith("**") && seg.endsWith("**") ? (
      <strong key={i} className="font-semibold text-ink">
        {seg.slice(2, -2)}
      </strong>
    ) : (
      seg
    ),
  );
}

export function ModuleStep({ step, nav }: StepProps) {
  if (step.kind !== "module") return null;
  const m = step.module;

  return (
    <StepFrame
      footer={
        <div className="flex items-center gap-3">
          <Button variant="secondary" onClick={nav.prev} aria-label="Back">
            <IconArrowLeft className="h-4 w-4" />
          </Button>
          <Button fullWidth onClick={nav.next}>
            {nav.isLast ? "Finish" : "Got it"} <IconArrowRight className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <IconCircle>{m.emoji}</IconCircle>
        <div className="pt-0.5">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">
            {m.tagline}
          </span>
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight">
            {m.title}
          </h1>
        </div>
      </div>

      <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">{renderRich(m.intro)}</p>

      {m.video && (
        <div className="mt-5">
          <VideoEmbed video={m.video} />
        </div>
      )}

      <ul className="mt-6 space-y-4">
        {m.points.map((pt, i) => (
          <li key={i} className="flex gap-3.5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
              {i + 1}
            </span>
            <div>
              <div className="text-[15px] font-semibold">{pt.heading}</div>
              <p className="mt-0.5 text-[15px] leading-relaxed text-muted">
                {renderRich(pt.detail)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {m.rentalNote && (
        <div className="mt-6 rounded-2xl border border-brand/20 bg-brand/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-brand">
            For this car
          </div>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">
            {renderRich(m.rentalNote)}
          </p>
        </div>
      )}
    </StepFrame>
  );
}
