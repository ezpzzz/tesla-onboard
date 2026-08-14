"use client";

import { AUTH_MODE } from "@/lib/tesla";
import { connectHref, useOwnerTeslaConnect } from "@/lib/owner/use-owner-tesla-connect";
import { Badge, Button, Card, StepFrame } from "@/components/ui";
import { IconArrowRight, IconBolt, IconCheck } from "@/components/icons";
import { indexOfSetupStep } from "@/lib/owner/setup-flow";
import type { SetupStepProps } from "./types";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";

export function ConnectStep({ state, update, nav }: SetupStepProps) {
  const { workspace } = useOwnerTenant();
  const { authError, linking, useDifferentAccount } = useOwnerTeslaConnect(
    state.teslaProfile,
    update,
  );
  const profile = state.teslaProfile;
  const connected = !!profile;
  const stepNumber = indexOfSetupStep(state.step) + 1;

  if (linking) {
    return (
      <StepFrame>
        <div className="flex h-full flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-2 border-line border-t-ink" />
          <p className="text-sm text-muted">Linking your Tesla account…</p>
        </div>
      </StepFrame>
    );
  }

  if (connected && profile) {
    const firstName = profile.firstName && profile.firstName !== "there" ? profile.firstName : null;
    const carCount = profile.vehicles.length;
    return (
      <StepFrame
        inlineFooter
        footer={
          <div className="space-y-2.5">
            <Button fullWidth onClick={nav.next}>
              Continue <IconArrowRight className="h-4 w-4" />
            </Button>
            <button
              onClick={useDifferentAccount}
              className="block w-full text-center text-sm font-medium text-muted hover:text-ink"
            >
              Use a different account
            </button>
          </div>
        }
      >
        <div className="flex flex-col items-center pt-2 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-good/10">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-good text-white">
              <IconCheck className="h-6 w-6" />
            </span>
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
            Connected
          </span>
          <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-tight">
            {firstName ? `Hey, ${firstName}.` : "You're connected."}
          </h1>
          <p className="mt-2 max-w-[32ch] text-[15px] leading-relaxed text-muted">
            {carCount > 0
              ? `We found ${carCount} vehicle${carCount > 1 ? "s" : ""} on your Tesla account.`
              : "No vehicles on this Tesla account yet — you can still add cars by hand next."}
          </p>
        </div>

        <Card className="mt-6 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-lg">
              👤
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium">
                {profile.fullName || firstName || profile.email || "Tesla account"}
              </div>
              {profile.email && (profile.fullName || firstName) && (
                <div className="truncate text-sm text-muted">{profile.email}</div>
              )}
            </div>
          </div>
        </Card>
      </StepFrame>
    );
  }

  return (
    <StepFrame
      inlineFooter
      footer={
        <div className="space-y-2.5">
          <Button
            fullWidth
            onClick={() => {
              if (!workspace) return;
              window.location.href = connectHref({
                workspaceId: workspace.id,
                shopSlug: workspace.shopSlug,
              });
            }}
            disabled={!workspace}
          >
            <IconBolt className="h-4 w-4" /> Connect with Tesla
          </Button>
          <Button variant="secondary" fullWidth onClick={() => nav.goTo("import")}>
            Skip — I&apos;ll add vehicles manually
          </Button>
        </div>
      }
    >
      {authError && (
        <div className="mb-4 rounded-2xl border border-brand/20 bg-brand/5 p-3.5 text-sm leading-relaxed text-ink-soft">
          {authError}
        </div>
      )}

      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
        Step {stepNumber}
      </span>
      <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-tight">
        Connect your Tesla account.
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        {ONLYEVS_OPERATIONS_ENABLED
          ? "We'll import your fleet, keep last-known operating stats current, and issue time-limited Tesla driver access for confirmed trips."
          : "We'll read your Tesla account and import the vehicles you choose into this workspace."}
      </p>

      <Card className="mt-6 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink">
            <IconBolt className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-medium">Why connect?</div>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">
              {ONLYEVS_OPERATIONS_ENABLED
                ? "Tesla will ask for vehicle data, location, and command access. evhost.app uses commands solely to create and revoke trip-bound driver access; it never sends driving controls on a guest's behalf."
                : "Tesla will ask for vehicle data access so evhost.app can identify and import the vehicles on your account. No vehicle commands are requested."}
            </p>
          </div>
        </div>
      </Card>

      {AUTH_MODE === "mock" && (
        <div className="mt-4 flex items-center gap-2">
          <Badge tone="brand">Demo mode</Badge>
          <span className="text-xs text-muted">
            Sign-in is simulated — no real Tesla account needed.
          </span>
        </div>
      )}
    </StepFrame>
  );
}
