"use client";

import { StepFrame } from "@/components/ui";
import { TenantSettingsForm } from "@/components/owner/TenantSettingsForm";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { indexOfSetupStep } from "@/lib/owner/setup-flow";
import type { SetupStepProps } from "./types";

export function ReviewStep({ state, nav }: SetupStepProps) {
  const stepNumber = indexOfSetupStep(state.step) + 1;
  const { persistence } = useOwnerTenant();

  return (
    <StepFrame inlineFooter>
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
        Step {stepNumber}
      </span>
      <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-tight">
        Your rental settings.
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        {persistence === "workspace"
          ? "Complete the guest-facing settings. They are saved as a Sophosic workspace draft now and published only after the final step verifies an active linked fleet vehicle."
          : "Edit what guests will see. In demo mode, these settings preview locally in this browser."}
      </p>
      <div className="mt-6">
        <TenantSettingsForm onSaved={nav.next} submitLabel="Save & continue" />
      </div>
    </StepFrame>
  );
}
