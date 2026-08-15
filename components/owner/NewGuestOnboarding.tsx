"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { Button, Card } from "@/components/ui";
import { IconArrowRight, IconCheck, IconClose, IconExternal, IconUser } from "@/components/icons";
import { tenantSetupCompletedAt } from "@/lib/tenant-config";
import { createManualGuestOnboarding, type GuestOnboardingLink } from "@/lib/owner/trip-repository";
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

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function NewGuestOnboarding({ vehicles }: { vehicles: Vehicle[] }) {
  const { workspace, persistence } = useOwnerTenant();
  const activeVehicles = useMemo(() => vehicles.filter((vehicle) => vehicle.status === "active"), [vehicles]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const guestNameRef = useRef<HTMLInputElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [returnLocation, setReturnLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GuestOnboardingLink | null>(null);
  const [copied, setCopied] = useState(false);

  const durable = persistence === "workspace" && Boolean(workspace);
  const published = Boolean(tenantSetupCompletedAt(workspace?.features));
  const ready = durable && published && activeVehicles.length > 0;

  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      (result ? resultHeadingRef.current : guestNameRef.current)?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(false);
        return;
      }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
        .filter((element) => element.offsetParent !== null);
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
  }, [expanded, result]);

  function prepareBlankForm() {
    const dates = defaultWindow();
    setStartsAt(dates.startsAt);
    setEndsAt(dates.endsAt);
    setVehicleId(activeVehicles.length === 1 ? activeVehicles[0].id : "");
    setGuestName("");
    setGuestEmail("");
    setPickupLocation("");
    setReturnLocation("");
    setError(null);
    setCopied(false);
  }

  function openForm() {
    if (!ready) return;
    if (!result && !startsAt) prepareBlankForm();
    setExpanded(true);
    setError(null);
  }

  function createAnother() {
    setResult(null);
    prepareBlankForm();
    window.requestAnimationFrame(() => guestNameRef.current?.focus());
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
        pickupLocation,
        returnLocation: returnLocation || pickupLocation,
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

  return (
    <section aria-labelledby="new-guest-heading">
      <Card className="overflow-hidden border-brand/20 bg-white">
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-brand text-white">
                <IconUser aria-hidden="true" className="h-5 w-5" />
              </div>
              <div>
                <h2 id="new-guest-heading" className="text-lg font-semibold tracking-tight text-ink">Invite your next guest</h2>
                <p className="mt-1 max-w-[48ch] text-sm leading-relaxed text-muted">
                  Create a private, booking-specific link and track the guest from first open to ready.
                </p>
              </div>
            </div>
            <Button ref={triggerRef} type="button" variant="brand" onClick={openForm} disabled={!ready} className="min-h-12 w-full shrink-0 px-7 text-base sm:w-auto">
              New onboarding <IconArrowRight aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
          {!ready ? (
            <p className="mt-4 border-t border-brand/10 pt-4 text-xs leading-relaxed text-muted">
              {!durable
                ? "A durable EVhost workspace is required before guest links can be created."
                : !published
                  ? <>Complete and publish <Link href="/owner/setup" className="font-medium text-brand hover:underline">fleet setup</Link> before inviting guests.</>
                  : <>Add an active vehicle in <Link href="/owner/vehicles" className="font-medium text-brand hover:underline">Vehicles</Link> before inviting guests.</>}
            </p>
          ) : null}
        </div>
      </Card>

      {expanded ? (
        <div className="fixed inset-0 z-[60] flex items-end bg-ink/45 md:items-center md:justify-center md:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false); }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="new-guest-dialog-title" className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[18px] border border-line bg-white shadow-[0_-16px_48px_rgba(22,26,31,0.18)] md:max-w-[720px] md:rounded-xl md:shadow-[0_24px_80px_rgba(22,26,31,0.2)]">
            <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line md:hidden" />
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Secure guest invitation</div>
                <h2 id="new-guest-dialog-title" ref={resultHeadingRef} tabIndex={result ? -1 : undefined} className="mt-1 text-xl font-semibold tracking-tight text-ink">
                  {result ? "Onboarding link ready" : "Trip and guest details"}
                </h2>
              </div>
              <button type="button" aria-label="Close guest invitation" onClick={() => setExpanded(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-ink">
                <IconClose aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto overscroll-contain px-5 py-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:px-6 sm:py-6">
              {result ? (
                <div aria-live="polite">
                  <div className="flex items-start gap-3 rounded-lg border border-good/20 bg-good/[0.04] p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-good/10 text-good"><IconCheck aria-hidden="true" className="h-5 w-5" /></div>
                    <p className="text-sm leading-relaxed text-muted">Share this private link only with <span className="font-semibold text-ink">{guestName}</span>. Anyone with the link can open this trip&apos;s walkthrough.</p>
                  </div>
                  <label className="mt-5 block text-sm font-medium text-ink" htmlFor="guest-onboarding-link">Private guest link</label>
                  <input id="guest-onboarding-link" readOnly value={result.guestUrl} className="field mt-2 w-full text-base text-ink" />
                  <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                    <Button type="button" variant="brand" fullWidth onClick={() => void copyLink()}>{copied ? "Copied" : "Copy link"}</Button>
                    <a href={result.guestUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-md border border-line bg-white px-6 py-3.5 text-[15px] font-semibold text-ink hover:bg-surface">Preview <IconExternal aria-hidden="true" className="h-4 w-4" /></a>
                    <Link href={`/owner/trips/${result.tripId}`} className="inline-flex min-h-[48px] items-center justify-center rounded-md px-4 py-3.5 text-sm font-semibold text-brand hover:bg-brand/5">Track this guest</Link>
                    <button type="button" onClick={createAnother} className="min-h-[48px] rounded-md px-3 text-sm font-medium text-muted hover:bg-surface hover:text-ink">Create another</button>
                  </div>
                  {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
                </div>
              ) : (
                <form onSubmit={submit} className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium text-ink">Guest name <span className="text-brand">Required</span><input ref={guestNameRef} required name="guestName" autoComplete="name" value={guestName} onChange={(event) => setGuestName(event.target.value)} className="field mt-2 w-full text-base" /></label>
                    <label className="text-sm font-medium text-ink">Booking email <span className="text-brand">Required</span><input required name="guestEmail" type="email" inputMode="email" autoComplete="email" value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} className="field mt-2 w-full text-base" /></label>
                    <label className="text-sm font-medium text-ink">Pickup location<input name="pickupLocation" autoComplete="street-address" maxLength={500} value={pickupLocation} onChange={(event) => setPickupLocation(event.target.value)} placeholder="Airport garage, hotel, or address" className="field mt-2 w-full text-base" /></label>
                    <label className="text-sm font-medium text-ink">Return location<input name="returnLocation" autoComplete="street-address" maxLength={500} value={returnLocation} onChange={(event) => setReturnLocation(event.target.value)} placeholder={pickupLocation || "Defaults to pickup"} className="field mt-2 w-full text-base" /></label>
                    <label className="text-sm font-medium text-ink sm:col-span-2">Vehicle <span className="text-brand">Required</span><select required name="vehicleId" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className="field mt-2 w-full text-base"><option value="">Choose a vehicle</option>{activeVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.displayName}</option>)}</select></label>
                    <label className="text-sm font-medium text-ink">Pickup <span className="text-brand">Required</span><input required name="startsAt" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className="field mt-2 w-full text-base" /></label>
                    <label className="text-sm font-medium text-ink">Return <span className="text-brand">Required</span><input required name="endsAt" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} className="field mt-2 w-full text-base" /></label>
                  </div>
                  {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
                  <div className="border-t border-line pt-4">
                    <p className="text-xs leading-relaxed text-muted">The link is encrypted for secure reminders and shown here for sharing. Its plaintext is never stored or logged.</p>
                    <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <Button type="button" variant="ghost" onClick={() => setExpanded(false)}>Cancel</Button>
                      <Button type="submit" variant="brand" disabled={saving} className="min-h-12 px-7">{saving ? "Creating…" : "Create private link"}</Button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
