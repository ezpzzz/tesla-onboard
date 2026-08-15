"use client";

import Link from "next/link";
import { PageHeader } from "@/components/evhost-ui";
import { GuestReadiness } from "@/components/guest/GuestReadiness";
import { formatTripRange, useGuestTripPortal, useGuestTripToken } from "@/components/guest/GuestPortal";
import { Button, Card } from "@/components/ui";
import { IconBolt, IconGuide, IconMail, IconMapPin, IconPhone, IconVehicle } from "@/components/icons";
import { VehicleArtwork } from "@/components/vehicle/VehicleArtwork";

export default function GuestHelpPage() {
  const trip = useGuestTripPortal();
  const config = trip.tenantConfig;
  const token = useGuestTripToken();
  const answers = [
    { icon: IconMapPin, title: "Where do I pick up the car?", body: trip.pickupLocation ?? config.rental.pickupNote },
    { icon: IconVehicle, title: "How does Tesla app access work?", body: config.rental.keyAccess },
    { icon: IconBolt, title: "Where can I charge?", body: `${config.rental.chargeAccess} ${config.rental.chargingPolicy}` },
    { icon: IconBolt, title: "What charge level should I return with?", body: `Return with ${config.rental.returnChargeLevel}.` },
    { icon: IconGuide, title: "What if I’m running late?", body: "Request trip changes in Turo before the scheduled end time, then contact your host." },
  ];
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-7">
        <PageHeader title="Help for your trip" description="Clear answers before pickup and on the road." />
        <Card className="grid sm:grid-cols-2">
          {config.hostPhone ? <a href={`tel:${config.hostPhone}`} rel="noreferrer" className="flex min-h-20 items-center gap-4 p-5 hover:bg-surface"><IconPhone className="h-6 w-6" /><span><span className="block font-semibold text-brand">Call {config.hostName || "your host"}</span><span className="mt-1 block text-xs text-muted">Trip and pickup help</span></span></a> : null}
          {config.roadsidePhone ? <a href={`tel:${config.roadsidePhone}`} rel="noreferrer" className="flex min-h-20 items-center gap-4 border-t border-line p-5 hover:bg-surface sm:border-l sm:border-t-0"><IconPhone className="h-6 w-6" /><span><span className="block font-semibold text-brand">Roadside · 24/7</span><span className="mt-1 block text-xs text-muted">Emergencies and roadside help</span></span></a> : null}
        </Card>
        <section><h2 className="mb-3 text-[18px] font-semibold">Quick answers</h2><div className="overflow-hidden rounded-lg border border-line">{answers.map(({ icon: Icon, title, body }, index) => <details key={title} open={index === 1} className="group border-b border-line bg-white last:border-0"><summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 text-[15px] font-semibold marker:hidden"><Icon className="h-5 w-5 text-ink-soft" /><span className="flex-1">{title}</span><span className="text-muted group-open:rotate-45">+</span></summary><p className="px-12 pb-5 text-sm leading-6 text-muted">{body}</p></details>)}</div></section>
        <section><h2 className="mb-3 text-[18px] font-semibold">Trip materials</h2><div className="grid gap-3 sm:grid-cols-2">{[[`/trip/${token}/details`, "Pickup & return", "Details, location, and what to bring"], [`/trip/${token}/vehicle`, "Tesla quick reference", "Key controls and tips"], [`/trip/${token}/vehicle`, "Charging guide", "How to charge and pay"], [`/trip/${token}/details`, "House rules", "Guidelines for a great trip"]].map(([href,title,detail]) => <Link key={title} href={href} className="flex min-h-16 items-center justify-between rounded-md border border-line bg-white px-4 hover:bg-surface"><span><span className="block font-semibold">{title}</span><span className="mt-0.5 block text-xs text-muted">{detail}</span></span><span className="text-sm font-semibold text-brand">Open</span></Link>)}</div></section>
        <p className="text-sm text-muted">Trip changes and official Turo requirements stay in the Turo app.</p>
      </div>
      <aside className="space-y-4">
        <Card className="overflow-hidden"><div className="p-5"><h2 className="text-[20px] font-semibold">{trip.vehicle.model}</h2><p className="text-sm text-muted">{trip.vehicle.color}</p></div><VehicleArtwork model={trip.vehicle.model} color={trip.vehicle.color} trim={trip.vehicle.trim} wheelType={trip.vehicle.wheelType} interior={trip.vehicle.interior} interiorCode={trip.vehicle.teslaInteriorCode} paintCode={trip.vehicle.teslaPaintCode} year={trip.vehicle.year} decorative className="h-44 border-0 bg-white" /><div className="border-t border-line p-5 text-sm"><div className="font-medium">{formatTripRange(trip)}</div><div className="mt-3 flex items-start gap-2 text-muted"><IconMapPin className="h-4 w-4 shrink-0" />{trip.pickupLocation ?? "See pickup instructions"}</div></div></Card>
        <Card className="p-5"><h2 className="font-semibold">Your handoff progress</h2><div className="mt-3"><GuestReadiness /></div><Link href={`/trip/${token}/guide`} className="mt-4 block"><Button variant="brand" fullWidth>Continue guide</Button></Link></Card>
        <Card className="p-5"><h2 className="font-semibold">Your host</h2><div className="mt-3 text-sm text-muted">{config.hostName ? <div className="pb-1">{config.hostName}</div> : null}{config.hostPhone ? <a href={`tel:${config.hostPhone}`} rel="noreferrer" className="flex min-h-11 items-center gap-2 rounded-md text-brand hover:text-brand-dark"><IconPhone className="h-4 w-4" />{config.hostPhone}</a> : null}{config.supportEmail ? <a href={`mailto:${config.supportEmail}`} rel="noreferrer" className="flex min-h-11 items-center gap-2 rounded-md text-brand hover:text-brand-dark"><IconMail className="h-4 w-4" />{config.supportEmail}</a> : null}</div></Card>
      </aside>
    </div>
  );
}
