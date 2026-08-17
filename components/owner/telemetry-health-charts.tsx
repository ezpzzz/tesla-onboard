"use client";

/**
 * Vehicle health charts (Phase 5) — battery over the last 7 days (line) and
 * charging over the last 30 days (bars). Both extend components/owner/
 * charts.tsx's inline-SVG conventions; no chart library. The charging bars
 * are honestly empty in this build: onlyevs_vehicle_stats_history has no
 * charge-energy field, and lib/owner has no client-exposed read for the
 * Phase 3 derived/reconciled charge sessions yet (that repository function
 * would live in lib/owner/, outside this lane's file ownership) — so this
 * component buckets the legacy per-trip ChargingSession list, which is
 * always empty in workspace mode today (see lib/owner/data-source.ts). That
 * renders MiniBarChart's own built-in "No data yet" state, which is the
 * honest outcome rather than a fabricated bar.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { EmptyState } from "@/components/owner/owner-ui";
import { MiniBarChart, MiniLineChart } from "@/components/owner/charts";
import { fetchVehicleStatsHistoryBuckets } from "@/lib/owner/history-repository";
import type { VehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import type { VehicleStatsHistoryBucket } from "@/lib/owner/access-types";
import type { ChargingSession } from "@/lib/owner/types";
import {
  batteryHistoryPoints,
  batteryRangeAriaLabel,
  bucketChargingSessionsByDay,
  chargingBarsAriaLabel,
} from "./telemetry-view";

const DAY_MS = 24 * 60 * 60 * 1_000;

type HistoryState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; buckets: VehicleStatsHistoryBucket[] };

function useHistoryBuckets(
  scope: VehicleWorkspaceScope | null,
  vehicleId: string,
  reloadKey: number,
): HistoryState {
  const [state, setState] = useState<HistoryState>({ kind: "loading" });
  useEffect(() => {
    if (!scope) {
      setState({ kind: "ready", buckets: [] });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    const now = Date.now();
    fetchVehicleStatsHistoryBuckets(scope, vehicleId, now - 30 * DAY_MS, now)
      .then((series) => {
        if (!cancelled) setState({ kind: "ready", buckets: series.buckets });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scope.key is
    // the stable identity; see telemetry-status-strip.tsx for why.
  }, [scope?.key, vehicleId, reloadKey]);
  return state;
}

export function TelemetryHealthCharts({
  scope,
  vehicleId,
  chargingSessions,
}: {
  scope: VehicleWorkspaceScope | null;
  vehicleId: string;
  chargingSessions: ChargingSession[];
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const state = useHistoryBuckets(scope, vehicleId, reloadKey);
  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // Loading shim reserves the final rendered height (design review Issue 2).
  if (state.kind === "loading") {
    return <div className="h-[280px] animate-pulse rounded-lg border border-line bg-surface" aria-hidden="true" />;
  }

  if (state.kind === "error") {
    return (
      <EmptyState title="Data unavailable" detail="Vehicle health charts couldn't be loaded.">
        <button type="button" onClick={retry} className="text-sm font-medium text-brand hover:underline">
          Retry
        </button>
      </EmptyState>
    );
  }

  if (state.buckets.length === 0) {
    return <EmptyState title="Charts appear after 24h of telemetry." />;
  }

  const now = Date.now();
  const batteryPoints = batteryHistoryPoints(state.buckets, now - 7 * DAY_MS);
  const chargingBars = bucketChargingSessionsByDay(chargingSessions, now - 30 * DAY_MS, now);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">Battery — last 7 days</div>
        <div className="mt-3">
          <MiniLineChart points={batteryPoints} ariaLabel={batteryRangeAriaLabel(batteryPoints)} />
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">Charging — last 30 days</div>
        <div className="mt-3">
          <MiniBarChart
            data={chargingBars}
            formatValue={(n) => `${n.toFixed(1)} kWh`}
            ariaLabel={chargingBarsAriaLabel(chargingBars)}
          />
        </div>
      </Card>
    </div>
  );
}
