/**
 * The adaptive flow. The set of steps a guest walks through is computed from
 * their chosen path mode, which itself defaults from their Tesla experience.
 */

import { MODULES, type Module } from "./content";

export type PathMode = "full" | "essentials";

export type Step =
  | { id: "welcome"; kind: "welcome"; title: string }
  | { id: "connect"; kind: "connect"; title: string }
  | { id: "plan"; kind: "plan"; title: string }
  | { id: "tesla-account"; kind: "tesla-account"; title: string }
  | { id: string; kind: "module"; title: string; module: Module }
  | { id: "checklist"; kind: "checklist"; title: string }
  | { id: "done"; kind: "done"; title: string };

export interface FlowOptions {
  /** Guest is new to Tesla → insert the "set up your Tesla account" step. */
  newToTesla?: boolean;
}

/** Modules included for a given path mode (full = all, essentials = rental-only). */
export function modulesForPath(pathMode: PathMode): Module[] {
  return pathMode === "full" ? MODULES : MODULES.filter((m) => !m.core);
}

export function buildFlow(pathMode: PathMode | null, opts: FlowOptions = {}): Step[] {
  const head: Step[] = [
    { id: "welcome", kind: "welcome", title: "Welcome" },
    { id: "connect", kind: "connect", title: "Connect" },
  ];
  if (!pathMode) return head;

  const moduleSteps: Step[] = modulesForPath(pathMode).map((m) => ({
    id: m.id,
    kind: "module",
    title: m.title,
    module: m,
  }));

  // New-to-Tesla guests get an account-setup + sign-in step at the top of the
  // walkthrough — everything after (phone key, charging, finding the car) needs it.
  const accountStep: Step[] = opts.newToTesla
    ? [{ id: "tesla-account", kind: "tesla-account", title: "Tesla account" }]
    : [];

  return [
    ...head,
    { id: "plan", kind: "plan", title: "Your plan" },
    ...accountStep,
    ...moduleSteps,
    { id: "checklist", kind: "checklist", title: "Readiness" },
    { id: "done", kind: "done", title: "All set" },
  ];
}

export function indexOfStep(flow: Step[], stepId: string): number {
  const i = flow.findIndex((s) => s.id === stepId);
  return i === -1 ? 0 : i;
}
