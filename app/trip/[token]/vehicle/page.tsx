"use client";

import { PageHeader } from "@/components/evhost-ui";
import { useGuestTripPortal } from "@/components/guest/GuestPortal";
import { Card } from "@/components/ui";
import { IconBolt, IconKey, IconVehicle } from "@/components/icons";
import { VehicleArtwork } from "@/components/vehicle/VehicleArtwork";

export default function GuestVehiclePage() {
  const trip = useGuestTripPortal();
  const config = trip.tenantConfig;
  const sections = [
    { icon: IconKey, title: "Keys and Tesla access", body: config.rental.keyAccess },
    { icon: IconBolt, title: "Charging", body: `${config.rental.chargeAccess}\n\n${config.rental.chargingPolicy}` },
    { icon: IconVehicle, title: "Return charge", body: `Return with ${config.rental.returnChargeLevel}. ${config.rental.skipChargeOption}` },
  ];
  return (
    <div className="mx-auto max-w-[1120px] space-y-7">
      <PageHeader eyebrow="Vehicle guide" title={trip.vehicle.displayName} description={[trip.vehicle.year, trip.vehicle.trim, trip.vehicle.color].filter(Boolean).join(" · ")} />
      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden">
          <VehicleArtwork model={trip.vehicle.model} color={trip.vehicle.color} trim={trip.vehicle.trim} wheelType={trip.vehicle.wheelType} interior={trip.vehicle.interior} interiorCode={trip.vehicle.teslaInteriorCode} paintCode={trip.vehicle.teslaPaintCode} year={trip.vehicle.year} decorative className="h-[340px] border-0 bg-white" />
          <dl className="grid grid-cols-2 border-t border-line text-sm sm:grid-cols-4">
            {[["Model", trip.vehicle.model], ["Shifter", trip.vehicle.shifter], ["Wheels", trip.vehicle.wheelType ?? "See vehicle"], ["Interior", trip.vehicle.interior ?? "See vehicle"]].map(([label, value]) => <div key={label} className="border-b border-line p-4 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1 font-semibold capitalize text-ink">{value}</dd></div>)}
          </dl>
        </Card>
        <div className="rounded-lg border border-line bg-white px-6">
          {sections.map(({ icon: Icon, title, body }) => <section key={title} className="border-b border-line py-6 last:border-0"><div className="flex items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/[0.08] text-brand"><Icon className="h-4.5 w-4.5" /></span><h2 className="font-semibold">{title}</h2></div><p className="mt-3 pl-12 whitespace-pre-line text-sm leading-6 text-muted">{body}</p></section>)}
        </div>
      </div>
    </div>
  );
}
