"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, ReadinessRail, StatePanel, TripRibbon } from "@/components/evhost-ui";
import { ReminderButton } from "@/components/owner/ReminderButton";
import { NewGuestOnboarding } from "@/components/owner/NewGuestOnboarding";
import { Card } from "@/components/ui";
import { IconAlert, IconCalendar, IconChevronRight, IconKey, IconTrips, IconVehicle } from "@/components/icons";
import { VehicleArtwork } from "@/components/vehicle/VehicleArtwork";
import { useOwnerData } from "@/lib/owner/use-owner-data";
import { handoffSteps, selectAttentionQueue, selectNextHandoff } from "@/lib/owner/handoff";
import { formatTripDuration } from "@/lib/trip-format";

function dateTime(ms: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(ms));
}

function fullDate(ms: number) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(ms));
}

export default function OwnerTodayPage() {
  const { drivers, trips, vehicles, stats, hydrated, vehicleError, operationalError } = useOwnerData();
  const [now, setNow] = useState(0);
  useEffect(() => setNow(Date.now()), []);
  const handoff = useMemo(() => now ? selectNextHandoff(trips, drivers, vehicles, now) : null, [trips, drivers, vehicles, now]);
  const boundaries = useMemo(() => {
    if (!now) return [];
    return trips.flatMap((trip) => {
      const driver = drivers.find((item) => item.id === trip.driverId);
      const vehicle = vehicles.find((item) => item.id === trip.vehicleId);
      if (trip.status === "active" && trip.endAt > now) return [{ trip, at: trip.endAt, kind: "return", label: `${driver?.name || "Guest"} return`, location: trip.returnLocation, vehicle }];
      if (trip.status === "upcoming" && trip.startAt > now) return [{ trip, at: trip.startAt, kind: "pickup", label: `${driver?.name || "Guest"} pickup`, location: trip.pickupLocation, vehicle }];
      return [];
    }).sort((a, b) => a.at - b.at).slice(0, 3);
  }, [trips, drivers, vehicles, now]);
  const attention = useMemo(() => now ? selectAttentionQueue(drivers, trips, now) : [], [drivers, trips, now]);
  const error = vehicleError ?? operationalError;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Operations" title="Today" description={now ? fullDate(now) : "Loading today…"} />
      <section id="new-guest" className="scroll-mt-24"><NewGuestOnboarding vehicles={vehicles} /></section>
      {error ? <StatePanel tone="danger" title="Fleet data is unavailable" detail={error} /> : null}

      {!hydrated ? <TodayHandoffSkeleton /> : handoff ? (
        <Card className="overflow-hidden">
          <div className="grid lg:grid-cols-[1.12fr_0.88fr]">
            <section className="border-b border-line lg:border-b-0 lg:border-r" aria-labelledby="next-handoff-title">
              <div className="border-b border-line bg-brand/[0.045] px-6 py-4"><div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Next handoff</div><h2 id="next-handoff-title" className="mt-1 font-semibold">{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(handoff.boundaryAt))}</h2><p className="mt-1 text-sm text-muted">{handoff.location ?? "Location in trip instructions"}</p></div>
              {handoff.vehicle ? <VehicleArtwork model={handoff.vehicle.model} color={handoff.vehicle.color} trim={handoff.vehicle.trim} wheelType={handoff.vehicle.wheelType} interior={handoff.vehicle.interior} interiorCode={handoff.vehicle.teslaInteriorCode} paintCode={handoff.vehicle.teslaPaintCode} year={handoff.vehicle.year} decorative className="h-[220px] border-0 bg-white sm:h-[260px] lg:h-[300px]" /> : <div className="flex h-[220px] items-center justify-center text-sm text-muted sm:h-[260px] lg:h-[300px]">Vehicle image unavailable</div>}
              <TripRibbon pickup={dateTime(handoff.trip.startAt)} pickupLocation={handoff.trip.pickupLocation ?? null} duration={formatTripDuration(handoff.trip.startAt, handoff.trip.endAt)} dropoff={dateTime(handoff.trip.endAt)} />
            </section>
            <section className="bg-white p-6 lg:bg-brand/[0.025] lg:p-8" aria-labelledby="handoff-guest-title">
              <h2 id="handoff-guest-title" className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">{handoff.driver?.name || "Guest"}</h2>
              <p className="mt-1 text-[18px] font-semibold">{handoff.kind === "pickup" ? "Pickup" : "Return"} {relativeBoundary(handoff.boundaryAt, now)}</p>
              <p className="mt-3 text-sm leading-6 text-muted">{dateTime(handoff.trip.startAt)} → {dateTime(handoff.trip.endAt)}<br />{handoff.location ?? "See trip instructions"}</p>
              <div className="my-5 border-t border-line" />
              <ReadinessRail steps={handoffSteps(handoff)} />
              {!handoff.driver?.progress?.isDone ? <div className="mt-4 flex items-start gap-2 text-sm text-muted"><IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" />Walkthrough is incomplete.</div> : null}
              <ReminderButton tripId={handoff.trip.id} className="mt-5" fullWidth />
              <Link href={`/owner/trips/${handoff.trip.id}`} className="mt-2 flex min-h-11 items-center justify-center text-sm font-semibold text-brand">View trip</Link>
            </section>
          </div>
        </Card>
      ) : <StatePanel tone="brand" title="No handoffs are scheduled" detail="Create a private guest trip to start tracking readiness and access." action={<Link href="#new-guest" className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-brand hover:bg-brand/5">Create a guest trip</Link>} />}

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="rounded-lg border border-line bg-white px-6 py-3" aria-labelledby="today-handoffs-title">
          <h2 id="today-handoffs-title" className="flex items-center gap-2 border-b border-line py-3 text-[17px] font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/[0.08] text-brand"><IconCalendar className="h-4 w-4" /></span>Upcoming handoffs</h2>
          {boundaries.length ? boundaries.map((item) => <Link key={`${item.trip.id}-${item.kind}`} href={`/owner/trips/${item.trip.id}`} className="group grid min-h-[64px] grid-cols-[72px_1fr_auto] items-center gap-3 border-b border-line text-sm last:border-0 hover:bg-surface/60"><span className="text-muted">{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(item.at))}</span><span className="min-w-0"><span className="block truncate font-semibold">{item.label}</span><span className="block truncate text-xs text-muted">{item.location ?? item.vehicle?.displayName ?? "Trip details"}</span></span><IconChevronRight className="h-4 w-4 text-muted group-hover:translate-x-0.5" /></Link>) : <p className="py-6 text-sm text-muted">No upcoming pickup or return boundaries.</p>}
        </section>
        <section className="rounded-lg border border-line bg-white px-6 py-3" aria-labelledby="attention-title">
          <h2 id="attention-title" className="flex items-center gap-2 border-b border-line py-3 text-[17px] font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-warn/10 text-warn"><IconAlert className="h-4 w-4" /></span>Needs attention · {attention.length}</h2>
          {attention.length ? attention.map(({ driver, status, trip }) => <div key={driver.id} className="flex min-h-[64px] items-center gap-3 border-b border-line last:border-0"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface text-xs font-semibold">{driver.name.slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{driver.name || "Guest"} walkthrough</span><span className="block text-xs text-muted">{status.replaceAll("-", " ")}</span></span><Link href={`/owner/trips/${trip.id}`} className="text-xs font-semibold text-brand">Review</Link></div>) : <p className="py-6 text-sm text-muted">Every active guest is on track.</p>}
        </section>
      </div>

      <section className="grid grid-cols-3 divide-x divide-line rounded-lg border border-line bg-white py-5 text-center">
        <div><div className="text-2xl font-semibold text-brand">{stats.tripCounts.active + stats.tripCounts.upcoming}</div><div className="mt-1 text-xs text-muted">Trips in motion</div></div>
        <div><div className="text-2xl font-semibold text-good">{drivers.filter((driver) => driver.progress?.isDone).length}</div><div className="mt-1 text-xs text-muted">Guests ready</div></div>
        <div><div className={attention.length ? "text-2xl font-semibold text-warn" : "text-2xl font-semibold text-ink"}>{attention.length}</div><div className="mt-1 text-xs text-muted">Actions needed</div></div>
      </section>

    </div>
  );
}

function relativeBoundary(at: number, now: number) {
  const hours = Math.max(0, Math.round((at - now) / 3_600_000));
  if (hours < 1) return "within the hour";
  if (hours < 24) return `in ${hours} hours`;
  const days = Math.ceil(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

function TodayHandoffSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading today’s handoffs" className="overflow-hidden">
      <div className="grid lg:grid-cols-[1.12fr_0.88fr]">
        <div className="border-b border-line lg:border-b-0 lg:border-r" aria-hidden="true">
          <div className="h-[101px] border-b border-line bg-brand/[0.035] px-6 py-4">
            <div className="h-3 w-24 rounded-full bg-line/70" />
            <div className="mt-3 h-5 w-20 rounded-full bg-line" />
            <div className="mt-2 h-4 w-56 max-w-full rounded-full bg-line/70" />
          </div>
          <div className="h-[220px] bg-white sm:h-[260px] lg:h-[300px]" />
          <div className="h-[176px] border-t border-line bg-surface/60 sm:h-[148px]" />
        </div>
        <div className="min-h-[390px] bg-white p-6 lg:min-h-0 lg:bg-brand/[0.02] lg:p-8" aria-hidden="true">
          <div className="h-7 w-40 rounded-full bg-line" />
          <div className="mt-3 h-5 w-32 rounded-full bg-line/80" />
          <div className="mt-5 h-4 w-64 max-w-full rounded-full bg-line/65" />
          <div className="my-5 border-t border-line" />
          <div className="space-y-4">
            {[0, 1, 2, 3].map((item) => <div key={item} className="h-11 rounded-md bg-surface" />)}
          </div>
        </div>
      </div>
    </Card>
  );
}
