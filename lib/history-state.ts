export interface StepHistoryState {
  rtr: true;
  stepId: string;
  depth: number;
}

/**
 * Next.js keeps private App Router metadata in `window.history.state`.
 * Preserve that metadata when adding the onboarding step tag; replacing the
 * whole object can send the router into a render loop during a redirect.
 */
export function mergeStepHistoryState(
  current: unknown,
  stepId: string,
  depth: number,
): Record<string, unknown> & StepHistoryState {
  const base = current && typeof current === "object"
    ? current as Record<string, unknown>
    : {};
  return { ...base, rtr: true, stepId, depth };
}
