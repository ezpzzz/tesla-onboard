/**
 * Inline-SVG chart primitives for /owner. No chart library — small, static,
 * single-series visuals that read fine at phone width. Tokens-only color
 * (brand for magnitude, danger for a policy miss), direct labels instead of
 * legends (there's only ever one series), no gradients/shadows/animation.
 * Every svg carries role="img" + aria-label so a screen reader gets the
 * headline even though the detail lives in the adjacent table/list.
 */

import type { ChargingSession, Trip } from "@/lib/owner/types";

/* ── MiniBarChart ──────────────────────────────────────────────────────── */

export function MiniBarChart({
  data,
  formatValue,
  ariaLabel,
}: {
  data: { label: string; value: number }[];
  formatValue?: (n: number) => string;
  ariaLabel: string;
}) {
  const fmt = formatValue ?? ((n: number) => n.toLocaleString());
  const max = Math.max(1, ...data.map((d) => d.value));

  const rowH = 30;
  const labelW = 96;
  const barMaxW = 130;
  const valueW = 64;
  const width = labelW + barMaxW + valueW;
  const height = Math.max(rowH, data.length * rowH);

  if (data.length === 0) {
    return (
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${rowH}`} className="w-full">
        <text x={0} y={rowH / 2 + 4} className="fill-muted text-[11px]">
          No data yet
        </text>
      </svg>
    );
  }

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
    >
      {data.map((d, i) => {
        const y = i * rowH;
        const barW = (d.value / max) * barMaxW;
        return (
          <g key={d.label}>
            <text
              x={0}
              y={y + rowH / 2 + 4}
              className="fill-muted text-[11px] font-medium"
            >
              {d.label}
            </text>
            <rect
              x={labelW}
              y={y + rowH / 2 - 6}
              width={barMaxW}
              height={12}
              rx={6}
              className="fill-line"
            />
            <rect
              x={labelW}
              y={y + rowH / 2 - 6}
              width={Math.max(2, barW)}
              height={12}
              rx={6}
              className="fill-brand"
            />
            <text
              x={labelW + barMaxW + 10}
              y={y + rowH / 2 + 4}
              className="fill-ink text-[11px] font-semibold"
            >
              {fmt(d.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── MiniLineChart ─────────────────────────────────────────────────────── */

/** Single-series time line (e.g. battery % over the last 7 days, Phase 5
 * health charts). Same restraint as MiniBarChart: tokens-only color, a
 * direct start/end value label instead of axis ticks or a legend, no
 * gradients/shadows/animation. Callers own the aria-label sentence. */
export function MiniLineChart({
  points,
  ariaLabel,
  yMin = 0,
  yMax = 100,
  formatValue,
}: {
  points: { atMs: number; value: number }[];
  ariaLabel: string;
  yMin?: number;
  yMax?: number;
  formatValue?: (n: number) => string;
}) {
  const fmt = formatValue ?? ((n: number) => `${Math.round(n)}%`);
  const width = 280;
  const height = 90;
  const padTop = 10;
  const padBottom = 20;
  const plotH = height - padTop - padBottom;

  if (points.length === 0) {
    return (
      <svg role="img" aria-label={ariaLabel} viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        <text x={0} y={height / 2} className="fill-muted text-[11px]">
          No data yet
        </text>
      </svg>
    );
  }

  const minAt = points[0].atMs;
  const maxAt = points[points.length - 1].atMs;
  const spanMs = Math.max(1, maxAt - minAt);
  const x = (atMs: number) => ((atMs - minAt) / spanMs) * width;
  const y = (value: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, value));
    return padTop + (1 - (clamped - yMin) / (yMax - yMin)) * plotH;
  };

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.atMs).toFixed(1)} ${y(p.value).toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1];
  const first = points[0];

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
    >
      <path d={path} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="stroke-brand" />
      <circle cx={x(last.atMs)} cy={y(last.value)} r={3} className="fill-brand" />
      <text x={0} y={height - 4} className="fill-muted text-[10px]">
        {fmt(first.value)}
      </text>
      <text x={width} y={height - 4} textAnchor="end" className="fill-ink text-[10px] font-semibold">
        {fmt(last.value)}
      </text>
    </svg>
  );
}

/* ── BatteryReturnGauge ────────────────────────────────────────────────── */

export function BatteryReturnGauge({
  startPct,
  endPct,
  policyPct,
  ariaLabel,
}: {
  startPct: number | null;
  endPct: number | null;
  policyPct: number;
  ariaLabel: string;
}) {
  const width = 260;
  const trackY = 16;
  const trackH = 14;
  const belowPolicy = endPct !== null && endPct < policyPct;
  const x = (pct: number) => (Math.max(0, Math.min(100, pct)) / 100) * width;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} 48`}
      className="w-full"
      style={{ height: 48 }}
    >
      <rect x={0} y={trackY} width={width} height={trackH} rx={7} className="fill-line" />
      {endPct !== null && (
        <rect
          x={0}
          y={trackY}
          width={Math.max(2, x(endPct))}
          height={trackH}
          rx={7}
          className={belowPolicy ? "fill-danger" : "fill-brand"}
        />
      )}
      {/* policy threshold tick */}
      <line
        x1={x(policyPct)}
        y1={trackY - 4}
        x2={x(policyPct)}
        y2={trackY + trackH + 4}
        strokeWidth={2}
        strokeDasharray="2 2"
        className="stroke-ink-soft"
      />
      {startPct !== null && (
        <line
          x1={x(startPct)}
          y1={trackY - 4}
          x2={x(startPct)}
          y2={trackY + trackH + 4}
          strokeWidth={2}
          className="stroke-muted"
        />
      )}
      <text x={0} y={46} className="fill-muted text-[10px]">
        {startPct !== null ? `${Math.round(startPct)}% at pickup` : "Not started"}
      </text>
      <text
        x={width}
        y={46}
        textAnchor="end"
        className={
          belowPolicy
            ? "fill-danger text-[10px] font-semibold"
            : "fill-ink text-[10px] font-semibold"
        }
      >
        {endPct !== null
          ? `${Math.round(endPct)}% at return${
              belowPolicy ? ` (policy ${Math.round(policyPct)}%)` : ""
            }`
          : "In progress"}
      </text>
    </svg>
  );
}

/* ── TripTimeline ──────────────────────────────────────────────────────── */

// Simplified IconBolt path, drawn small at each charging-session marker.
const BOLT_D = "M13 2 4.5 13.5H11l-1 8.5L19.5 10H13z";

export function TripTimeline({
  trip,
  sessions,
  ariaLabel,
}: {
  trip: Trip;
  sessions: ChargingSession[];
  ariaLabel: string;
}) {
  const width = 280;
  const axisY = 28;
  const span = Math.max(1, trip.endAt - trip.startAt);
  const x = (ms: number) => {
    const t = (ms - trip.startAt) / span;
    return Math.max(0, Math.min(width, t * width));
  };

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${width} 56`}
      className="w-full"
      style={{ height: 56 }}
    >
      <line x1={0} y1={axisY} x2={width} y2={axisY} strokeWidth={2} className="stroke-line" />

      <circle cx={0} cy={axisY} r={5} className="fill-brand" />
      <text x={0} y={axisY + 20} className="fill-muted text-[10px]">
        Pickup
      </text>

      {sessions.map((s) => {
        const cx = x(s.startedAt);
        return (
          <g key={s.id} transform={`translate(${cx - 6}, ${axisY - 14}) scale(0.5)`}>
            <path d={BOLT_D} className="fill-brand" />
          </g>
        );
      })}

      {trip.status === "completed" && (
        <>
          <circle cx={width} cy={axisY} r={5} className="fill-ink" />
          <text x={width} y={axisY + 20} textAnchor="end" className="fill-muted text-[10px]">
            Return
          </text>
        </>
      )}
    </svg>
  );
}
