"use client";

/**
 * Owner-side "Connect with Tesla" plumbing for the fleet setup wizard's
 * Connect step. Structural mirror of lib/use-tesla-connect.ts: same
 * mock-vs-live branching, same "strip the OAuth query params but keep the
 * history-entry state" cleanup, same error/linking shape — pointed at the
 * owner-side routes and the owner-side setup state instead of the guest's.
 */

import { useEffect, useState } from "react";
import { AUTH_MODE, personaByKey } from "@/lib/tesla";
import type { TeslaProfile } from "@/lib/tesla";
import type { OwnerSetupUpdater } from "./setup-state";

/** Where the Connect step's "Connect with Tesla" button sends the browser. */
export function connectHref(): string {
  return AUTH_MODE === "live"
    ? "/api/owner/tesla/login"
    : "/auth/tesla?mode=owner&return=/owner/setup";
}

/**
 * Owner-phrased copy for the `?owner_tesla_error=` codes the owner OAuth
 * routes redirect with. Same code vocabulary as lib/tesla.ts's
 * authErrorMessage (the routes are structural mirrors), but the fallback
 * offered to a host is "add vehicles manually", not "continue as a new
 * guest" — a host is never a Tesla-inexperienced walkthrough guest.
 */
export function ownerAuthErrorMessage(code: string): string {
  switch (code) {
    case "config":
      return "Tesla sign-in isn't configured on the server yet. You can add vehicles manually below.";
    case "denied":
      return "Sign-in was cancelled. You can try again or add vehicles manually.";
    case "state_mismatch":
      return "Sign-in expired for security. Please try connecting again.";
    case "origin_mismatch":
      return "Sign-in was started from a different address than the configured redirect URL. Open the app at its configured domain and try again.";
    case "exchange_failed":
      return "We couldn't reach Tesla just now. Try again, or add vehicles manually.";
    case "vehicles_unavailable":
      return "You're signed in, but we couldn't read your vehicles right now. Try again, or add vehicles manually.";
    case "session":
      return "Your sign-in didn't carry over. Please try again.";
    default:
      return "Something went wrong with Tesla sign-in. You can add vehicles manually below.";
  }
}

export function useOwnerTeslaConnect(teslaProfile: TeslaProfile | null, update: OwnerSetupUpdater) {
  const [authError, setAuthError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  // Complete the round-trip from either mode. mock: the reused consent screen
  // redirected back with ?owner_connected=1&owner_persona=<key>. live: the
  // server callback sealed a session cookie and redirected with
  // ?owner_connected=1 alone. Either way, or on ?owner_tesla_error=<code>,
  // this runs once on mount reading the URL the redirect landed on.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorCode = params.get("owner_tesla_error");
    // Strip the OAuth query params but keep the step-history tag on the entry,
    // same as lib/use-tesla-connect.ts's cleanUrl().
    const cleanUrl = () =>
      window.history.replaceState(window.history.state, "", window.location.pathname);

    if (errorCode) {
      setAuthError(ownerAuthErrorMessage(errorCode));
      cleanUrl();
      return;
    }

    const justConnected = params.get("owner_connected") === "1";
    if (!justConnected) return;

    if (AUTH_MODE === "mock") {
      const personaKey = params.get("owner_persona");
      const persona = personaKey ? personaByKey(personaKey) : undefined;
      if (persona) {
        update({ teslaProfile: persona.profile });
      } else {
        setAuthError(ownerAuthErrorMessage("session"));
      }
      cleanUrl();
      return;
    }

    if (teslaProfile) {
      cleanUrl();
      return;
    }
    setLinking(true);
    fetch("/api/owner/tesla/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { profile: TeslaProfile | null }) => {
        if (data.profile) {
          update({ teslaProfile: data.profile });
        } else {
          setAuthError(ownerAuthErrorMessage("session"));
        }
      })
      .catch(() => setAuthError(ownerAuthErrorMessage("session")))
      .finally(() => {
        setLinking(false);
        cleanUrl();
      });
    // Run once on mount; reads the URL the OAuth callback redirected to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function useDifferentAccount() {
    if (AUTH_MODE === "live") {
      fetch("/api/owner/tesla/logout", { method: "POST" }).catch(() => {});
    }
    update({ teslaProfile: null });
  }

  return { authError, linking, useDifferentAccount };
}
