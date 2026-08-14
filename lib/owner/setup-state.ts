"use client";

/**
 * Owner-side local state: first-run fleet setup wizard progress. Mirrors
 * lib/owner/owner-state.ts's load/save/hook pattern exactly (localStorage,
 * spread-merge on load, try/catch around every access), but keyed separately
 * so it never collides with `rtr:owner:v1`, `rtr:vehicles:v1`, or the guest's
 * `rtr:state:v2`.
 *
 * `reset()` clears ONLY this key — it never touches `rtr:vehicles:v1`, so
 * "start setup over" can't accidentally delete a host's fleet.
 */

import { useCallback, useEffect, useState } from "react";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { migrateLegacyStorage, scopedStorageKey } from "@/lib/tenant-storage";
import type { TeslaProfile } from "@/lib/tesla";
import type { SetupStepId } from "./setup-flow";

export const OWNER_SETUP_KEY = "rtr:owner-setup:v2";
const LEGACY_OWNER_SETUP_KEY = "rtr:owner-setup:v1";

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

export function loadOwnerSetupState(tenantSlug?: string | null): OwnerSetupState {
  if (typeof window === "undefined") return initialOwnerSetupState;
  try {
    window.localStorage.removeItem(scopedStorageKey(LEGACY_OWNER_SETUP_KEY, tenantSlug));
    window.localStorage.removeItem(LEGACY_OWNER_SETUP_KEY);
    const key = migrateLegacyStorage(OWNER_SETUP_KEY, tenantSlug);
    const raw = window.localStorage.getItem(key);
    if (!raw) return initialOwnerSetupState;
    const parsed = { ...initialOwnerSetupState, ...JSON.parse(raw) } as OwnerSetupState;
    const migrated = removeLegacyMockSetupData(parsed);
    if (migrated !== parsed) {
      window.localStorage.removeItem(key);
    }
    return migrated;
  } catch {
    return initialOwnerSetupState;
  }
}

export function saveOwnerSetupState(state: OwnerSetupState, tenantSlug?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(scopedStorageKey(OWNER_SETUP_KEY, tenantSlug), JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode / full disk) — degrade gracefully */
  }
}

export function clearOwnerSetupState(tenantSlug?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(scopedStorageKey(OWNER_SETUP_KEY, tenantSlug));
  } catch {
    /* noop */
  }
}

type Patch = Partial<OwnerSetupState> | ((s: OwnerSetupState) => Partial<OwnerSetupState>);
export type OwnerSetupUpdater = (patch: Patch) => void;

export function useOwnerSetupState() {
  const { tenantSlug } = useTenantConfig();
  const [state, setState] = useState<OwnerSetupState>(initialOwnerSetupState);
  const [hydratedScope, setHydratedScope] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setState(loadOwnerSetupState(tenantSlug));
    setHydratedScope(tenantSlug);
  }, [tenantSlug]);

  const hydrated = hydratedScope !== undefined && hydratedScope === tenantSlug;

  const update = useCallback<OwnerSetupUpdater>((patch) => {
    setState((prev) => {
      const delta = typeof patch === "function" ? patch(prev) : patch;
      const next = { ...prev, ...delta };
      saveOwnerSetupState(next, tenantSlug);
      return next;
    });
  }, [tenantSlug]);

  const reset = useCallback(() => {
    clearOwnerSetupState(tenantSlug);
    setState(initialOwnerSetupState);
  }, [tenantSlug]);

  return { state, hydrated, update, reset };
}
