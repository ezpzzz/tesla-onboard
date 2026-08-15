"use client";

import Link from "next/link";
import { OpenListRow, PageHeader, TripRibbon } from "@/components/evhost-ui";
import { GuestReadiness } from "@/components/guest/GuestReadiness";
import { formatTripDate, useGuestTripPortal, useGuestTripToken } from "@/components/guest/GuestPortal";
import { buttonClassName, Card } from "@/components/ui";
import { IconGuide, IconKey, IconMapPin, IconVehicle } from "@/components/icons";
import { VehicleArtwork } from "@/components/vehicle/VehicleArtwork";
import { formatTripDuration } from "@/lib/trip-format";

export default function GuestTripHomePage() {
  const trip = useGuestTripPortal();
  const token = useGuestTripToken();
  const daysUntil = Math.max(0, Math.ceil((trip.startsAt - trip.generatedAt) / 86_400_000));
  const headline = trip.lifecycle === "upcoming"
    ? `Your ${trip.vehicle.model} is almost ready`
    : trip.lifecycle === "active"
      ? `Your ${trip.vehicle.model} trip is underway`
      : `Thanks for driving ${trip.vehicle.model}`;
  const subhead = trip.lifecycle === "upcoming"
    ? "Everything for pickup, in one place."
    : trip.lifecycle === "active"
      ? "Trip details and support are always within reach."
      : "Your trip guide and details remain available here.";
  const phaseLabel = trip.lifecycle === "upcoming"
    ? daysUntil === 0 ? "Pickup today" : `Pickup in ${daysUntil} day${daysUntil === 1 ? "" : "s"}`
    : trip.lifecycle === "active" ? "Trip in progress" : "Trip complete";

  return (
    <div className="mx-auto max-w-[1040px] space-y-5">
      <PageHeader eyebrow="Trip companion" title={headline} description={<><span className="block text-ink-soft">Hi {trip.guestFirstName},</span>{subhead}</>} />

      <Card className="overflow-hidden">
        <div className="grid lg:grid-cols-[1.12fr_0.88fr]">
          <div className="min-w-0 border-b border-line lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-3 border-b border-line bg-brand/[0.045] px-6 py-4 text-[15px] font-semibold">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/10 text-brand"><IconGuide className="h-4.5 w-4.5" /></span>
              {phaseLabel}
            </div>
            <VehicleArtwork
              model={trip.vehicle.model}
              color={trip.vehicle.color}
              trim={trip.vehicle.trim}
              wheelType={trip.vehicle.wheelType}
              interior={trip.vehicle.interior}
              interiorCode={trip.vehicle.teslaInteriorCode}
              paintCode={trip.vehicle.teslaPaintCode}
              year={trip.vehicle.year}
              decorative
              className="h-[260px] border-0 bg-white sm:h-[320px]"
            />
            <TripRibbon pickup={formatTripDate(trip.startsAt, trip.timezone)} pickupLocation={trip.pickupLocation ?? "See pickup instructions"} duration={formatTripDuration(trip.startsAt, trip.endsAt)} dropoff={formatTripDate(trip.endsAt, trip.timezone)} />
          </div>
          <section className="border-l-[4px] border-l-brand bg-white p-6 lg:border-l-0 lg:bg-brand/[0.025] lg:p-8" aria-labelledby="ready-title">
            <h2 id="ready-title" className="text-[22px] font-semibold tracking-[-0.02em]">{trip.lifecycle === "upcoming" ? "Get ready for pickup" : "Your handoff progress"}</h2>
            <div className="mt-5"><GuestReadiness /></div>
            <p className="mt-4 text-sm text-muted">{trip.progress?.isDone ? "Your guide is complete." : trip.progress ? `Continue from ${trip.progress.stepId.replaceAll("-", " ")}.` : "Start the guide before pickup."}</p>
            <Link href={`/trip/${token}/guide`} className={buttonClassName({ variant: "brand", fullWidth: true, className: "mt-5" })}>{trip.progress ? "Continue guide" : "Start guide"}</Link>
            <Link href={`/trip/${token}/details`} className="mt-2 flex min-h-11 items-center justify-center text-sm font-semibold text-brand">View trip details</Link>
          </section>
        </div>
      </Card>

      <Link href={`/trip/${token}/vehicle`} className="group flex min-h-20 items-center gap-4 rounded-lg border border-line border-l-brand bg-white px-5 hover:bg-brand/[0.025]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/[0.08] text-brand"><IconKey className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1"><span className="block font-semibold text-ink">Tesla access · {trip.accessStatus ? trip.accessStatus.replaceAll("_", " ") : "Not yet available"}</span><span className="mt-0.5 block text-sm text-muted">{trip.accessStatus ? "View access details for this trip" : "Your host will share access details when they are ready"}</span></span>
        <span className="text-brand">View</span>
      </Link>

      <section className="rounded-lg border border-line bg-white px-6 py-3" aria-labelledby="before-title">
        <div className="border-b border-line py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Trip essentials</div>
          <h2 id="before-title" className="mt-0.5 text-[20px] font-semibold">Before you go</h2>
        </div>
        <OpenListRow href={`/trip/${token}/details`} icon={<IconMapPin className="h-5 w-5" />} title="Pickup instructions" detail="Where to meet and what to bring" />
        <OpenListRow href={`/trip/${token}/vehicle`} icon={<IconVehicle className="h-5 w-5" />} title="Quick reference" detail="Key controls for your trip" />
      </section>
    </div>
  );
}
