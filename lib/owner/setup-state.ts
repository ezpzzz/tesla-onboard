"use client";

/**
 * Owner-side local state: first-run fleet setup wizard progress. Mirrors
 * lib/owner/owner-state.ts's load/save/hook pattern exactly (localStorage,
 * spread-merge on load, try/catch around every access), but keyed separately
 * so it never collides with `rtr:owner:v1`, `rtr:vehicles:v1`, or the guest's
 * `rtr:state:v1`.
 *
 * `reset()` clears ONLY this key — it never touches `rtr:vehicles:v1`, so
 * "start setup over" can't accidentally delete a host's fleet.
 */

import { useCallback, useEffect, useState } from "react";
import type { TeslaProfile } from "@/lib/tesla";
import type { SetupStepId } from "./setup-flow";

export const OWNER_SETUP_KEY = "rtr:owner-setup:v1";

export interface OwnerSetupState {
  version: 1;
  step: SetupStepId; // resume pointer
  teslaProfile: TeslaProfile | null; // owner-side profile from live /me (mock only in local dev)
  importedTeslaIds: Record<string, string>; // dedupe ledger: (vin ?? tesla vehicle id) -> local Vehicle id
  completedAt: number | null;
  dismissedAt: number | null;
}

export const initialOwnerSetupState: OwnerSetupState = {
  version: 1,
  step: "welcome",
  teslaProfile: null,
  importedTeslaIds: {},
  completedAt: null,
  dismissedAt: null,
};

export function removeLegacyMockSetupData(state: OwnerSetupState): OwnerSetupState {
  return state.teslaProfile?.source === "mock" ? initialOwnerSetupState : state;
}

/** A host still needs setup until they either finish it or explicitly skip it. */
export function needsSetup(s: OwnerSetupState): boolean {
  return !s.completedAt && !s.dismissedAt;
}

export function loadOwnerSetupState(): OwnerSetupState {
  if (typeof window === "undefined") return initialOwnerSetupState;
  try {
    const raw = window.localStorage.getItem(OWNER_SETUP_KEY);
    if (!raw) return initialOwnerSetupState;
    const parsed = { ...initialOwnerSetupState, ...JSON.parse(raw) } as OwnerSetupState;
    const migrated = removeLegacyMockSetupData(parsed);
    if (migrated !== parsed) {
      window.localStorage.removeItem(OWNER_SETUP_KEY);
    }
    return migrated;
  } catch {
    return initialOwnerSetupState;
  }
}

export function saveOwnerSetupState(state: OwnerSetupState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OWNER_SETUP_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode / full disk) — degrade gracefully */
  }
}

export function clearOwnerSetupState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(OWNER_SETUP_KEY);
  } catch {
    /* noop */
  }
}

type Patch = Partial<OwnerSetupState> | ((s: OwnerSetupState) => Partial<OwnerSetupState>);
export type OwnerSetupUpdater = (patch: Patch) => void;

export function useOwnerSetupState() {
  const [state, setState] = useState<OwnerSetupState>(initialOwnerSetupState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadOwnerSetupState());
    setHydrated(true);
  }, []);

  const update = useCallback<OwnerSetupUpdater>((patch) => {
    setState((prev) => {
      const delta = typeof patch === "function" ? patch(prev) : patch;
      const next = { ...prev, ...delta };
      saveOwnerSetupState(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    clearOwnerSetupState();
    setState(initialOwnerSetupState);
  }, []);

  return { state, hydrated, update, reset };
}
