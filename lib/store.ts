"use client";

/**
 * Onboarding state + persistence. Everything lives in localStorage so a guest
 * can close the tab at the Supercharger and pick up exactly where they left off.
 *
 * The mock consent screen writes here directly (loadState/saveState) before it
 * redirects back, mirroring how a real OAuth callback would hydrate session
 * state; the main app reads it on mount.
 */

import { useCallback, useEffect, useState } from "react";
import type { ExperienceLevel, TeslaProfile } from "./tesla";
import type { PathMode } from "./flow";

const KEY = "rtr:state:v1";

export interface OnboardingState {
  profile: TeslaProfile | null;
  experience: ExperienceLevel | null;
  pathMode: PathMode | null;
  stepId: string;
  completed: string[];
  checklist: Record<string, boolean>;
  startedAt: number | null;
  /**
   * Set when a guest tells us they're new to Tesla. Stable across sign-in (it
   * does NOT flip when their experience level changes), so the "set up your
   * Tesla account" walkthrough step stays put instead of vanishing mid-flow.
   */
  newToTesla: boolean;
}

export const initialState: OnboardingState = {
  profile: null,
  experience: null,
  pathMode: null,
  stepId: "welcome",
  completed: [],
  checklist: {},
  startedAt: null,
  newToTesla: false,
};

export function loadState(): OnboardingState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return initialState;
    return { ...initialState, ...JSON.parse(raw) };
  } catch {
    return initialState;
  }
}

export function saveState(state: OnboardingState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode / full disk) — degrade gracefully */
  }
}

export function clearState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

type Patch = Partial<OnboardingState> | ((s: OnboardingState) => Partial<OnboardingState>);
export type Updater = (patch: Patch) => void;

export function useOnboarding() {
  const [state, setState] = useState<OnboardingState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  const update = useCallback((patch: Patch) => {
    setState((prev) => {
      const delta = typeof patch === "function" ? patch(prev) : patch;
      const next = { ...prev, ...delta };
      saveState(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    clearState();
    setState(initialState);
  }, []);

  return { state, hydrated, update, reset };
}
