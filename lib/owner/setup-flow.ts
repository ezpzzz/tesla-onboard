/**
 * First-run owner setup wizard — the step machine. Pure and directive-free
 * (no "use client") so both the client-only wizard page and any future
 * server code can share one source of truth for step order, mirroring how
 * lib/flow.ts is the guest walkthrough's step machine.
 */

export type SetupStepId = "welcome" | "connect" | "import" | "review" | "done";

export const SETUP_STEPS: { id: SetupStepId; title: string }[] = [
  { id: "welcome", title: "Welcome" },
  { id: "connect", title: "Connect Tesla" },
  { id: "import", title: "Import vehicles" },
  { id: "review", title: "Rental settings" },
  { id: "done", title: "All set" },
];

export function indexOfSetupStep(id: SetupStepId): number {
  const i = SETUP_STEPS.findIndex((s) => s.id === id);
  return i === -1 ? 0 : i;
}

export function nextStepId(id: SetupStepId): SetupStepId | null {
  return SETUP_STEPS[indexOfSetupStep(id) + 1]?.id ?? null;
}

export function prevStepId(id: SetupStepId): SetupStepId | null {
  return SETUP_STEPS[indexOfSetupStep(id) - 1]?.id ?? null;
}
