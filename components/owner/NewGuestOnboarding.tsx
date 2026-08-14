"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { Button, Card } from "@/components/ui";
import { IconArrowRight, IconCheck, IconExternal, IconUser } from "@/components/icons";
import { tenantSetupCompletedAt } from "@/lib/tenant-config";
import {
  createManualGuestOnboarding,
  type GuestOnboardingLink,
} from "@/lib/owner/trip-repository";
import type { Vehicle } from "@/lib/owner/types";

function localDateTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultWindow(): { startsAt: string; endsAt: string } {
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(10, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 2);
  return { startsAt: localDateTime(start), endsAt: localDateTime(end) };
}

export function NewGuestOnboarding({ vehicles }: { vehicles: Vehicle[] }) {
  const { workspace, persistence } = useOwnerTenant();
  const activeVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.status === "active"),
    [vehicles],
  );
  const [expanded, setExpanded] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GuestOnboardingLink | null>(null);
  const [copied, setCopied] = useState(false);

  const durable = persistence === "workspace" && Boolean(workspace);
  const published = Boolean(tenantSetupCompletedAt(workspace?.features));
  const ready = durable && published && activeVehicles.length > 0;

  function openForm() {
    if (!ready) return;
    const window = defaultWindow();
    setStartsAt(window.startsAt);
    setEndsAt(window.endsAt);
    setVehicleId(activeVehicles.length === 1 ? activeVehicles[0].id : "");
    setExpanded(true);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createManualGuestOnboarding({
        workspaceId: workspace.id,
        shopSlug: workspace.shopSlug,
        vehicleId,
        guestName,
        guestEmail,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      setResult(created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The guest onboarding could not be created.");
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.guestUrl);
      setCopied(true);
      setError(null);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy is unavailable in this browser. Select and copy the link above.");
    }
  }

  function reset() {
    setExpanded(false);
    setResult(null);
    setGuestName("");
    setGuestEmail("");
    setVehicleId("");
    setError(null);
  }

  return (
    <section aria-labelledby="new-guest-heading">
      <Card className="overflow-hidden border-brand/30 bg-gradient-to-br from-brand/[0.09] via-white to-white shadow-sm">
        <div className="p-5 sm:p-6">
          {!expanded ? (
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand text-white shadow-sm">
                  <IconUser aria-hidden="true" className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">
                    Guest onboarding
                  </p>
                  <h2 id="new-guest-heading" className="mt-1 text-lg font-semibold tracking-tight text-ink">
                    Invite your next guest
                  </h2>
                  <p className="mt-1 max-w-[48ch] text-sm leading-relaxed text-muted">
                    Create a private, booking-specific link and track the guest from first open to ready.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="brand"
                onClick={openForm}
                disabled={!ready}
                className="min-h-12 shrink-0 px-7 text-base shadow-sm"
              >
                New onboarding
                <IconArrowRight aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
          ) : result ? (
            <div aria-live="polite">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-good/10 text-good">
                  <IconCheck aria-hidden="true" className="h-5 w-5" />
                </div>
                <div>
                  <h2 id="new-guest-heading" className="text-lg font-semibold text-ink">Onboarding link ready</h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Share this private link only with {guestName}. They must verify {guestEmail} before beginning.
                  </p>
                </div>
              </div>
              <label className="mt-5 block text-sm font-medium text-ink" htmlFor="guest-onboarding-link">
                Private guest link
              </label>
              <input
                id="guest-onboarding-link"
                readOnly
                value={result.guestUrl}
                className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              />
              <div className="mt-4 flex flex-wrap gap-2.5">
                <Button type="button" variant="brand" onClick={() => void copyLink()}>
                  {copied ? "Copied" : "Copy link"}
                </Button>
                <a
                  href={result.guestUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border border-line bg-white px-6 py-3.5 text-[15px] font-medium text-ink hover:bg-surface"
                >
                  Preview
                  <IconExternal aria-hidden="true" className="h-4 w-4" />
                </a>
                <Link
                  href={`/owner/trips/${result.tripId}`}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-full px-4 py-3.5 text-sm font-medium text-muted hover:text-ink"
                >
                  Track this guest
                </Link>
                <button type="button" onClick={reset} className="min-h-[48px] px-3 text-sm font-medium text-muted hover:text-ink">
                  Create another
                </button>
              </div>
              {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">New guest onboarding</p>
                  <h2 id="new-guest-heading" className="mt-1 text-lg font-semibold text-ink">Trip and guest details</h2>
                </div>
                <button type="button" onClick={() => setExpanded(false)} className="min-h-[44px] px-2 text-sm font-medium text-muted hover:text-ink">
                  Cancel
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-ink">
                  Guest name <span className="text-brand">Required</span>
                  <input
                    required
                    name="guestName"
                    autoComplete="name"
                    value={guestName}
                    onChange={(event) => setGuestName(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </label>
                <label className="text-sm font-medium text-ink">
                  Booking email <span className="text-brand">Required</span>
                  <input
                    required
                    name="guestEmail"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={guestEmail}
                    onChange={(event) => setGuestEmail(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </label>
                <label className="text-sm font-medium text-ink sm:col-span-2">
                  Vehicle <span className="text-brand">Required</span>
                  <select
                    required
                    name="vehicleId"
                    value={vehicleId}
                    onChange={(event) => setVehicleId(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  >
                    <option value="">Choose a vehicle</option>
                    {activeVehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>{vehicle.displayName}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-ink">
                  Pickup <span className="text-brand">Required</span>
                  <input
                    required
                    name="startsAt"
                    type="datetime-local"
                    value={startsAt}
                    onChange={(event) => setStartsAt(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </label>
                <label className="text-sm font-medium text-ink">
                  Return <span className="text-brand">Required</span>
                  <input
                    required
                    name="endsAt"
                    type="datetime-local"
                    value={endsAt}
                    onChange={(event) => setEndsAt(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-line bg-white px-4 py-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </label>
              </div>
              {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <p className="max-w-[48ch] text-xs leading-relaxed text-muted">
                  The raw link is shown once. evhost.app stores only its cryptographic hash and tracks progress after the guest verifies the booking email.
                </p>
                <Button type="submit" variant="brand" disabled={saving} className="min-h-12 px-7">
                  {saving ? "Creating…" : "Create private link"}
                </Button>
              </div>
            </form>
          )}

          {!expanded && !ready ? (
            <p className="mt-4 border-t border-brand/10 pt-4 text-xs leading-relaxed text-muted">
              {!durable
                ? "A durable Sophosic workspace is required before guest links can be created."
                : !published
                  ? <>Complete and publish <Link href="/owner/setup" className="font-medium text-brand hover:underline">fleet setup</Link> before inviting guests.</>
                  : <>Add an active vehicle in <Link href="/owner/vehicles" className="font-medium text-brand hover:underline">Vehicles</Link> before inviting guests.</>}
            </p>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
