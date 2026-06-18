"use client";

import { AUTH_MODE, NEW_GUEST_PROFILE } from "@/lib/tesla";
import { useTeslaConnect } from "@/lib/use-tesla-connect";
import { Badge, Button, Card, StepFrame } from "../ui";
import { IconArrowRight, IconBolt, IconCheck } from "../icons";
import type { StepProps } from "../step-types";

export function ConnectStep({ state, update, nav }: StepProps) {
  const { connected, authError, linking, connectWithTesla, useDifferentAccount } =
    useTeslaConnect(state, update);

  function continueAsNew() {
    update({
      profile: NEW_GUEST_PROFILE,
      experience: "new",
      pathMode: "full",
      newToTesla: true,
      stepId: "plan",
      startedAt: state.startedAt ?? Date.now(),
    });
  }

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

  if (connected && state.profile) {
    const p = state.profile;
    const firstName = p.firstName && p.firstName !== "there" ? p.firstName : null;
    const carCount = p.vehicles.length;
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
            Signed in with Tesla
          </span>
          <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">
            You&apos;re connected{firstName ? `, ${firstName}` : ""}.
          </h1>
          <p className="mt-2 max-w-[32ch] text-[15px] leading-relaxed text-muted">
            We pulled just enough from your Tesla account to tailor your walkthrough.
          </p>
        </div>

        <div className="mt-6 mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          Account
        </div>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface text-lg">
              👤
            </span>
            <div className="min-w-0">
              <div className="truncate font-medium">
                {p.fullName || firstName || p.email || "Tesla account"}
              </div>
              {p.email && (p.fullName || firstName) && (
                <div className="truncate text-sm text-muted">{p.email}</div>
              )}
            </div>
          </div>
        </Card>

        <div className="mt-5 mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            {carCount > 0 ? `Your vehicle${carCount > 1 ? "s" : ""}` : "Vehicles"}
          </span>
          {carCount > 0 && <Badge tone="good">{carCount} found</Badge>}
        </div>
        {carCount > 0 ? (
          <Card className="divide-y divide-line">
            {p.vehicles.map((v) => (
              <div key={v.id} className="flex items-center gap-3 p-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface text-lg">
                  🚗
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-medium">{v.displayName}</div>
                  <div className="truncate text-sm text-muted">
                    {v.model}
                    {v.year ? ` · ${v.year}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </Card>
        ) : (
          <Card className="p-4 text-sm leading-relaxed text-muted">
            No vehicles on your Tesla account yet — we&apos;ll focus on this
            rental&apos;s essentials.
          </Card>
        )}
      </StepFrame>
    );
  }

  return (
    <StepFrame
      inlineFooter
      footer={
        <div className="space-y-2.5">
          <Button fullWidth onClick={connectWithTesla}>
            <IconBolt className="h-4 w-4" /> Connect with Tesla
          </Button>
          <Button variant="secondary" fullWidth onClick={continueAsNew}>
            I&apos;m new to Tesla
          </Button>
        </div>
      }
    >
      {authError && (
        <div className="mb-4 rounded-2xl border border-brand/20 bg-brand/5 p-3.5 text-sm leading-relaxed text-ink-soft">
          {authError}
        </div>
      )}

      <Eyebrow>Step 1</Eyebrow>
      <h1 className="mt-1 text-[26px] font-semibold leading-tight tracking-tight">
        Let&apos;s tailor this to you.
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        Connect your Tesla account and we&apos;ll skip straight past anything you
        already know. New to Tesla? No problem — we&apos;ll walk you through it all.
      </p>

      <Card className="mt-6 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-ink">
            <IconBolt className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-medium">Why connect?</div>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">
              We use your name and which Teslas are on your account to right-size
              this guide — skipping what you already know. Takes a few seconds.
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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
      {children}
    </span>
  );
}
