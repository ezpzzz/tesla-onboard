/**
 * The adaptive flow. The set of steps a guest walks through is computed from
 * their chosen path mode, which itself defaults from their Tesla experience.
 */

import { CHECKLIST, MODULES, type Module } from "./content";
import type { ExperienceLevel, TeslaProfile } from "./tesla";

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

/**
 * Structural input for `computeProgress` — deliberately NOT imported from
 * `lib/store.ts`'s `OnboardingState` (store.ts already imports `PathMode` from
 * here, so importing back would cycle). Any object with these fields works,
 * `OnboardingState` included.
 */
export interface ProgressInput {
  profile: TeslaProfile | null;
  experience: ExperienceLevel | null;
  pathMode: PathMode | null;
  stepId: string;
  completed: string[];
  checklist: Record<string, boolean>;
  startedAt: number | null;
  newToTesla: boolean;
}

export interface ProgressSummary {
  stepId: string;
  /** 0-100, same formula as the in-app progress bar. */
  pct: number;
  isDone: boolean;
  completed: string[];
  checklist: Record<string, boolean>;
  moduleTotal: number;
  checklistDone: number;
  checklistTotal: number;
  requiredChecklistDone: number;
  requiredChecklistTotal: number;
  experience: ExperienceLevel | null;
  pathMode: PathMode | null;
  startedAt: number | null;
  guestName: string | null;
  updatedAt: number;
}

/** Derive a host-facing progress summary from onboarding state. Pure. */
export function computeProgress(input: ProgressInput): ProgressSummary {
  const flow = buildFlow(input.pathMode, { newToTesla: input.newToTesla });
  const idx = indexOfStep(flow, input.stepId);
  // Before a plan is chosen, `flow` is only the 2-step [welcome, connect]
  // head (see buildFlow above) — idx/(flow.length-1) would read 100% the
  // moment a guest clicks past Welcome, before they've signed in or picked a
  // path. Floor pct at 0 and never report isDone until a real pathMode flow
  // exists, so the owner dashboard can't mistake "clicked past Welcome" for
  // "finished onboarding" (mirrors the guest UI's own showProgress guard in
  // OnboardingApp.tsx for the same 2-step-flow quirk).
  const pct = input.pathMode && flow.length > 1 ? (idx / (flow.length - 1)) * 100 : 0;
  const isDone = input.pathMode !== null && idx === flow.length - 1;

  const checklistDone = CHECKLIST.filter((item) => input.checklist[item.id] === true).length;
  const requiredItems = CHECKLIST.filter((item) => item.required);
  const requiredChecklistDone = requiredItems.filter(
    (item) => input.checklist[item.id] === true,
  ).length;

  return {
    stepId: input.stepId,
    pct,
    isDone,
    completed: input.completed,
    checklist: input.checklist,
    moduleTotal: input.pathMode ? modulesForPath(input.pathMode).length : 0,
    checklistDone,
    checklistTotal: CHECKLIST.length,
    requiredChecklistDone,
    requiredChecklistTotal: requiredItems.length,
    experience: input.experience,
    pathMode: input.pathMode,
    startedAt: input.startedAt,
    guestName: input.profile?.fullName || null,
    updatedAt: Date.now(),
  };
}
