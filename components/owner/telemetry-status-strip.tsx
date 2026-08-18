"use client";

/**
 * Telemetry setup status strip (Phase 5, design review Issue 3, 3A) —
 * cold-start only. Renders in IntegrationSetupChecklist-style plain-word
 * vocabulary read from public.onlyevs_telemetry_enrollments.status, and
 * disappears permanently at first streamed signal (subtraction default: it
 * never returns for a live vehicle). A vehicle with no enrollment row at
 * all (no VIN, or Tesla not connected — the worker enrolls automatically,
 * there is no manual "enroll" action anywhere in this codebase) renders as
 * plain manual-era: no strip here, handled by the live-state card's own
 * empty state instead.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { VehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import { StatePanel } from "@/components/evhost-ui";
import {
  deriveTelemetryStripState,
  type TelemetryEnrollmentRow,
  type TelemetryEnrollmentStatus,
} from "./telemetry-view";

interface EnrollmentRowShape {
  status: TelemetryEnrollmentStatus;
  last_error_code: string | null;
  created_at: string;
}

/** `undefined` = still loading, `null` = no enrollment row for this vehicle
 * (never-enrolled, or the read failed — both render the same "hidden"
 * outcome via deriveTelemetryStripState, so a query failure degrades to
 * manual-era rather than a broken strip). */
function useTelemetryEnrollment(
  scope: VehicleWorkspaceScope | null,
  vehicleId: string,
): TelemetryEnrollmentRow | null | undefined {
  const [row, setRow] = useState<TelemetryEnrollmentRow | null | undefined>(undefined);

  useEffect(() => {
    if (!scope) {
      setRow(null);
      return;
    }
    let cancelled = false;
    setRow(undefined);
    createClient()
      .from("onlyevs_telemetry_enrollments")
      .select("status,last_error_code,created_at")
      .eq("workspace_id", scope.workspaceId)
      .eq("vehicle_id", vehicleId)
      .maybeSingle<EnrollmentRowShape>()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setRow(null);
          return;
        }
        setRow({ status: data.status, lastErrorCode: data.last_error_code, createdAt: Date.parse(data.created_at) });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scope.key is
    // the stable identity for this scope; the object itself may be a fresh
    // reference every render (vehicleWorkspaceScope is not memoized by its
    // caller), so depending on it directly would re-fetch every render.
  }, [scope?.key, vehicleId]);

  return row;
}

export function TelemetryStatusStrip({
  scope,
  vehicleId,
  hasLiveSignal,
}: {
  scope: VehicleWorkspaceScope | null;
  vehicleId: string;
  hasLiveSignal: boolean;
}) {
  const enrollment = useTelemetryEnrollment(scope, vehicleId);

  // Loading shim reserves the strip's typical height so nothing jumps when
  // the read resolves (design review Issue 2, 2A).
  if (enrollment === undefined) {
    return <div className="h-[104px] animate-pulse rounded-lg border border-line bg-surface" aria-hidden="true" />;
  }

  const state = deriveTelemetryStripState({ enrollment, hasLiveSignal, nowMs: Date.now() });
  if (state.kind === "hidden") return null;

  const manageLink = (
    <Link href="/owner/integrations" className="text-sm font-medium text-brand hover:underline">
      Manage Tesla connection
    </Link>
  );

  switch (state.kind) {
    case "setting-up":
      return (
        <StatePanel
          tone="brand"
          title="Setting up telemetry — no action needed"
          detail={`We're configuring this vehicle's telemetry stream with Tesla. ${state.ageLabel}.`}
        />
      );
    case "pending-pairing":
      return (
        <StatePanel
          tone="brand"
          title="Pair the virtual key to finish telemetry setup"
          detail={`Open the Tesla app → Locks → pair the virtual key for this vehicle to start streaming. ${state.ageLabel}.`}
          action={manageLink}
        />
      );
    case "error":
      return (
        <StatePanel
          tone="danger"
          title="Telemetry setup failed"
          detail={`Reconnect Tesla to retry configuring this vehicle. ${state.ageLabel}.`}
          action={manageLink}
        />
      );
    case "limit-reached":
      return (
        <StatePanel
          title="Telemetry contended — another app holds this vehicle's telemetry slots"
          detail="Remove the competing app's telemetry configuration in the Tesla ecosystem, or continue with manual trip records for now."
        />
      );
    case "unsupported-firmware":
      return (
        <StatePanel
          title="Telemetry isn't supported on this vehicle's firmware"
          detail="Update the car to at least firmware 2023.20.6 to enable live telemetry. Trip records stay manual until then."
        />
      );
  }
}
