"use client";

import { useRouter } from "next/navigation";
import { useVehicleState } from "@/lib/owner/vehicle-state";
import { Button, StepFrame } from "@/components/ui";
import { IconCheck, IconSparkle } from "@/components/icons";
import type { SetupStepProps } from "./types";

export function DoneStep({ update }: SetupStepProps) {
  const router = useRouter();
  const { vehicles, hydrated, error } = useVehicleState();
  const activeCount = vehicles.filter((v) => v.status === "active").length;

  // completedAt is set here, on an explicit action — not on mount — so a host
  // who lands on this step by resuming a bookmark, or via the browser's Back
  // button, doesn't get marked "done" before they've actually confirmed it.
  function finish(destination: "/owner" | "/owner/vehicles") {
    update({ completedAt: Date.now() });
    router.push(destination);
  }

  return (
    <StepFrame
      footer={
        <div className="space-y-2.5">
          <Button variant="brand" fullWidth onClick={() => finish("/owner")}>
            Go to dashboard
          </Button>
          <button
            onClick={() => finish("/owner/vehicles")}
            className="block w-full text-center text-sm font-medium text-muted hover:text-ink"
          >
            Review vehicles
          </button>
        </div>
      }
    >
      <div className="flex flex-col items-center pt-4 text-center">
        <div className="relative mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-good/10">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-good text-white">
            <IconCheck className="h-7 w-7" />
          </span>
          <span className="absolute -right-1 -top-1 text-brand">
            <IconSparkle className="h-6 w-6" />
          </span>
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">All set.</h1>
        <p className="mt-3 max-w-[34ch] text-[15px] leading-relaxed text-muted">
          {error
            ? "Your setup settings are saved, but the workspace fleet could not be verified. Review Vehicles before inviting guests."
            : hydrated
            ? `${activeCount} vehicle${activeCount === 1 ? "" : "s"} in your fleet.`
            : "Your fleet is ready."}{" "}
          {!error ? "You can revisit this setup anytime from the Vehicles page." : ""}
        </p>
      </div>
    </StepFrame>
  );
}
