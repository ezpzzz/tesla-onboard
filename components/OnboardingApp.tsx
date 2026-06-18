"use client";

import { useCallback, useMemo } from "react";
import { hostConfig } from "@/lib/config";
import { buildFlow, indexOfStep, type Step } from "@/lib/flow";
import { useOnboarding } from "@/lib/store";
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
  const { state, hydrated, update, reset } = useOnboarding();
  const flow = useMemo(
    () => buildFlow(state.pathMode, { newToTesla: state.newToTesla }),
    [state.pathMode, state.newToTesla],
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
      const f = buildFlow(s.pathMode, { newToTesla: s.newToTesla });
      const i = indexOfStep(f, s.stepId);
      const prevStep = f[i - 1];
      return { stepId: prevStep ? prevStep.id : s.stepId };
    });

  const nav: StepNav = {
    next: () =>
      update((s) => {
        const f = buildFlow(s.pathMode, { newToTesla: s.newToTesla });
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
        {hostConfig.companyName}
      </span>
    </div>
  );
}
