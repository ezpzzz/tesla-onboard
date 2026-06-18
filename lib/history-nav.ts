"use client";

/**
 * Mirrors the onboarding step into the browser's History API so the browser /
 * OS Back and Forward buttons move between steps instead of leaving the app.
 *
 * The single source of truth for "which step" stays `state.stepId` (persisted to
 * localStorage for resume). This hook keeps a parallel history entry per step:
 *   - moving forward pushes a new entry tagged with the step id + a depth counter
 *   - Back / Forward fire `popstate`, which sets the step from the entry's tag
 *   - the in-app Back button consumes a real history entry (so it matches the
 *     browser exactly), falling back to a manual step-back when the guest deep-
 *     resumed and there is no app history behind the current entry.
 */

import { useCallback, useEffect, useRef } from "react";
import { buildFlow, indexOfStep, type PathMode } from "./flow";

interface HistoryEntry {
  rtr?: boolean;
  stepId?: string;
  depth?: number;
}

interface Args {
  hydrated: boolean;
  stepId: string;
  pathMode: PathMode | null;
  newToTesla: boolean;
  /** Set the current step without any other side effects (used by popstate). */
  setStep: (id: string) => void;
}

export function useStepHistory({ hydrated, stepId, pathMode, newToTesla, setStep }: Args) {
  const synced = useRef<string | null>(null);
  const depth = useRef(0);
  const fromPop = useRef(false);

  // Keep the current history entry in sync with the displayed step.
  useEffect(() => {
    if (!hydrated) return;

    // A popstate already aligned history with the step — just record it.
    if (fromPop.current) {
      fromPop.current = false;
      synced.current = stepId;
      return;
    }

    // First sync after load (or after a reset): tag the current entry in place.
    if (synced.current === null) {
      depth.current = 0;
      window.history.replaceState({ rtr: true, stepId, depth: 0 }, "");
      synced.current = stepId;
      return;
    }

    if (synced.current === stepId) return; // e.g. a pathMode-only update

    const flow = buildFlow(pathMode, { newToTesla });
    const forward = indexOfStep(flow, stepId) > indexOfStep(flow, synced.current);
    if (forward) {
      depth.current += 1;
      window.history.pushState({ rtr: true, stepId, depth: depth.current }, "");
    } else {
      // Backward move via a direct state change (e.g. reset) — rewrite in place.
      window.history.replaceState({ rtr: true, stepId, depth: depth.current }, "");
    }
    synced.current = stepId;
  }, [hydrated, stepId, pathMode, newToTesla]);

  // Browser / OS Back & Forward.
  useEffect(() => {
    function onPop(e: PopStateEvent) {
      const st = e.state as HistoryEntry | null;
      if (st && st.rtr && typeof st.stepId === "string") {
        fromPop.current = true;
        depth.current = typeof st.depth === "number" ? st.depth : 0;
        setStep(st.stepId);
      }
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [setStep]);

  // In-app Back: consume a real history entry when we have one so it tracks the
  // browser; otherwise (deep-resume) fall back to a plain step-back.
  const goBack = useCallback((fallback: () => void) => {
    if (depth.current > 0) window.history.back();
    else fallback();
  }, []);

  // Re-tag from scratch on the next sync (used when the flow is reset).
  const resetHistory = useCallback(() => {
    synced.current = null;
    depth.current = 0;
  }, []);

  return { goBack, resetHistory };
}
