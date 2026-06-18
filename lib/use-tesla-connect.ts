"use client";

/**
 * Shared "Sign in with Tesla" plumbing, used by both the Connect step and the
 * in-walkthrough "Set up your Tesla account" step. Extracting it means the OAuth
 * round-trip is handled correctly whichever step the guest launched sign-in from
 * (in live mode the callback returns to ?connected=1 on the step that's active).
 */

import { useEffect, useState } from "react";
import {
  AUTH_MODE,
  authErrorMessage,
  defaultPathMode,
  deriveExperience,
  teslaAuthorizeUrl,
} from "./tesla";
import type { TeslaProfile } from "./tesla";
import type { OnboardingState, Updater } from "./store";

export function useTeslaConnect(state: OnboardingState, update: Updater) {
  const connected = !!(state.profile && state.profile.id !== "u_new");
  const [authError, setAuthError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  // Live mode: complete the OAuth round-trip. The callback redirects back with
  // ?connected=1 (session sealed in an httpOnly cookie) or ?tesla_error=<code>.
  useEffect(() => {
    if (AUTH_MODE !== "live") return;
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("tesla_error");
    const justConnected = params.get("connected") === "1";
    // Strip the OAuth query params but keep the step-history tag on the entry.
    const cleanUrl = () =>
      window.history.replaceState(window.history.state, "", window.location.pathname);

    if (errorCode) {
      setAuthError(authErrorMessage(errorCode));
      cleanUrl();
      return;
    }
    if (justConnected && !connected) {
      setLinking(true);
      fetch("/api/tesla/me", { cache: "no-store" })
        .then((r) => r.json())
        .then((data: { profile: TeslaProfile | null }) => {
          if (data.profile) {
            const exp = deriveExperience(data.profile);
            update({
              profile: data.profile,
              experience: exp,
              // Keep an already-chosen path; otherwise default from experience.
              pathMode: state.pathMode ?? defaultPathMode(exp),
              // Stay on the current step so it can show the signed-in state.
              startedAt: state.startedAt ?? Date.now(),
            });
          } else {
            setAuthError(authErrorMessage("session"));
          }
        })
        .catch(() => setAuthError(authErrorMessage("session")))
        .finally(() => {
          setLinking(false);
          cleanUrl();
        });
    }
    // Run once on mount; reads the URL the OAuth callback redirected to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connectWithTesla() {
    setLinking(true);
    window.location.href = teslaAuthorizeUrl();
  }

  function useDifferentAccount() {
    if (AUTH_MODE === "live") {
      fetch("/api/tesla/logout", { method: "POST" }).catch(() => {});
    }
    update({ profile: null, experience: null, pathMode: null });
  }

  return { connected, authError, linking, connectWithTesla, useDifferentAccount };
}
