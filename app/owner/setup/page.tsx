"use client";

/**
 * First-run owner fleet setup wizard — controller. Miniature of
 * components/OnboardingApp.tsx: reads useOwnerSetupState() post-hydration,
 * derives the current step from state.step (the resume pointer), renders the
 * matching step component, and owns nav (next/back/goTo) which just persists
 * state.step — same "state drives the flow" shape as the guest controller.
 *
 * Shell: this page already lives inside app/owner/layout.tsx's OwnerShell
 * (sidebar nav, host-view header, max-w content column), so it deliberately
 * does NOT reuse the guest AppShell — nesting AppShell's own full-height
 * branded header inside OwnerShell's would double up chrome. Instead it's a
 * minimal centered card that reuses the same tokens (ProgressBar, StepFrame,
 * animate-rise) so it still *feels* like the guest walkthrough.
 */

import { useCallback } from "react";
import { ProgressBar } from "@/components/ui";
import { IconArrowLeft } from "@/components/icons";
import {
  SETUP_STEPS,
  indexOfSetupStep,
  nextStepId,
  prevStepId,
  type SetupStepId,
} from "@/lib/owner/setup-flow";
import { useOwnerSetupState } from "@/lib/owner/setup-state";
import { WelcomeStep } from "@/components/owner/setup/WelcomeStep";
import { ConnectStep } from "@/components/owner/setup/ConnectStep";
import { ImportStep } from "@/components/owner/setup/ImportStep";
import { ReviewStep } from "@/components/owner/setup/ReviewStep";
import { DoneStep } from "@/components/owner/setup/DoneStep";
import type { SetupNav, SetupStepProps } from "@/components/owner/setup/types";

export default function OwnerSetupPage() {
  const { state, hydrated, update, reset } = useOwnerSetupState();

  const setStep = useCallback((id: SetupStepId) => update({ step: id }), [update]);

  if (!hydrated) {
    return <div className="py-16 text-center text-sm text-muted">Loading…</div>;
  }

  const idx = indexOfSetupStep(state.step);
  const stepMeta = SETUP_STEPS[idx];
  const progress = SETUP_STEPS.length > 1 ? (idx / (SETUP_STEPS.length - 1)) * 100 : 0;

  const nav: SetupNav = {
    next: () => {
      const id = nextStepId(state.step);
      if (id) setStep(id);
    },
    back: () => {
      const id = prevStepId(state.step);
      if (id) setStep(id);
    },
    goTo: setStep,
    isFirst: idx === 0,
    isLast: idx === SETUP_STEPS.length - 1,
  };

  function handleRestart() {
    if (
      window.confirm(
        "Start fleet setup over? This resets the wizard's progress — your vehicles stay put.",
      )
    ) {
      reset();
    }
  }

  const props: SetupStepProps = { state, update, nav };

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-[480px]">
        {/*
         * max-h bounds this card to (roughly) the viewport regardless of how
         * tall a given step's content is — mirroring the guest AppShell's
         * min-h-dvh + shrink-0 header + flex-1 overflow-y-auto content
         * contract. Without a ceiling here, a tall step (Review, Import with
         * several vehicles) grows the card past the viewport and the whole
         * *page* scrolls instead of just the step content, taking this
         * header's progress bar off-screen with it.
         */}
        <div className="relative flex min-h-[560px] max-h-[calc(100dvh-8rem)] flex-col overflow-hidden rounded-lg border border-line bg-white">
          <header className="shrink-0 px-5 pt-5 pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {!nav.isFirst && (
                  <button
                    onClick={nav.back}
                    aria-label="Back"
                    className="-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-ink"
                  >
                    <IconArrowLeft className="h-4 w-4" />
                  </button>
                )}
                <span className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                  Fleet setup
                </span>
              </div>
              {!nav.isFirst && (
                <button
                  onClick={handleRestart}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2 text-xs font-medium text-muted transition-colors hover:bg-surface hover:text-ink"
                >
                  Start over
                </button>
              )}
            </div>
            <ProgressBar value={progress} label={stepMeta?.title} />
          </header>
          <div key={state.step} className="flex min-h-0 flex-1 flex-col">
            {renderStep(state.step, props)}
          </div>
        </div>
      </div>
    </div>
  );
}

function renderStep(id: SetupStepId, props: SetupStepProps) {
  switch (id) {
    case "welcome":
      return <WelcomeStep {...props} />;
    case "connect":
      return <ConnectStep {...props} />;
    case "import":
      return <ImportStep {...props} />;
    case "review":
      return <ReviewStep {...props} />;
    case "done":
      return <DoneStep {...props} />;
  }
}
