"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { useVehicleState } from "@/lib/owner/vehicle-state";
import { tenantCarFromVehicle } from "@/lib/tenant-vehicle";
import { tenantConfigPublicationIssues } from "@/lib/tenant-config";
import { Button, StepFrame } from "@/components/ui";
import { IconCheck, IconSparkle } from "@/components/icons";
import type { SetupStepProps } from "./types";

export function DoneStep({ update }: SetupStepProps) {
  const router = useRouter();
  const { config } = useTenantConfig();
  const { saveConfig } = useOwnerTenant();
  const { vehicles, hydrated, error } = useVehicleState();
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const activeCount = vehicles.filter((v) => v.status === "active").length;
  const source = config.car.sourceVehicleId
    ? vehicles.find((vehicle) =>
        vehicle.guestSourceId === config.car.sourceVehicleId && vehicle.status === "active"
      )
    : null;
  const publicationIssues = tenantConfigPublicationIssues(config);
  const canPublish = hydrated && !error && Boolean(source) && publicationIssues.length === 0;

  async function finish() {
    if (!source || !canPublish) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const completedAt = Date.now();
      const nextConfig = { ...config, car: tenantCarFromVehicle(source) };
      await saveConfig(nextConfig, { publishedAt: completedAt });
      // Browser progress is updated only after the durable workspace publish
      // succeeds; revisiting a stale local bookmark can never imply readiness.
      update({ completedAt });
      router.push("/owner");
    } catch (finishError) {
      setPublishError(
        finishError instanceof Error
          ? finishError.message
          : "Guest onboarding could not be published.",
      );
    } finally {
      setPublishing(false);
    }
  }

  return (
    <StepFrame
      footer={
        <div className="space-y-2.5">
          <Button
            variant="brand"
            fullWidth
            disabled={!canPublish || publishing}
            onClick={() => void finish()}
          >
            {publishing ? "Publishing…" : "Publish guest onboarding"}
          </Button>
          <button
            onClick={() => router.push("/owner/vehicles")}
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
            ? "The workspace fleet could not be verified. Guest onboarding remains unpublished."
            : !hydrated
              ? "Verifying your durable workspace fleet…"
              : !source
                ? `${activeCount} active vehicle${activeCount === 1 ? "" : "s"} found, but no active vehicle is linked to the guest walkthrough.`
                : publicationIssues.length > 0
                  ? `Finish the rental settings before publishing: ${publicationIssues[0]}.`
                  : "Your active fleet vehicle and rental settings are ready to publish for guests."}
        </p>
        {publishError ? (
          <p role="alert" className="mt-3 max-w-[34ch] text-sm leading-relaxed text-danger">
            {publishError}
          </p>
        ) : null}
      </div>
    </StepFrame>
  );
}
