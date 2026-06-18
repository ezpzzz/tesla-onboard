"use client";

import { AUTH_MODE } from "@/lib/tesla";
import { useTeslaConnect } from "@/lib/use-tesla-connect";
import { Badge, Button, Card, StepFrame } from "../ui";
import { IconArrowLeft, IconArrowRight, IconBolt, IconCheck, IconExternal } from "../icons";
import type { StepProps } from "../step-types";

const linkBtn =
  "inline-flex w-full items-center justify-center gap-2 rounded-full border border-line bg-white px-6 py-3.5 text-[15px] font-medium text-ink transition-colors hover:bg-surface";

export function TeslaAccountStep({ state, update, nav }: StepProps) {
  const { connected, authError, linking, connectWithTesla } = useTeslaConnect(state, update);
  const rawName = state.profile?.firstName;
  const name = rawName && rawName !== "there" ? rawName : null;

  const BackButton = (
    <Button variant="secondary" onClick={nav.prev} aria-label="Back">
      <IconArrowLeft className="h-4 w-4" />
    </Button>
  );

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

  // Signed in — requirement met, let them continue.
  if (connected && state.profile) {
    const p = state.profile;
    const carCount = p.vehicles.length;
    return (
      <StepFrame
        footer={
          <div className="flex items-center gap-3">
            {BackButton}
            <Button fullWidth onClick={nav.next}>
              Continue <IconArrowRight className="h-4 w-4" />
            </Button>
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
            Account connected
          </span>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">
            You&apos;re all set{name ? `, ${name}` : ""}.
          </h1>
          <p className="mt-2 max-w-[32ch] text-[15px] leading-relaxed text-muted">
            Your Tesla account is linked — that&apos;s your phone key and charging
            sorted. Let&apos;s keep going.
          </p>
        </div>

        <Card className="mt-6 p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-lg">
              👤
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium">
                {p.fullName || name || p.email || "Tesla account"}
              </div>
              <div className="truncate text-sm text-muted">
                {carCount > 0
                  ? `${carCount} vehicle${carCount > 1 ? "s" : ""} on your account`
                  : "No vehicles yet — this rental will be your first drive"}
              </div>
            </div>
          </div>
        </Card>
      </StepFrame>
    );
  }

  // Not connected — guide account creation, then require sign-in to continue.
  return (
    <StepFrame
      footer={
        <div className="flex items-center gap-3">
          {BackButton}
          <Button fullWidth onClick={connectWithTesla}>
            <IconBolt className="h-4 w-4" /> Sign in with Tesla
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
        Before you drive
      </span>
      <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">
        Set up your Tesla account
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Everything in this car runs through the Tesla app — it&apos;s your key, it
        starts the car, handles charging, and helps you find it in a parking lot.
        A Tesla account is free, and you&apos;ll want it ready before pickup.
      </p>

      <ol className="mt-6 space-y-4">
        <li className="flex gap-3.5">
          <Stepno n={1} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Create your account</div>
            <p className="mt-0.5 text-[15px] leading-relaxed text-muted">
              Download the Tesla app and tap <span className="font-medium text-ink">Sign Up</span>.
              All it takes is an email and phone number — no car required.
            </p>
            <a
              href="https://www.tesla.com/app"
              target="_blank"
              rel="noopener noreferrer"
              className={`${linkBtn} mt-3`}
            >
              Get the Tesla app <IconExternal className="h-3.5 w-3.5" />
            </a>
          </div>
        </li>
        <li className="flex gap-3.5">
          <Stepno n={2} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Sign in to continue</div>
            <p className="mt-0.5 text-[15px] leading-relaxed text-muted">
              Once your account exists, sign in below so we can finish tailoring
              this walkthrough to you.
            </p>
          </div>
        </li>
      </ol>

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

function Stepno({ n }: { n: number }) {
  return (
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-white">
      {n}
    </span>
  );
}
