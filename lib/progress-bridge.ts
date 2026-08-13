"use client";

/**
 * The guest -> owner-dashboard progress bridge.
 *
 * The guest-facing onboarding flow and the host-facing /owner dashboard are two
 * separate apps that only ever meet through localStorage in the SAME browser:
 * the guest's `usePublishProgress` mirrors their onboarding state out to
 * `rtr:progress:v1` on every change, and the owner's `useGuestProgress` reads it
 * back (plus `storage` events for cross-tab updates). There is no server in
 * between — this is a same-device demo bridge, not a real multi-guest sync.
 *
 * `?trip=<id>` is how a host's deep link ("send this guest their onboarding
 * link") associates the guest's browser with a specific trip: the guest captures
 * it into `rtr:trip:v1` once, on first hydrated mount, and every progress write
 * after that tags along with whatever trip id is on file. First write wins, so
 * it's safe even if something else strips the query param later (e.g. the live
 * OAuth callback's URL cleanup in `use-tesla-connect.ts`).
 */

import { useEffect, useRef, useState } from "react";
import { computeProgress, type ProgressInput, type ProgressSummary } from "./flow";

export const PROGRESS_KEY = "rtr:progress:v1";
export const TRIP_KEY = "rtr:trip:v1";

export type PublishedGuestProgress = ProgressSummary & { tripId: string | null };

export function readPublishedProgress(): PublishedGuestProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PublishedGuestProgress;
  } catch {
    return null;
  }
}

function readTripId(): string | null {
  try {
    return window.localStorage.getItem(TRIP_KEY);
  } catch {
    return null;
  }
}

/** Guest-side: publish this browser's onboarding progress for the owner dashboard to read. */
export function usePublishProgress(state: ProgressInput, hydrated: boolean): void {
  const capturedTrip = useRef(false);

  // One-time: capture ?trip=<id> from the URL into localStorage, first write wins.
  useEffect(() => {
    if (!hydrated || capturedTrip.current) return;
    capturedTrip.current = true;
    try {
      const trip = new URLSearchParams(window.location.search).get("trip");
      if (trip && !window.localStorage.getItem(TRIP_KEY)) {
        window.localStorage.setItem(TRIP_KEY, trip);
      }
    } catch {
      /* storage unavailable — degrade gracefully, no trip tag on this browser */
    }
  }, [hydrated]);

  // Publish progress on every relevant state change.
  useEffect(() => {
    if (!hydrated) return;
    try {
      const published: PublishedGuestProgress = {
        ...computeProgress(state),
        tripId: readTripId(),
      };
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(published));
    } catch {
      /* storage unavailable (private mode / full disk) — degrade gracefully */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, hydrated]);
}

/** Owner-side: read the guest's published progress, live-updating in this browser. */
export function useGuestProgress(): PublishedGuestProgress | null {
  const [progress, setProgress] = useState<PublishedGuestProgress | null>(null);

  useEffect(() => {
    setProgress(readPublishedProgress());

    function refresh() {
      setProgress(readPublishedProgress());
    }
    function onStorage(e: StorageEvent) {
      if (e.key === PROGRESS_KEY || e.key === TRIP_KEY || e.key === null) refresh();
    }
    // "storage" only fires in OTHER tabs, so also re-read on focus/visibility for
    // same-tab navigation back from the guest flow. visibilitychange lives on
    // `document`, not `window`.
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return progress;
}
