"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";

export function TripAccessCompletion() {
  const params = useSearchParams();
  const token = params.get("trip");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; issueAt: string | null; revokeAt: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  if (!token || !ONLYEVS_OPERATIONS_ENABLED) return null;

  async function scheduleAccess() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/guest/trips/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, consent }),
        cache: "no-store",
      });
      const body = (await response.json().catch(() => null)) as {
        status?: string;
        issueAt?: string | null;
        revokeAt?: string | null;
        error?: string;
      } | null;
      if (!response.ok || !body?.status) throw new Error(body?.error ?? "Access could not be scheduled.");
      setResult({ status: body.status, issueAt: body.issueAt ?? null, revokeAt: body.revokeAt ?? null });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Access could not be scheduled.");
    } finally {
      setBusy(false);
    }
  }

  async function checkInvitation() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/guest/trips/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        cache: "no-store",
      });
      const body = await response.json().catch(() => null) as { ready?: boolean; url?: string; error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Invitation lookup failed.");
      if (body?.ready && body.url) setInviteUrl(body.url);
      else setError("Your invitation is not ready yet. It becomes available two hours before pickup.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.replaceAll("_", " ") : "Invitation lookup failed.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Card className="mt-5 border-good/20 bg-good/[0.04] p-4 text-left">
        <div className="flex items-center gap-2"><h2 className="font-medium text-ink">Tesla app access scheduled</h2><Badge tone="good">{result.status}</Badge></div>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          evhost.app will create a single-use Tesla driver invitation no earlier than two hours before pickup and revoke access one hour after return. Return to your private trip link to retrieve the invitation when it is ready.
        </p>
        {error ? <p role="status" className="mt-3 text-sm text-muted">{error}</p> : null}
        {inviteUrl ? (
          <a href={inviteUrl} rel="noreferrer" className="mt-4 flex min-h-12 items-center justify-center rounded-full bg-ink px-5 text-sm font-medium text-white">
            Accept invitation in Tesla
          </a>
        ) : (
          <Button className="mt-4" variant="secondary" disabled={busy} onClick={() => void checkInvitation()}>
            {busy ? "Checking…" : "Check Tesla invitation"}
          </Button>
        )}
      </Card>
    );
  }

  return (
    <Card className="mt-5 p-4 text-left">
      <h2 className="font-medium text-ink">Tesla app driver access</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        This grants the verified Tesla account temporary DRIVER access, including vehicle location and remote commands. It does not grant owner privileges.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        For the duration of this trip, evhost.app records vehicle telemetry from Tesla — battery
        level, estimated range, odometer, charge state, and lock state — to confirm handoff
        condition and validate mileage and charge at return, consistent with Turo policy.
      </p>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        During the approved trip window only, evhost.app may also receive low-frequency vehicle
        location from Tesla for handoff, safety, and return support. Location is never recorded
        outside an active, consented trip. Coordinates are encrypted, visible only to authorized
        workspace staff, and deleted after 30 days.
      </p>
      <label className="mt-3 flex items-start gap-3 text-sm leading-relaxed text-ink-soft">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-1 h-4 w-4 accent-brand" />
        <span>I consent to evhost.app creating and later revoking this trip-bound Tesla driver invitation, and to the trip-window vehicle telemetry and location processing described above.</span>
      </label>
      {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
      <Button className="mt-4" variant="brand" disabled={!consent || busy} onClick={() => void scheduleAccess()}>
        {busy ? "Scheduling…" : "Schedule Tesla app access"}
      </Button>
    </Card>
  );
}
