"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { indexOfStep, type Step } from "@/lib/flow";
import { buildTenantFlow } from "@/lib/tenant-flow";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { useOnboarding } from "@/lib/store";
import { usePublishProgress } from "@/lib/progress-bridge";
import { useStepHistory } from "@/lib/history-nav";
import { AppShell } from "./ui";
import { WelcomeStep } from "./steps/WelcomeStep";
import { ConnectStep } from "./steps/ConnectStep";
import { TeslaAccountStep } from "./steps/TeslaAccountStep";
import { PlanStep } from "./steps/PlanStep";
import { ModuleStep } from "./steps/ModuleStep";
import { ChecklistStep } from "./steps/ChecklistStep";
import { DoneStep } from "./steps/DoneStep";
import type { StepNav, StepProps } from "./step-types";

export default function OnboardingApp() {
  const { loading, readiness } = useTenantConfig();

  if (loading || readiness === "loading") return <Splash />;
  if (readiness !== "ready") return <GuestUnavailable readiness={readiness} />;
  return <ReadyOnboardingApp />;
}

function ReadyOnboardingApp() {
  const { config } = useTenantConfig();
  const { state, hydrated, update, reset } = useOnboarding();
  usePublishProgress(state, hydrated);
  const flow = useMemo(
    () => buildTenantFlow(state.pathMode, config, { newToTesla: state.newToTesla }),
    [state.pathMode, state.newToTesla, config],
  );
  const idx = indexOfStep(flow, state.stepId);
  const step = flow[idx];

  const setStep = useCallback((id: string) => update({ stepId: id }), [update]);
  const { goBack, resetHistory } = useStepHistory({
    hydrated,
    stepId: state.stepId,
    pathMode: state.pathMode,
    newToTesla: state.newToTesla,
    setStep,
  });

  if (!hydrated) return <Splash />;

  const stepBack = () =>
    update((s) => {
      const f = buildTenantFlow(s.pathMode, config, { newToTesla: s.newToTesla });
      const i = indexOfStep(f, s.stepId);
      const prevStep = f[i - 1];
      return { stepId: prevStep ? prevStep.id : s.stepId };
    });

  const nav: StepNav = {
    next: () =>
      update((s) => {
        const f = buildTenantFlow(s.pathMode, config, { newToTesla: s.newToTesla });
        const i = indexOfStep(f, s.stepId);
        const cur = f[i];
        const completed =
          cur && cur.kind === "module" && !s.completed.includes(cur.id)
            ? [...s.completed, cur.id]
            : s.completed;
        const nextStep = f[i + 1];
        return { completed, stepId: nextStep ? nextStep.id : s.stepId };
      }),
    // Route the in-app Back through history so it stays in lockstep with the
    // browser's Back button; deep-resumed guests fall back to a plain step-back.
    prev: () => goBack(stepBack),
    goTo: (id) => update({ stepId: id }),
    reset: () => {
      resetHistory();
      reset();
    },
    isFirst: idx === 0,
    isLast: idx === flow.length - 1,
  };

  // Hide the bar until a personalized plan exists — before sign-in the flow is
  // only [welcome, connect], which would otherwise read a misleading 100%.
  const showProgress = step.kind !== "welcome" && step.kind !== "connect";
  const progress = flow.length > 1 ? (idx / (flow.length - 1)) * 100 : 0;
  const stepLabel = step.kind === "module" ? step.module.title : step.title;
  const onRestart = state.startedAt ? nav.reset : undefined;

  const props: StepProps = { state, update, nav, step };

  return (
    <AppShell
      progress={progress}
      stepLabel={stepLabel}
      showProgress={showProgress}
      onRestart={onRestart}
    >
      <div key={step.id} className="flex min-h-0 flex-1 flex-col">
        {renderStep(step, props)}
      </div>
    </AppShell>
  );
}

function GuestUnavailable({
  readiness,
}: {
  readiness: Exclude<ReturnType<typeof useTenantConfig>["readiness"], "loading" | "ready">;
}) {
  const content = readiness === "missing-tenant"
    ? {
        title: "Open your rental link.",
        body: "This page is not connected to a rental workspace. Ask your host for the guest onboarding link for your vehicle.",
      }
    : readiness === "workspace-unavailable"
      ? {
          title: "This rental link is unavailable.",
          body: "We could not verify its workspace. Check the link or ask your host for a new one.",
        }
      : {
          title: "Guest onboarding is not ready yet.",
          body: "The owner must finish fleet setup and publish an active vehicle before guests can begin.",
        };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-5 py-10">
      <main className="w-full max-w-[480px] rounded-3xl border border-line bg-white px-6 py-10 text-center shadow-[0_0_80px_rgba(23,26,32,0.08)]">
        <span className="mx-auto block h-3 w-3 rounded-full bg-brand shadow-[0_0_12px_2px] shadow-brand/40" />
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-brand">
          Onboarding
        </p>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-ink">
          {content.title}
        </h1>
        <p className="mx-auto mt-4 max-w-[34ch] text-[15px] leading-relaxed text-muted">
          {content.body}
        </p>
        <Link
          href="/owner"
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-white px-6 text-[15px] font-medium text-ink transition-colors hover:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          Owner sign in
        </Link>
      </main>
    </div>
  );
}

function renderStep(step: Step, props: StepProps) {
  switch (step.kind) {
    case "welcome":
      return <WelcomeStep {...props} />;
    case "connect":
      return <ConnectStep {...props} />;
    case "tesla-account":
      return <TeslaAccountStep {...props} />;
    case "plan":
      return <PlanStep {...props} />;
    case "module":
      return <ModuleStep {...props} />;
    case "checklist":
      return <ChecklistStep {...props} />;
    case "done":
      return <DoneStep {...props} />;
  }
}

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface">
      <span className="text-lg font-semibold tracking-tight text-ink opacity-90">
        Onboarding
      </span>
    </div>
  );
}
