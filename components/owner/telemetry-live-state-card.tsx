"use client";

/**
 * Live vehicle state card (Phase 5) — per-field freshness, replacing the
 * single "latest signal" caption the pre-telemetry page used. Each field
 * keeps its own observed-at; a newer lock or connectivity signal never
 * refreshes older battery/range/odometer data, and every field renders its
 * own age so staleness is never hidden.
 */

import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { StatePanel } from "@/components/evhost-ui";
import { StatTile } from "@/components/owner/owner-ui";
import type { VehicleStatsCurrent } from "@/lib/owner/access-types";
import { freshnessAgeLabel, liveFieldFreshness, liveStateEmptyCopy, type TelemetryEnrollmentRow } from "./telemetry-view";

function FieldFreshness({ observedAtMs, nowMs }: { observedAtMs: number | null; nowMs: number }) {
  const state = liveFieldFreshness(observedAtMs, nowMs);
  if (state === "absent") {
    return <span className="mt-1 block text-[11px] text-muted">Not captured yet</span>;
  }
  const age = freshnessAgeLabel(observedAtMs as number, nowMs);
  return (
    <span className={`mt-1 block text-[11px] ${state === "stale" ? "font-medium text-warn" : "text-muted"}`}>
      {state === "stale" ? `Stale — ${age}` : age}
    </span>
  );
}

const connectivityTone: Record<VehicleStatsCurrent["connectivity"], "good" | "warn" | "neutral"> = {
  connected: "good",
  stale: "warn",
  disconnected: "neutral",
  unsupported: "neutral",
};

export function TelemetryLiveStateCard({
  live,
  nowMs,
  enrollment,
}: {
  live: VehicleStatsCurrent | undefined;
  nowMs: number;
  /** Additive, safe default of `undefined` (renders the original
   * automatic-capture copy) -- see liveStateEmptyCopy in telemetry-view.ts.
   * Passed by the vehicle detail page from the same fetch that drives
   * TelemetryStatusStrip above, so the two panels can never disagree. */
  enrollment?: TelemetryEnrollmentRow | null;
}) {
  if (!live || live.observedAt === null) {
    const copy = liveStateEmptyCopy(enrollment);
    return (
      <StatePanel
        title={copy.title}
        detail={copy.detail}
        action={
          <Link href="/owner/integrations" className="text-sm font-medium text-brand hover:underline">
            Manage Tesla connection
          </Link>
        }
      />
    );
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">Live vehicle state</div>
        <Badge tone={connectivityTone[live.connectivity]}>{live.connectivity}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Battery"
          value={live.batteryPct === null ? "—" : `${Math.round(live.batteryPct)}%`}
          sub={<FieldFreshness observedAtMs={live.fieldObservedAt.battery} nowMs={nowMs} />}
        />
        <StatTile
          label="Estimated range"
          value={live.estimatedRangeMi === null ? "—" : `${Math.round(live.estimatedRangeMi)} mi`}
          sub={<FieldFreshness observedAtMs={live.fieldObservedAt.range} nowMs={nowMs} />}
        />
        <StatTile
          label="Odometer"
          value={live.odometerMi === null ? "—" : `${Math.round(live.odometerMi).toLocaleString()} mi`}
          sub={<FieldFreshness observedAtMs={live.fieldObservedAt.odometer} nowMs={nowMs} />}
        />
        <StatTile
          label="Security"
          value={live.locked === null ? "—" : live.locked ? "Locked" : "Unlocked"}
          sub={<FieldFreshness observedAtMs={live.fieldObservedAt.locked} nowMs={nowMs} />}
        />
      </div>
      {live.chargingState ? (
        <p className="mt-3 text-xs text-muted">{live.chargingState.replace(/^DetailedChargeState/, "Charge: ")}.</p>
      ) : null}
    </Card>
  );
}
