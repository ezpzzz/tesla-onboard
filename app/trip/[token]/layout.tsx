import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { GuestPortalLayout } from "@/components/guest/GuestPortal";
import { loadGuestTripPortal } from "@/lib/guest-trip-portal";

export const dynamic = "force-dynamic";

export default async function TripPortalLayout({ children, params }: { children: ReactNode; params: Promise<{ token: string }> }) {
  const { token } = await params;
  const snapshot = await loadGuestTripPortal(token);
  if (!snapshot) notFound();
  return <GuestPortalLayout snapshot={snapshot} token={token}>{children}</GuestPortalLayout>;
}
