"use client";

import { hostConfig } from "@/lib/config";
import { Button, StepFrame } from "../ui";
import { IconArrowRight, IconBolt, IconCheck, IconSparkle } from "../icons";
import type { StepProps } from "../step-types";

const highlights = [
  {
    icon: <IconSparkle className="h-4 w-4" />,
    text: "Adaptive — connect your Tesla account and skip what you already know.",
  },
  {
    icon: <IconBolt className="h-4 w-4" />,
    text: "Bite-sized lessons with official Tesla videos for the Model 3.",
  },
  {
    icon: <IconCheck className="h-4 w-4" />,
    text: "Pick up right where you left off — your progress is saved.",
  },
];

export function WelcomeStep({ nav, update, state }: StepProps) {
  const { car, companyName, tagline } = hostConfig;

  return (
    <StepFrame
      inlineFooter
      footer={
        <Button
          fullWidth
          onClick={() => {
            if (!state.startedAt) update({ startedAt: Date.now() });
            nav.next();
          }}
        >
          Let&apos;s get started <IconArrowRight className="h-4 w-4" />
        </Button>
      }
    >
      <div
        className="relative mb-6 overflow-hidden rounded-3xl p-6 text-white"
        style={{ backgroundImage: "linear-gradient(135deg, #171a20, #393c41)" }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-white/60">
            {companyName}
          </span>
          <span className="h-3 w-3 rounded-full bg-brand shadow-[0_0_12px_2px] shadow-brand/50" />
        </div>
        <div className="mt-10 flex items-end justify-between">
          <div>
            <div className="text-5xl leading-none">🚗⚡</div>
            <div className="mt-3 text-2xl font-semibold tracking-tight">
              {car.model} {car.trim}
            </div>
            <div className="text-sm text-white/60">
              {car.year} · {car.color}
            </div>
          </div>
        </div>
      </div>

      <h1 className="text-[28px] font-semibold leading-tight tracking-tight">
        Welcome aboard. Let&apos;s get you driving.
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        {tagline} This quick guide makes your Tesla rental feel second-nature —
        whether it&apos;s your hundredth EV or your very first.
      </p>

      <ul className="mt-6 space-y-3">
        {highlights.map((h, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface text-ink">
              {h.icon}
            </span>
            <span className="text-[15px] leading-relaxed text-ink-soft">{h.text}</span>
          </li>
        ))}
      </ul>
    </StepFrame>
  );
}
