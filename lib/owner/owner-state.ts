"use client";

/**
 * Owner-side local state: per-trip return checklists. Mirrors lib/store.ts's
 * load/save/hook pattern exactly (localStorage, spread-merge on load, try/catch
 * around every access), but keyed separately so it never collides with the
 * guest's `rtr:state:v1`.
 */

import { useCallback, useEffect, useState } from "react";

export const OWNER_KEY = "rtr:owner:v1";

export interface TripChecklistState {
  chargedToPolicy: boolean;
  keysReturned: boolean;
  cleaned: boolean;
  noDamage: boolean;
  notes: string;
  updatedAt: number;
}

export interface OwnerState {
  version: 1;
  tripChecklists: Record<string, TripChecklistState>;
}

export function emptyTripChecklist(): TripChecklistState {
  return {
    chargedToPolicy: false,
    keysReturned: false,
    cleaned: false,
    noDamage: false,
    notes: "",
    updatedAt: 0,
  };
}

export const initialOwnerState: OwnerState = {
  version: 1,
  tripChecklists: {},
};

export function loadOwnerState(): OwnerState {
  if (typeof window === "undefined") return initialOwnerState;
  try {
    const raw = window.localStorage.getItem(OWNER_KEY);
    if (!raw) return initialOwnerState;
    return { ...initialOwnerState, ...JSON.parse(raw) };
  } catch {
    return initialOwnerState;
  }
}

export function saveOwnerState(state: OwnerState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(OWNER_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode / full disk) — degrade gracefully */
  }
}

export function clearOwnerState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(OWNER_KEY);
  } catch {
    /* noop */
  }
}

type Patch = Partial<OwnerState> | ((s: OwnerState) => Partial<OwnerState>);
export type OwnerUpdater = (patch: Patch) => void;

export function useOwnerState() {
  const [state, setState] = useState<OwnerState>(initialOwnerState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadOwnerState());
    setHydrated(true);
  }, []);

  const update = useCallback<OwnerUpdater>((patch) => {
    setState((prev) => {
      const delta = typeof patch === "function" ? patch(prev) : patch;
      const next = { ...prev, ...delta };
      saveOwnerState(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    clearOwnerState();
    setState(initialOwnerState);
  }, []);

  return { state, hydrated, update, reset };
}
