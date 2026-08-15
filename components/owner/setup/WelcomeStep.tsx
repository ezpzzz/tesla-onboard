"use client";

import { useRouter } from "next/navigation";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { Button, StepFrame } from "@/components/ui";
import { IconArrowRight, IconBolt, IconCar, IconSparkle } from "@/components/icons";
import { VehicleArtwork } from "@/components/vehicle/VehicleArtwork";
import type { SetupStepProps } from "./types";

const highlights = [
  {
    icon: <IconBolt className="h-4 w-4" />,
    text: "Connect your Tesla account and we'll pull in your vehicles automatically.",
  },
  {
    icon: <IconCar className="h-4 w-4" />,
    text: "Or skip that and add cars by hand — whatever's fastest.",
  },
  {
    icon: <IconSparkle className="h-4 w-4" />,
    text: "Takes about a minute. You can finish it later from the Vehicles page.",
  },
];

export function WelcomeStep({ nav, update }: SetupStepProps) {
  const router = useRouter();
  const { config } = useTenantConfig();
  const { workspace } = useOwnerTenant();

  return (
    <StepFrame
      inlineFooter
      footer={
        <div className="space-y-2.5">
          <Button fullWidth onClick={nav.next}>
            Get started <IconArrowRight className="h-4 w-4" />
          </Button>
          <button
            onClick={() => {
              update({ dismissedAt: Date.now() });
              router.push("/owner");
            }}
            className="flex min-h-11 w-full items-center justify-center rounded-md text-center text-sm font-medium text-muted hover:bg-surface hover:text-ink"
          >
            Skip for now
          </button>
        </div>
      }
    >
      <div className="relative mb-7">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
            {config.companyName || workspace?.name || "Fleet setup"}
          </span>
          <span className="h-3 w-3 rounded-[3px] bg-brand" />
        </div>
        {config.car.model ? (
          <VehicleArtwork
            model={config.car.model}
            color={config.car.color}
            trim={config.car.trim}
            wheelType={config.car.wheelType}
            interior={config.car.interior}
            interiorCode={config.car.teslaInteriorCode}
            paintCode={config.car.teslaPaintCode}
            year={config.car.year}
            configurationVerified={Boolean(config.car.sourceVehicleId)}
            eager
            className="mt-2 h-44 sm:h-56"
          />
        ) : (
          <div className="mt-4 flex h-40 items-center justify-center rounded-lg border border-dashed border-line bg-surface px-6 text-center text-sm text-muted sm:h-52">
            Your imported or manually added fleet vehicle will appear here.
          </div>
        )}
        <div className="mt-1">
          <div className="text-2xl font-semibold tracking-tight text-ink">Set up your fleet</div>
          <div className="text-sm text-muted">A quick pass before your first guest arrives</div>
        </div>
      </div>

      <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
        Let&apos;s get your fleet set up.
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        We&apos;ll connect your Tesla account (optional), import your vehicles, and walk
        through the rental settings guests will see.
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
