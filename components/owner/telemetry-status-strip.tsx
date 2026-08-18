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
 * manual-era rather than a broken strip). Exported so the vehicle detail
 * page can fetch this once and hand the same row to both this strip and
 * TelemetryLiveStateCard -- one fetch, one source of truth, so the two
 * panels can never disagree about what the enrollment says. */
export function useTelemetryEnrollment(
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

export interface TelemetryErrorStripCopy {
  title: string;
  detail: string;
}

/**
 * Copy for the strip's "error" state. `last_error_code ===
 * "telemetry_proxy_not_configured"` means this deployment's telemetry proxy
 * was never set up -- distinct from a Tesla-side setup failure the owner can
 * retry by reconnecting. That case gets its own honest copy naming the real
 * cause (operator setup, not a vehicle/owner action) and never implies the
 * worker will pick it up and start streaming on its own. Any other error
 * code keeps the original reconnect-and-retry copy unchanged.
 */
export function telemetryErrorStripCopy(lastErrorCode: string | null): TelemetryErrorStripCopy {
  if (lastErrorCode === "telemetry_proxy_not_configured") {
    return {
      title: "Telemetry service isn't configured for this deployment",
      detail: "This deployment's telemetry service needs operator setup before it can stream data. It will not start until an operator finishes that setup -- reconnecting Tesla will not fix this.",
    };
  }
  return {
    title: "Telemetry setup failed",
    detail: "Reconnect Tesla to retry configuring this vehicle.",
  };
}

/**
 * Appends an age clause (e.g. "enrolled 5m ago") as its own capitalized
 * sentence rather than a lowercase fragment glued on after a full stop --
 * the strip's age labels read as lowercase clauses (see enrolledAgeLabel in
 * telemetry-view.ts), which only reads correctly mid-sentence. Every state
 * below that appends an age composes through this one function so the fix
 * lives in one place instead of three matching string templates.
 */
export function composeStripDetail(sentence: string, ageLabel: string): string {
  const capitalized = ageLabel.length === 0 ? ageLabel : ageLabel.charAt(0).toUpperCase() + ageLabel.slice(1);
  return `${sentence} ${capitalized}.`;
}

export function telemetrySettingUpDetail(ageLabel: string): string {
  return composeStripDetail("We're configuring this vehicle's telemetry stream with Tesla.", ageLabel);
}

export function telemetryPendingPairingDetail(ageLabel: string): string {
  return composeStripDetail(
    "Open the Tesla app → Locks → pair the virtual key for this vehicle to start streaming.",
    ageLabel,
  );
}

export function telemetryErrorDetail(lastErrorCode: string | null, ageLabel: string): string {
  return composeStripDetail(telemetryErrorStripCopy(lastErrorCode).detail, ageLabel);
}

export function TelemetryStatusStrip({
  enrollment,
  hasLiveSignal,
}: {
  enrollment: TelemetryEnrollmentRow | null | undefined;
  hasLiveSignal: boolean;
}) {
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
          detail={telemetrySettingUpDetail(state.ageLabel)}
        />
      );
    case "pending-pairing":
      return (
        <StatePanel
          tone="brand"
          title="Pair the virtual key to finish telemetry setup"
          detail={telemetryPendingPairingDetail(state.ageLabel)}
          action={manageLink}
        />
      );
    case "error": {
      const notConfigured = enrollment?.lastErrorCode === "telemetry_proxy_not_configured";
      const copy = telemetryErrorStripCopy(enrollment?.lastErrorCode ?? null);
      return (
        <StatePanel
          tone="danger"
          title={copy.title}
          detail={telemetryErrorDetail(enrollment?.lastErrorCode ?? null, state.ageLabel)}
          // Reconnecting Tesla can't fix a deployment that never configured
          // its telemetry proxy -- don't dangle an action that won't help.
          action={notConfigured ? undefined : manageLink}
        />
      );
    }
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
