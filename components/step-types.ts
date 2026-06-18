import type { OnboardingState, useOnboarding } from "@/lib/store";
import type { Step } from "@/lib/flow";

export type Updater = ReturnType<typeof useOnboarding>["update"];

export interface StepNav {
  next: () => void;
  prev: () => void;
  goTo: (id: string) => void;
  reset: () => void;
  isFirst: boolean;
  isLast: boolean;
}

export interface StepProps {
  state: OnboardingState;
  update: Updater;
  nav: StepNav;
  step: Step;
}
