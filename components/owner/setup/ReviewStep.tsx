"use client";

/**
 * Read-only recap of the guest-facing rental settings sourced from
 * lib/config.ts (hostConfig). No inputs here on purpose — this wizard edits
 * the owner dashboard's vehicle records, never hostConfig, so it can't
 * silently diverge from what a guest actually sees. See each field's
 * captioned source for where to change it instead.
 */

import { hostConfig } from "@/lib/config";
import { Button, Card, StepFrame } from "@/components/ui";
import { IconArrowRight } from "@/components/icons";
import { indexOfSetupStep } from "@/lib/owner/setup-flow";
import type { SetupStepProps } from "./types";

// Stacked, not side-by-side: this wizard is always rendered at phone width
// (max-w-[480px], even on desktop — see app/owner/setup/page.tsx), so there's
// no breakpoint at which a fixed-width source badge next to the label/value
// text has room to breathe. Stacking avoids the badge crowding long labels
// and values (e.g. "Roadside phone" / a formatted phone number) into
// mid-word wraps.
function ConfigRow({ label, value, source }: { label: string; value: string; source: string }) {
  return (
    <div className="space-y-1.5 p-3.5">
      <div className="min-w-0">
        <div className="text-sm text-muted">{label}</div>
        <div className="mt-0.5 text-[15px] font-medium leading-snug text-ink">{value || "—"}</div>
      </div>
      <code className="inline-block max-w-full truncate rounded-full bg-surface px-2.5 py-1 text-[11px] text-muted">
        {source}
      </code>
    </div>
  );
}

export function ReviewStep({ state, nav }: SetupStepProps) {
  const stepNumber = indexOfSetupStep(state.step) + 1;
  const { companyName, tagline, hostName, hostPhone, supportEmail, roadsidePhone, rental, houseRules } =
    hostConfig;

  return (
    <StepFrame
      inlineFooter
      footer={
        <Button fullWidth onClick={nav.next}>
          Continue <IconArrowRight className="h-4 w-4" />
        </Button>
      }
    >
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
        Step {stepNumber}
      </span>
      <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-tight">
        Your rental settings.
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Here&apos;s what guests will see in the walkthrough. These don&apos;t come from this
        wizard — change them in{" "}
        <code className="rounded bg-surface px-1 py-0.5 text-[13px]">.env.local</code> (or your
        deploy env), then redeploy.
      </p>

      <div className="mt-5 mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Contact
      </div>
      <Card className="divide-y divide-line">
        <ConfigRow label="Company name" value={companyName} source="NEXT_PUBLIC_COMPANY_NAME" />
        <ConfigRow label="Tagline" value={tagline} source="NEXT_PUBLIC_TAGLINE" />
        <ConfigRow label="Host name" value={hostName} source="NEXT_PUBLIC_HOST_NAME" />
        <ConfigRow label="Host phone" value={hostPhone} source="NEXT_PUBLIC_HOST_PHONE" />
        <ConfigRow label="Support email" value={supportEmail} source="NEXT_PUBLIC_SUPPORT_EMAIL" />
        <ConfigRow label="Roadside phone" value={roadsidePhone} source="NEXT_PUBLIC_ROADSIDE_PHONE" />
      </Card>

      <div className="mt-5 mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Rental policy
      </div>
      <Card className="divide-y divide-line">
        <ConfigRow label="Key access" value={rental.keyAccess} source="lib/config.ts" />
        <ConfigRow label="Charge access" value={rental.chargeAccess} source="lib/config.ts" />
        <ConfigRow label="Charging policy" value={rental.chargingPolicy} source="lib/config.ts" />
        <ConfigRow label="Return charge level" value={rental.returnChargeLevel} source="lib/config.ts" />
      </Card>

      <div className="mt-5 mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        House rules
      </div>
      <Card className="p-4">
        <ul className="space-y-2 text-sm leading-relaxed text-ink-soft">
          {houseRules.map((r, i) => (
            <li key={i}>• {r}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Source: <code className="rounded bg-surface px-1 py-0.5">lib/config.ts</code> — change
          it there, then redeploy.
        </p>
      </Card>
    </StepFrame>
  );
}
