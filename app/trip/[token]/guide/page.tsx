"use client";

import OnboardingApp from "@/components/OnboardingApp";
import { useGuestTripPortal } from "@/components/guest/GuestPortal";

export default function GuestGuidePage() {
  const trip = useGuestTripPortal();
  return <div className="mx-auto max-w-[820px] overflow-hidden rounded-lg border border-line bg-white"><OnboardingApp embedded initialProgress={trip.progress} /></div>;
}
