"use client";

import { ReadinessRail, type RailStep } from "@/components/evhost-ui";
import { useGuestTripPortal } from "@/components/guest/GuestPortal";

export function guestReadinessSteps(snapshot: ReturnType<typeof useGuestTripPortal>): RailStep[] {
  const progress = snapshot.progress;
  const accessComplete = ["invite_ready", "redeemed", "active"].includes(snapshot.accessStatus ?? "");
  const tripStarted = snapshot.lifecycle !== "upcoming";
  return [
    { label: "Link", detail: "Trip link opened", value: "Complete", state: "complete" },
    {
      label: "Tesla",
      detail: accessComplete ? "Tesla access ready" : snapshot.accessStatus ? snapshot.accessStatus.replaceAll("_", " ") : "Access details pending",
      value: accessComplete ? "Complete" : "Pending",
      state: accessComplete ? "complete" : "pending",
    },
    { label: "Guide", detail: "Walkthrough progress", value: `${Math.round(progress?.pct ?? 0)}%`, state: progress?.isDone ? "complete" : progress ? "current" : "pending" },
    { label: "Pickup", detail: tripStarted ? "Trip started" : "Ready for pickup", value: tripStarted ? "Complete" : "Pending", state: tripStarted ? "complete" : "pending" },
  ];
}

export function GuestReadiness() {
  const snapshot = useGuestTripPortal();
  return <ReadinessRail steps={guestReadinessSteps(snapshot)} />;
}
