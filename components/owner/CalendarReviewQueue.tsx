"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { Badge, Button, Card } from "@/components/ui";
import {
  confirmCalendarCandidate,
  dismissCalendarCandidate,
  fetchCalendarCandidates,
  resolveCalendarCandidateChange,
  type CalendarCandidate,
} from "@/lib/owner/trip-repository";
import { vehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import type { Vehicle } from "@/lib/owner/types";

function eventWindow(candidate: CalendarCandidate): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: candidate.timezone,
  });
  return `${formatter.format(candidate.startAt)} – ${formatter.format(candidate.endAt)}`;
}

export function CalendarReviewQueue({
  vehicles,
  confirmationEnabled,
}: {
  vehicles: Vehicle[];
  confirmationEnabled: boolean;
}) {
  const { workspace } = useOwnerTenant();
  const scope = useMemo(
    () => vehicleWorkspaceScope(workspace?.tenantRef),
    [workspace?.tenantRef],
  );
  const activeVehicles = useMemo(
    () => vehicles.filter((vehicle) => vehicle.status === "active"),
    [vehicles],
  );
  const [candidates, setCandidates] = useState<CalendarCandidate[]>([]);
  const [selected, setSelected] = useState<CalendarCandidate | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [guestUrl, setGuestUrl] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setCandidates([]);
    setSelected(null);
    if (!scope) return;
    try {
      const next = await fetchCalendarCandidates(scope);
      if (version === requestVersion.current) setCandidates(next);
    } catch (error) {
      if (version === requestVersion.current) {
        setMessage(error instanceof Error ? error.message : "Calendar events could not be loaded.");
      }
    }
  }, [scope]);
  useEffect(() => {
    setGuestUrl(null);
    setMessage(null);
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);
  useEffect(() => {
    if (!vehicleId && activeVehicles.length === 1) setVehicleId(activeVehicles[0].id);
  }, [activeVehicles, vehicleId]);

  function begin(candidate: CalendarCandidate) {
    setSelected(candidate);
    setGuestName("");
    setGuestEmail("");
    setGuestUrl(null);
    setMessage(null);
  }

  async function confirm() {
    if (!selected) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await confirmCalendarCandidate({
        candidateId: selected.id,
        vehicleId,
        guestName,
        guestEmail,
      });
      setGuestUrl(result.guestUrl);
      setMessage("Trip confirmed. Share this private onboarding link only with the booked guest.");
      setSelected(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The trip could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(candidate: CalendarCandidate) {
    setBusy(true);
    try {
      await dismissCalendarCandidate(candidate.id);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The event could not be dismissed.");
    } finally {
      setBusy(false);
    }
  }

  async function resolveChange(candidate: CalendarCandidate, action: "apply" | "cancel") {
    setBusy(true);
    setMessage(null);
    try {
      await resolveCalendarCandidateChange(candidate.id, action);
      setMessage(action === "cancel"
        ? "Trip cancelled and any issued Tesla access queued for immediate revocation."
        : "The confirmed trip and Tesla access window now use the updated event times.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The calendar change could not be applied.");
    } finally {
      setBusy(false);
    }
  }

  if (candidates.length === 0 && !message && !guestUrl) return null;
  return (
    <section className="space-y-3" aria-labelledby="calendar-review-title">
      <div>
        <div className="flex items-center gap-2">
          <h2 id="calendar-review-title" className="text-base font-semibold text-ink">Calendar review</h2>
          {candidates.length > 0 ? <Badge tone="warn">{candidates.length} pending</Badge> : null}
        </div>
        <p className="mt-1 text-sm text-muted">
          {confirmationEnabled
            ? "Calendar events are suggestions. Confirm the guest and vehicle before access is scheduled; later provider changes require an explicit decision here."
            : "Calendar events are suggestions. Review or dismiss each import here. Trip confirmation becomes available after the operations service passes its production gates."}
        </p>
      </div>
      {message ? <div role="status" className="rounded-md border border-line bg-white p-3 text-sm text-ink-soft">{message}</div> : null}
      {guestUrl ? (
        <Card className="p-4">
          <label className="block text-sm font-medium text-ink">
            Guest onboarding link
            <input name="onlyevs-guest-onboarding-link" readOnly value={guestUrl} className="mt-2 w-full rounded-md border border-line bg-surface px-3 py-3 text-base" />
          </label>
          <Button className="mt-3" variant="secondary" onClick={() => void navigator.clipboard.writeText(guestUrl)}>
            Copy link
          </Button>
        </Card>
      ) : null}
      {candidates.map((candidate) => (
        <Card key={candidate.id} className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-ink">{candidate.summary}</h3>
                {candidate.status === "needs_review" ? <Badge tone="danger">Event changed</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted">{eventWindow(candidate)}</p>
            </div>
            <div className="flex gap-2">
              {candidate.status === "needs_review" ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => void resolveChange(candidate, candidate.changeKind === "cancel" ? "cancel" : "apply")}
                    disabled={busy}
                  >
                    {candidate.changeKind === "cancel" ? "Cancel trip" : "Apply updated times"}
                  </Button>
                  <Button variant="ghost" onClick={() => void dismiss(candidate)} disabled={busy}>Keep current trip</Button>
                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => begin(candidate)}
                    disabled={busy || activeVehicles.length === 0 || !confirmationEnabled}
                    title={confirmationEnabled ? undefined : "Trip confirmation requires the operations service"}
                  >
                    {confirmationEnabled ? "Review" : "Review unavailable"}
                  </Button>
                  <Button variant="ghost" onClick={() => void dismiss(candidate)} disabled={busy}>Dismiss</Button>
                </>
              )}
            </div>
          </div>
          {candidate.status === "pending" && selected?.id === candidate.id ? (
            <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-ink">Guest name
                <input name="onlyevs-trip-guest-name" value={guestName} onChange={(event) => setGuestName(event.target.value)} className="mt-1.5 w-full rounded-md border border-line px-3.5 py-3 text-base" autoComplete="name" />
              </label>
              <label className="text-sm font-medium text-ink">Booking email
                <input name="onlyevs-trip-guest-email" type="email" value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} className="mt-1.5 w-full rounded-md border border-line px-3.5 py-3 text-base" autoComplete="email" />
              </label>
              <label className="text-sm font-medium text-ink sm:col-span-2">Vehicle
                <select name="onlyevs-trip-vehicle" value={vehicleId} onChange={(event) => setVehicleId(event.target.value)} className="mt-1.5 w-full rounded-md border border-line bg-white px-3.5 py-3 text-base">
                  <option value="">Choose a fleet vehicle</option>
                  {activeVehicles.map((vehicle) => <option key={vehicle.id} value={vehicle.id}>{vehicle.displayName}</option>)}
                </select>
              </label>
              <div className="flex gap-2 sm:col-span-2">
                <Button onClick={() => void confirm()} disabled={busy || !vehicleId || !guestName.trim() || !guestEmail.trim()}>
                  {busy ? "Confirming…" : "Confirm trip"}
                </Button>
                <Button variant="ghost" onClick={() => setSelected(null)} disabled={busy}>Cancel</Button>
              </div>
            </div>
          ) : null}
        </Card>
      ))}
    </section>
  );
}
