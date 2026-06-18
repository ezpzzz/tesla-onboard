"use client";

/**
 * Simulated "Sign in with Tesla" consent screen.
 *
 * In LIVE mode this whole route is replaced by Tesla's real authorize page and
 * a server-side callback that exchanges the code for tokens. Here we mimic the
 * consent UX and the demo lets you pick which kind of account to simulate so
 * you can see the adaptive flow respond to an owner vs. a fresh account.
 */

import { useState } from "react";
import { hostConfig } from "@/lib/config";
import { loadState, saveState } from "@/lib/store";
import {
  TESLA_PERSONAS,
  defaultPathMode,
  deriveExperience,
} from "@/lib/tesla";

export default function TeslaConsentPage() {
  const [personaKey, setPersonaKey] = useState(TESLA_PERSONAS[0].key);
  const [busy, setBusy] = useState(false);
  const persona =
    TESLA_PERSONAS.find((p) => p.key === personaKey) ?? TESLA_PERSONAS[0];

  function allow() {
    setBusy(true);
    const exp = deriveExperience(persona.profile);
    const prev = loadState();
    saveState({
      ...prev,
      profile: persona.profile,
      experience: exp,
      // Keep a path the guest already chose (e.g. a new guest mid-walkthrough);
      // otherwise default from their experience.
      pathMode: prev.pathMode ?? defaultPathMode(exp),
      // Return to whichever step launched sign-in (Connect, or the in-walkthrough
      // "Set up your Tesla account" step) so it can show the signed-in state.
      stepId: prev.stepId && prev.stepId !== "welcome" ? prev.stepId : "connect",
      startedAt: prev.startedAt ?? Date.now(),
    });
    window.location.href = "/";
  }

  function cancel() {
    window.location.href = "/";
  }

  return (
    <div className="flex min-h-dvh w-full justify-center bg-white">
      <div className="flex w-full max-w-[400px] flex-col px-6 pt-14 pb-8">
        <div
          className="text-center text-2xl font-bold tracking-[0.42em] text-brand"
          style={{ paddingLeft: "0.42em" }}
        >
          TESLA
        </div>

        <div className="mt-10">
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Sign in with Tesla
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            <span className="font-medium text-ink">{hostConfig.companyName}</span>{" "}
            is requesting access to your Tesla Account.
          </p>
        </div>

        <div className="mt-6 rounded-2xl border border-line">
          <Row title="Your profile" detail="Name and email address" />
          <div className="border-t border-line" />
          <Row
            title="Your vehicles"
            detail={
              persona.profile.vehicles.length > 0
                ? persona.profile.vehicles.map((v) => v.displayName).join(", ")
                : "No vehicles on this account"
            }
          />
        </div>

        <p className="mt-3 px-1 text-xs leading-relaxed text-muted">
          Read-only. {hostConfig.companyName} cannot drive, unlock, or locate any
          vehicle.
        </p>

        {/* ── Demo affordance: pick which account to simulate ───────────── */}
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface p-4">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
              Demo
            </span>
            <span className="text-xs text-muted">Simulate signing in as…</span>
          </div>
          <div className="space-y-2">
            {TESLA_PERSONAS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPersonaKey(p.key)}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                  p.key === personaKey
                    ? "border-ink bg-white"
                    : "border-line bg-white/50 hover:bg-white"
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                    p.key === personaKey ? "border-ink" : "border-line"
                  }`}
                >
                  {p.key === personaKey && (
                    <span className="h-2 w-2 rounded-full bg-ink" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">
                    {p.label}
                  </span>
                  <span className="block text-xs text-muted">{p.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-8 space-y-2.5">
          <button
            onClick={allow}
            disabled={busy}
            className="w-full rounded-full bg-ink px-6 py-3.5 text-[15px] font-medium text-white transition-colors hover:bg-ink-soft disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Allow access"}
          </button>
          <button
            onClick={cancel}
            disabled={busy}
            className="w-full rounded-full px-6 py-3 text-[15px] font-medium text-muted transition-colors hover:text-ink"
          >
            Cancel
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Simulated Tesla sign-in for onboarding. No real account is accessed.
        </p>
      </div>
    </div>
  );
}

function Row({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="p-4">
      <div className="text-sm font-medium text-ink">{title}</div>
      <div className="mt-0.5 text-sm text-muted">{detail}</div>
    </div>
  );
}
