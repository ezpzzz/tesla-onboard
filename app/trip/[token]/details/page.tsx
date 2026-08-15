"use client";

import { PageHeader } from "@/components/evhost-ui";
import { formatTripDate, useGuestTripPortal } from "@/components/guest/GuestPortal";
import { Card } from "@/components/ui";
import { IconCalendar, IconMapPin } from "@/components/icons";

export default function GuestTripDetailsPage() {
  const trip = useGuestTripPortal();
  const rows = [
    { title: "Pickup", when: formatTripDate(trip.startsAt, trip.timezone), location: trip.pickupLocation, fallback: trip.tenantConfig.rental.pickupNote },
    { title: "Return", when: formatTripDate(trip.endsAt, trip.timezone), location: trip.returnLocation, fallback: trip.tenantConfig.rental.returnNote },
  ];
  return <div className="mx-auto max-w-[900px] space-y-7"><PageHeader eyebrow="Trip schedule" title="Trip details" description={`${trip.vehicle.displayName} · ${trip.companyName}`} /><Card className="overflow-hidden">{rows.map((row) => <section key={row.title} className="grid gap-5 border-b border-line p-6 last:border-0 sm:grid-cols-[180px_1fr]"><div><div className="flex items-center gap-2 text-sm font-semibold text-brand"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand/[0.08]"><IconCalendar className="h-4 w-4" /></span>{row.title}</div><div className="mt-2 font-semibold text-ink">{row.when}</div></div><div><div className="flex items-start gap-2 font-semibold text-ink"><IconMapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand" />{row.location ?? "Use the host instructions below"}</div><p className="mt-3 text-sm leading-6 text-muted">{row.fallback}</p></div></section>)}</Card><Card className="border-l-brand p-6"><div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">Arrival note</div><h2 className="mt-1 font-semibold">Parking</h2><p className="mt-2 text-sm leading-6 text-muted">{trip.tenantConfig.rental.parkingNote}</p></Card></div>;
}
