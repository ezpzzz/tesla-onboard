/**
 * Shared prop/nav shapes for the owner setup wizard steps — mirrors
 * components/step-types.ts's StepProps/StepNav pattern for the guest flow,
 * scoped to lib/owner/setup-state.ts's OwnerSetupState and
 * lib/owner/setup-flow.ts's SetupStepId instead.
 */

import type { OwnerSetupState } from "@/lib/owner/setup-state";
import type { SetupStepId } from "@/lib/owner/setup-flow";

export type SetupUpdater = (
  patch: Partial<OwnerSetupState> | ((s: OwnerSetupState) => Partial<OwnerSetupState>),
) => void;

export interface SetupNav {
  next: () => void;
  back: () => void;
  goTo: (id: SetupStepId) => void;
  isFirst: boolean;
  isLast: boolean;
}

export interface SetupStepProps {
  state: OwnerSetupState;
  update: SetupUpdater;
  nav: SetupNav;
}
