/**
 * Tesla account model + sign-in.
 *
 * The onboarding flow only needs to read *identity* and the *vehicle list* to
 * decide how much hand-holding a guest needs — it never controls the car. That
 * keeps the required OAuth scope tiny and the integration low-risk.
 *
 * Two modes (see .env.example):
 *   - mock  → simulated consent screen + personas. No credentials. Default.
 *   - live  → real Tesla Fleet API OAuth. Swap `startSignIn` / token exchange
 *             for the real redirect; the rest of the app is unchanged because it
 *             only ever sees a normalized `TeslaProfile`.
 */

export type ExperienceLevel = "new" | "account" | "owner";

export interface TeslaVehicle {
  id: string;
  displayName: string;
  model: string; // "Model 3", "Model Y", …
  year?: number;
}

export interface TeslaProfile {
  id: string;
  fullName: string;
  firstName: string;
  email: string;
  vehicles: TeslaVehicle[];
  source: "mock" | "live";
}

export interface TeslaPersona {
  key: string;
  label: string;
  blurb: string;
  profile: TeslaProfile;
}

export const AUTH_MODE: "mock" | "live" =
  (process.env.NEXT_PUBLIC_TESLA_AUTH_MODE as "mock" | "live") ?? "mock";

/**
 * Demo personas shown on the simulated consent screen. In live mode the user's
 * real Tesla account replaces these — the screen never asks them to "pick."
 */
export const TESLA_PERSONAS: TeslaPersona[] = [
  {
    key: "owner",
    label: "Tesla owner",
    blurb: "An account with a car already on it.",
    profile: {
      id: "u_owner",
      fullName: "Alex Rivera",
      firstName: "Alex",
      email: "alex@example.com",
      source: "mock",
      vehicles: [
        { id: "v1", displayName: "Alex's Model Y", model: "Model Y", year: 2023 },
      ],
    },
  },
  {
    key: "account",
    label: "Account, no car",
    blurb: "Signed up with Tesla but no vehicle on the account.",
    profile: {
      id: "u_account",
      fullName: "Sam Chen",
      firstName: "Sam",
      email: "sam@example.com",
      source: "mock",
      vehicles: [],
    },
  },
];

/** A guest who tells us they're new to Tesla — no account, no sign-in. */
export const NEW_GUEST_PROFILE: TeslaProfile = {
  id: "u_new",
  fullName: "",
  firstName: "there",
  email: "",
  vehicles: [],
  source: "mock",
};

/** Map a signed-in profile to an experience level. */
export function deriveExperience(profile: TeslaProfile | null): ExperienceLevel {
  if (!profile || profile.id === "u_new") return "new";
  return profile.vehicles.length > 0 ? "owner" : "account";
}

/** The recommended default route through onboarding for an experience level. */
export function defaultPathMode(exp: ExperienceLevel): "full" | "essentials" {
  return exp === "new" ? "full" : "essentials";
}

export function personaByKey(key: string): TeslaPersona | undefined {
  return TESLA_PERSONAS.find((p) => p.key === key);
}

/**
 * Where "Connect with Tesla" sends the browser.
 *
 * mock: our Tesla-styled consent screen.
 * live: the server login route, which mints CSRF state and redirects to Tesla's
 *       real authorize page. The token exchange happens server-side in
 *       `lib/tesla-server.ts` (the client secret never reaches the browser).
 */
export function teslaAuthorizeUrl(): string {
  return AUTH_MODE === "live" ? "/api/tesla/login" : "/auth/tesla";
}

/** Human-readable copy for the `?tesla_error=` codes the OAuth routes redirect with. */
export function authErrorMessage(code: string): string {
  switch (code) {
    case "config":
      return "Tesla sign-in isn't configured on the server yet. You can continue as a new guest below.";
    case "denied":
      return "Sign-in was cancelled. You can try again or continue as a new guest.";
    case "state_mismatch":
      return "Sign-in expired for security. Please try connecting again.";
    case "origin_mismatch":
      return "Sign-in was started from a different address than the configured redirect URL. Open the app at its configured domain and try again.";
    case "exchange_failed":
      return "We couldn't reach Tesla just now. Try again, or continue as a new guest.";
    case "vehicles_unavailable":
      return "You're signed in, but we couldn't read your vehicles right now. Try again, or continue as a new guest.";
    case "session":
      return "Your sign-in didn't carry over. Please try again.";
    default:
      return "Something went wrong with Tesla sign-in. You can continue as a new guest below.";
  }
}
