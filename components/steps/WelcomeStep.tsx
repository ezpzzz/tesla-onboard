"use client";

import { useTenantConfig } from "@/components/TenantConfigProvider";
import { Button, StepFrame } from "../ui";
import { IconArrowRight, IconBolt, IconCheck, IconSparkle } from "../icons";
import { VehicleArtwork } from "@/components/vehicle/VehicleArtwork";
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
  const { config } = useTenantConfig();
  const { car, companyName, tagline } = config;

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
      <div className="relative mb-7">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
            {companyName}
          </span>
          <span className="h-3 w-3 rounded-full bg-brand shadow-[0_0_12px_2px] shadow-brand/50" />
        </div>
        <VehicleArtwork
          model={car.model}
          color={car.color}
          trim={car.trim}
          wheelType={car.wheelType}
          interior={car.interior}
          interiorCode={car.teslaInteriorCode}
          paintCode={car.teslaPaintCode}
          year={car.year}
          configurationVerified={Boolean(car.sourceVehicleId)}
          eager
          className="mt-2 h-48 sm:h-72"
        />
        <div className="mt-1">
          <div className="text-2xl font-semibold tracking-tight text-ink">
            {car.model} {car.trim}
          </div>
          <div className="text-sm text-muted">
            {car.year} · {car.color}{car.interior ? ` · ${car.interior}` : ""}
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
