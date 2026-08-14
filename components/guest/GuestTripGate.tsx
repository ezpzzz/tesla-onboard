"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";

export function GuestTripGate({
  token,
  companyName,
  vehicleName,
  startsAt,
  endsAt,
  timezone,
}: {
  token: string;
  companyName: string;
  vehicleName: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const windowText = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/guest/trips/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email }),
        cache: "no-store",
      });
      if (!response.ok) throw new Error("request_failed");
      setSent(true);
    } catch {
      setError("We couldn't send the secure link. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-5 py-10">
      <main className="w-full max-w-[480px] space-y-5 rounded-3xl border border-line bg-white p-6 shadow-[0_0_80px_rgba(23,26,32,0.08)]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Private trip invitation</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-ink">
            Verify your booking email.
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            {companyName} requires the exact email on the confirmed booking before this walkthrough can schedule Tesla app access.
          </p>
        </div>
        <Card className="divide-y divide-line">
          <div className="p-4"><span className="text-xs uppercase tracking-wide text-muted">Vehicle</span><p className="mt-1 font-medium">{vehicleName}</p></div>
          <div className="p-4"><span className="text-xs uppercase tracking-wide text-muted">Trip</span><p className="mt-1 text-sm leading-relaxed">{windowText.format(Date.parse(startsAt))} – {windowText.format(Date.parse(endsAt))}</p></div>
        </Card>
        {sent ? (
          <div role="status" className="rounded-2xl border border-good/20 bg-good/[0.05] p-4 text-sm leading-relaxed text-ink-soft">
            If that address matches the booking, a secure sign-in link is on its way. This page intentionally gives the same response for every address.
          </div>
        ) : (
          <form onSubmit={sendLink} className="space-y-3">
            {error ? <p role="alert" className="rounded-xl border border-danger/20 bg-danger/[0.04] p-3 text-sm text-danger">{error}</p> : null}
            <label className="block text-sm font-medium text-ink">
              Booking email
              <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/15" />
            </label>
            <Button type="submit" fullWidth disabled={busy || !email.trim()}>{busy ? "Sending…" : "Email me a secure link"}</Button>
          </form>
        )}
        <p className="text-xs leading-relaxed text-muted">
          The link proves booking identity. Tesla sign-in later proves the account that receives vehicle access; evhost.app never asks for a Tesla password.
        </p>
      </main>
    </div>
  );
}
