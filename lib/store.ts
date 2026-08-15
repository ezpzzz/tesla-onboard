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
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { browserTenantScope, migrateLegacyStorage, scopedStorageKey } from "@/lib/tenant-storage";
import { guestOnboardingStorageScope } from "@/lib/progress-bridge";
import type { ExperienceLevel, TeslaProfile } from "./tesla";
import type { PathMode, ProgressSummary } from "./flow";

export const ONBOARDING_KEY = "rtr:state:v2";
const LEGACY_ONBOARDING_KEY = "rtr:state:v1";

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

export function loadState(tenantSlug: string | null = browserTenantScope()): OnboardingState {
  if (typeof window === "undefined") return initialState;
  try {
    window.localStorage.removeItem(scopedStorageKey(LEGACY_ONBOARDING_KEY, tenantSlug));
    window.localStorage.removeItem(LEGACY_ONBOARDING_KEY);
    const raw = window.localStorage.getItem(migrateLegacyStorage(ONBOARDING_KEY, tenantSlug));
    if (!raw) return initialState;
    return { ...initialState, ...JSON.parse(raw) };
  } catch {
    return initialState;
  }
}

export function saveState(state: OnboardingState, tenantSlug: string | null = browserTenantScope()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(scopedStorageKey(ONBOARDING_KEY, tenantSlug), JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode / full disk) — degrade gracefully */
  }
}

export function clearState(tenantSlug: string | null = browserTenantScope()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(scopedStorageKey(ONBOARDING_KEY, tenantSlug));
  } catch {
    /* noop */
  }
}

/** Restore only bounded, non-identity progress from the server when this
 * browser has no local journey. Tesla profiles and tokens are never part of
 * ProgressSummary and are deliberately reset here. */
export function restoreOnboardingProgress(
  local: OnboardingState,
  remote?: ProgressSummary | null,
): OnboardingState {
  if (!remote || local.startedAt !== null || local.stepId !== initialState.stepId
    || local.completed.length > 0 || Object.keys(local.checklist).length > 0) return local;
  return {
    ...initialState,
    stepId: remote.stepId,
    pathMode: remote.pathMode,
    completed: [...remote.completed],
    checklist: { ...remote.checklist },
    startedAt: remote.startedAt,
    newToTesla: remote.newToTesla === true,
  };
}

type Patch = Partial<OnboardingState> | ((s: OnboardingState) => Partial<OnboardingState>);
export type Updater = (patch: Patch) => void;

export function useOnboarding(remoteProgress?: ProgressSummary | null) {
  const { tenantSlug } = useTenantConfig();
  const [state, setState] = useState<OnboardingState>(initialState);
  const [hydratedScope, setHydratedScope] = useState<string | null | undefined>(undefined);
  const currentScope = guestOnboardingStorageScope(tenantSlug);

  useEffect(() => {
    const local = loadState(currentScope);
    const next = restoreOnboardingProgress(local, remoteProgress);
    if (next !== local) {
      saveState(next, currentScope);
    }
    setState(next);
    setHydratedScope(currentScope);
  }, [currentScope, remoteProgress]);

  const hydrated = hydratedScope !== undefined && hydratedScope === currentScope;

  const update = useCallback((patch: Patch) => {
    setState((prev) => {
      const delta = typeof patch === "function" ? patch(prev) : patch;
      const next = { ...prev, ...delta };
      saveState(next, hydratedScope ?? tenantSlug);
      return next;
    });
  }, [hydratedScope, tenantSlug]);

  const reset = useCallback(() => {
    clearState(hydratedScope ?? tenantSlug);
    setState(initialState);
  }, [hydratedScope, tenantSlug]);

  return { state, hydrated, update, reset };
}
