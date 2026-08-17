"use client";

/**
 * Presentational building blocks for /owner pages: stat tiles, status pills,
 * the alerts panel, the driver/trip tables (one row-model, two renderings —
 * a semantic <table> on md+ and stacked Cards below it), the charging session
 * list, and the per-trip return checklist. Pages compose these; none of them
 * fetch data themselves except ReturnChecklistCard, which owns its own
 * localStorage-backed state via useOwnerState().
 */

import Link from "next/link";
import type { ReactNode } from "react";
import type {
  ChargingSession,
  Driver,
  DriverStatus,
  OwnerAlert,
  Trip,
  TripStatus,
  Vehicle,
} from "@/lib/owner/types";
import {
  emptyTripChecklist,
  useOwnerState,
  type OwnerState,
  type TripChecklistState,
} from "@/lib/owner/owner-state";
import {
  driverStatus,
  formatPct,
  formatUsd,
  ownerChecklistScore,
  resolveVehiclePolicyPct,
  sessionsForTrip,
  tripEnergy,
  tripMiles,
} from "@/lib/owner/derive";
import { Badge, Card, ProgressBar, cn } from "../ui";
import { IconBolt, IconCheck, IconChevronRight } from "../icons";
import { ReminderButton } from "./ReminderButton";

/* ── Date/time formatting ──────────────────────────────────────────────────
 * UTC-only on purpose: the mock fixtures are fixed epoch-ms literals, and
 * this app server-renders client components on first paint. Using UTC parts
 * (instead of toLocaleDateString / local getters) means the server and the
 * browser always agree, regardless of either one's timezone — no hydration
 * mismatch. */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function formatDateRange(startMs: number, endMs: number): string {
  return `${formatDate(startMs)} – ${formatDate(endMs)}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${h12}:${String(m).padStart(2, "0")} ${ampm} UTC`;
}

/* ── StatTile ──────────────────────────────────────────────────────────── */

export function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">
        {value}
      </div>
      {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
    </Card>
  );
}

/* ── Status pills / badges ────────────────────────────────────────────────*/

const driverStatusMeta: Record<
  DriverStatus,
  { label: string; tone: "good" | "brand" | "neutral" | "warn" }
> = {
  ready: { label: "Ready", tone: "good" },
  "in-progress": { label: "In progress", tone: "brand" },
  "not-started": { label: "Not started", tone: "neutral" },
  stalled: { label: "Stalled", tone: "warn" },
};

export function StatusPill({ status }: { status: DriverStatus }) {
  const meta = driverStatusMeta[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const tripStatusMeta: Record<
  TripStatus,
  { label: string; tone: "good" | "brand" | "neutral" }
> = {
  completed: { label: "Completed", tone: "good" },
  active: { label: "Active", tone: "brand" },
  upcoming: { label: "Upcoming", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function TripStatusBadge({ status }: { status: TripStatus }) {
  const meta = tripStatusMeta[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/* ── Vehicle chip ──────────────────────────────────────────────────────────
 * A small linked label used anywhere a row needs to name its vehicle (trip
 * rows, trip detail headers). Renders plain text — no link — when the
 * vehicle can't be resolved, and flags removed vehicles inline so a host
 * scanning a trip list isn't surprised by a vehicle that's no longer active. */

export function VehicleChip({ vehicle }: { vehicle: Vehicle | null }) {
  if (!vehicle) {
    return <span className="text-muted">Unknown vehicle</span>;
  }
  return (
    <Link
      href={`/owner/vehicles/${vehicle.id}`}
      className="inline-flex min-h-[28px] items-center gap-1.5 text-ink-soft hover:text-brand"
    >
      <span className="truncate">{vehicle.displayName}</span>
      {vehicle.status === "archived" && <Badge tone="neutral">Removed</Badge>}
    </Link>
  );
}

/* ── Empty state ───────────────────────────────────────────────────────── */

export function EmptyState({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card className="p-6 text-center">
      <div className="text-[15px] font-medium text-ink">{title}</div>
      {detail && (
        <div className="mt-1.5 text-sm leading-relaxed text-muted">{detail}</div>
      )}
      {children && <div className="mt-4">{children}</div>}
    </Card>
  );
}

/* ── Alerts panel ──────────────────────────────────────────────────────── */

const alertSeverityMeta = {
  warn: "border-l-warn",
  danger: "border-l-danger",
} as const;

const alertDotMeta = {
  warn: "bg-warn",
  danger: "bg-danger",
} as const;

export function AlertsPanel({ alerts }: { alerts: OwnerAlert[] }) {
  if (alerts.length === 0) {
    return <EmptyState title="All clear — nothing needs you right now." />;
  }
  return (
    <ul className="space-y-2">
      {alerts.map((a) => (
        <li key={a.id}>
          <Link
            href={a.href}
            className={cn(
      "flex min-h-[44px] items-center gap-3 rounded-md border border-line border-l-4 bg-white p-3.5 transition-colors hover:bg-surface",
              alertSeverityMeta[a.severity],
            )}
          >
            <span
              aria-hidden="true"
              className={cn("h-2 w-2 shrink-0 rounded-full", alertDotMeta[a.severity])}
            />
            <span className="min-w-0 flex-1 text-[14px] leading-snug text-ink-soft">
              {a.message}
            </span>
            <IconChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ── Driver table ──────────────────────────────────────────────────────────
 * One row-model (`buildDriverRows`) feeds both renderings so the two never
 * drift apart. The driver name is the real navigational <Link> (a <tr> can't
 * itself be an anchor); the linked-trip chip is a second, non-nested <Link>
 * in its own cell. */

interface DriverRow {
  driver: Driver;
  status: DriverStatus;
  experienceLabel: string;
  pct: number;
  modulesLabel: string;
  requiredLabel: string;
  linkedTrip: Trip | null;
}

function experienceLabelFor(driver: Driver): string {
  switch (driver.progress?.experience) {
    case "owner":
      return "Tesla owner";
    case "account":
      return "Tesla account";
    case "new":
      return "New to Tesla";
    default:
      return "Not connected";
  }
}

function buildDriverRows(drivers: Driver[], trips: Trip[], now: number): DriverRow[] {
  return drivers.map((driver) => {
    const p = driver.progress;
    const linkedTrip =
      trips.find((t) => t.driverId === driver.id && t.status !== "completed" && t.status !== "cancelled") ??
      trips.find((t) => t.driverId === driver.id) ??
      null;
    return {
      driver,
      status: driverStatus(driver, now),
      experienceLabel: experienceLabelFor(driver),
      pct: p?.pct ?? 0,
      modulesLabel: p ? `${p.completed.length}/${p.moduleTotal}` : "—",
      requiredLabel: p ? `${p.requiredChecklistDone}/${p.requiredChecklistTotal}` : "—",
      linkedTrip,
    };
  });
}

export function DriverTable({
  drivers,
  trips,
  now,
}: {
  drivers: Driver[];
  trips: Trip[];
  now: number;
}) {
  const rows = buildDriverRows(drivers, trips, now);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No guests yet."
        detail="Guests show up here once a trip is booked or a private trip link is opened."
      />
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-line bg-white md:block">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
              <th scope="col" className="px-4 py-3 font-medium">Guest</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Experience</th>
              <th scope="col" className="px-4 py-3 font-medium">Progress</th>
              <th scope="col" className="px-4 py-3 font-medium">Modules</th>
              <th scope="col" className="px-4 py-3 font-medium">Required checklist</th>
              <th scope="col" className="px-4 py-3 font-medium">Trip</th>
              <th scope="col" className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.driver.id}
                className="border-b border-line last:border-0 hover:bg-surface"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/owner/drivers/${encodeURIComponent(row.driver.id)}`}
                    className="inline-flex min-h-[28px] items-center gap-2 font-medium text-ink hover:text-brand"
                  >
                    {row.driver.name || "Unnamed guest"}
                  </Link>
                  {row.driver.source === "guest-local" && (
                    <span className="ml-2 inline-block align-middle">
                      <Badge tone="brand">This browser&apos;s guest</Badge>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={row.status} />
                </td>
                <td className="px-4 py-3 text-ink-soft">{row.experienceLabel}</td>
                <td className="px-4 py-3">
                  <div className="w-32">
                    <ProgressBar value={row.pct} />
                  </div>
                </td>
                <td className="px-4 py-3 text-ink-soft">{row.modulesLabel}</td>
                <td className="px-4 py-3 text-ink-soft">{row.requiredLabel}</td>
                <td className="px-4 py-3">
                  {row.linkedTrip ? (
                    <Link
                      href={`/owner/trips/${row.linkedTrip.id}`}
                      className="inline-flex min-h-[28px] items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-ink-soft hover:text-ink"
                    >
                      <TripStatusBadge status={row.linkedTrip.status} />
                      {formatDate(row.linkedTrip.startAt)}
                    </Link>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {row.linkedTrip && row.linkedTrip.status !== "completed" && row.linkedTrip.status !== "cancelled" && !row.driver.progress?.isDone ? (
                    <ReminderButton tripId={row.linkedTrip.id} />
                  ) : <span className="text-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2.5 md:hidden">
        {rows.map((row) => (
          <div
            key={row.driver.id}
            className="rounded-lg border border-line bg-white p-4"
          >
            <Link href={`/owner/drivers/${encodeURIComponent(row.driver.id)}`} className="block">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-ink">
                  {row.driver.name || "Unnamed guest"}
                </span>
                <StatusPill status={row.status} />
              </div>
              {row.driver.source === "guest-local" && (
                <div className="mt-1.5">
                  <Badge tone="brand">This browser&apos;s guest</Badge>
                </div>
              )}
              <div className="mt-3">
                <ProgressBar value={row.pct} label={row.experienceLabel} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span>{row.modulesLabel} modules</span>
                <span>{row.requiredLabel} required</span>
                {row.linkedTrip && (
                  <span className="inline-flex items-center gap-1.5">
                    <TripStatusBadge status={row.linkedTrip.status} />
                    {formatDate(row.linkedTrip.startAt)}
                  </span>
                )}
              </div>
            </Link>
            {row.linkedTrip && row.linkedTrip.status !== "completed" && row.linkedTrip.status !== "cancelled" && !row.driver.progress?.isDone ? <ReminderButton tripId={row.linkedTrip.id} className="mt-4" fullWidth /> : null}
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Trip table ────────────────────────────────────────────────────────── */

interface TripRowModel {
  trip: Trip;
  driver: Driver | null;
  vehicle: Vehicle | null;
  miles: number | null;
  energyCostUsd: number;
  batteryEndPct: number | null;
  belowPolicy: boolean;
  checklist: { done: number; total: number };
}

function buildTripRows(
  trips: Trip[],
  drivers: Driver[],
  vehicles: Vehicle[],
  sessions: ChargingSession[],
  ownerState: OwnerState,
  policyPct: number,
): TripRowModel[] {
  return trips.map((trip) => {
    const driver = drivers.find((d) => d.id === trip.driverId) ?? null;
    const vehicle = vehicles.find((v) => v.id === trip.vehicleId) ?? null;
    const energy = tripEnergy(sessionsForTrip(sessions, trip.id));
    const effectivePolicyPct = resolveVehiclePolicyPct(vehicle, policyPct);
    const belowPolicy = trip.batteryEndPct !== null && trip.batteryEndPct < effectivePolicyPct;
    return {
      trip,
      driver,
      vehicle,
      miles: tripMiles(trip),
      energyCostUsd: energy.costUsd,
      batteryEndPct: trip.batteryEndPct,
      belowPolicy,
      checklist: ownerChecklistScore(ownerState, trip.id),
    };
  });
}

function BatteryChip({ row }: { row: TripRowModel }) {
  if (row.batteryEndPct === null) return <span className="text-muted">—</span>;
  return (
    <Badge tone={row.belowPolicy ? "danger" : "good"}>
      {formatPct(row.batteryEndPct)}
      {row.belowPolicy ? " below policy" : ""}
    </Badge>
  );
}

export function TripTable({
  trips,
  drivers,
  vehicles,
  chargingSessions,
  ownerState,
  policyPct,
}: {
  trips: Trip[];
  drivers: Driver[];
  vehicles: Vehicle[];
  chargingSessions: ChargingSession[];
  ownerState: OwnerState;
  policyPct: number;
}) {
  const rows = buildTripRows(trips, drivers, vehicles, chargingSessions, ownerState, policyPct);

  if (rows.length === 0) {
    return <EmptyState title="No trips yet." />;
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-line bg-white md:block">
        <table className="w-full min-w-[860px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
              <th scope="col" className="px-4 py-3 font-medium">Dates</th>
              <th scope="col" className="px-4 py-3 font-medium">Guest</th>
              <th scope="col" className="px-4 py-3 font-medium">Vehicle</th>
              <th scope="col" className="px-4 py-3 font-medium">Status</th>
              <th scope="col" className="px-4 py-3 font-medium">Miles</th>
              <th scope="col" className="px-4 py-3 font-medium">Energy cost</th>
              <th scope="col" className="px-4 py-3 font-medium">Return charge</th>
              <th scope="col" className="px-4 py-3 font-medium">Checklist</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.trip.id}
                className="border-b border-line last:border-0 hover:bg-surface"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/owner/trips/${row.trip.id}`}
                    className="inline-flex min-h-[28px] items-center font-medium text-ink hover:text-brand"
                  >
                    {formatDateRange(row.trip.startAt, row.trip.endAt)}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-soft">
                  {row.driver ? (
                    <Link
                      href={`/owner/drivers/${row.driver.id}`}
                      className="hover:text-brand"
                    >
                      {row.driver.name || "Unnamed guest"}
                    </Link>
                  ) : (
                    <span className="text-muted">Unassigned</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <VehicleChip vehicle={row.vehicle} />
                </td>
                <td className="px-4 py-3">
                  <TripStatusBadge status={row.trip.status} />
                </td>
                <td className="px-4 py-3 text-ink-soft">
                  {row.miles === null ? "—" : `${Math.round(row.miles)} mi`}
                </td>
                <td className="px-4 py-3 text-ink-soft">{formatUsd(row.energyCostUsd)}</td>
                <td className="px-4 py-3">
                  <BatteryChip row={row} />
                </td>
                <td className="px-4 py-3 text-ink-soft">
                  {row.checklist.done}/{row.checklist.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2.5 md:hidden">
        {rows.map((row) => (
          <Link key={row.trip.id} href={`/owner/trips/${row.trip.id}`} className="block">
            <Card className="p-4 transition-colors hover:bg-surface">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink">
                  {formatDateRange(row.trip.startAt, row.trip.endAt)}
                </span>
                <TripStatusBadge status={row.trip.status} />
              </div>
              <div className="mt-1.5 text-sm text-muted">
                {row.driver ? row.driver.name || "Unnamed guest" : "Unassigned"}
              </div>
              {/* Plain text, not <VehicleChip> — this card is already one big
                  <Link> to the trip, and nesting an anchor inside an anchor
                  is invalid HTML (see DriverTable's linkedTrip chip above). */}
              <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
                <span className="truncate">
                  {row.vehicle ? row.vehicle.displayName : "Unknown vehicle"}
                </span>
                {row.vehicle?.status === "archived" && <Badge tone="neutral">Removed</Badge>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
                <span>{row.miles === null ? "—" : `${Math.round(row.miles)} mi`}</span>
                <span>{formatUsd(row.energyCostUsd)}</span>
                <BatteryChip row={row} />
                <span>
                  {row.checklist.done}/{row.checklist.total} checklist
                </span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

/* ── Charging session list ────────────────────────────────────────────── */

export function ChargingSessionList({ sessions }: { sessions: ChargingSession[] }) {
  if (sessions.length === 0) {
    return <EmptyState title="No charging sessions on this trip." />;
  }
  return (
    <ul className="space-y-2">
      {sessions.map((s) => (
        <li
          key={s.id}
          className="flex items-center gap-3 rounded-md border border-line bg-white p-3.5"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[14px] font-medium text-ink">{s.location}</span>
              {s.isSupercharger && (
                <Badge tone="brand">
                  <IconBolt aria-hidden="true" className="h-3 w-3" /> Supercharger
                </Badge>
              )}
            </span>
            <span className="mt-0.5 block text-xs text-muted">
              {formatTime(s.startedAt)} – {formatTime(s.endedAt)}
            </span>
          </span>
          <span className="shrink-0 text-right text-sm">
            <span className="block font-medium text-ink">{s.kWhAdded.toFixed(1)} kWh</span>
            <span className="block text-xs text-muted">{formatUsd(s.costUsd)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ── Return checklist card ────────────────────────────────────────────── */

type ChecklistToggleKey = "chargedToPolicy" | "keysReturned" | "cleaned" | "noDamage";

const CHECKLIST_ROWS: { key: ChecklistToggleKey; label: string }[] = [
  { key: "chargedToPolicy", label: "Charged to policy" },
  { key: "keysReturned", label: "Keys returned" },
  { key: "cleaned", label: "Cleaned" },
  { key: "noDamage", label: "No damage" },
];

export function ReturnChecklistCard({ tripId }: { tripId: string }) {
  const { state, update } = useOwnerState();
  const checklist: TripChecklistState = state.tripChecklists[tripId] ?? emptyTripChecklist();

  function toggle(key: ChecklistToggleKey) {
    update((s) => {
      const current = s.tripChecklists[tripId] ?? emptyTripChecklist();
      return {
        tripChecklists: {
          ...s.tripChecklists,
          [tripId]: { ...current, [key]: !current[key], updatedAt: Date.now() },
        },
      };
    });
  }

  function setNotes(notes: string) {
    update((s) => {
      const current = s.tripChecklists[tripId] ?? emptyTripChecklist();
      return {
        tripChecklists: {
          ...s.tripChecklists,
          [tripId]: { ...current, notes, updatedAt: Date.now() },
        },
      };
    });
  }

  return (
    <Card className="p-4">
      <div className="text-[13px] font-semibold uppercase tracking-wide text-muted">
        Return checklist
      </div>
      <div className="mt-3 space-y-2">
        {CHECKLIST_ROWS.map((row) => {
          const checked = checklist[row.key];
          return (
            <button
              key={row.key}
              type="button"
              role="switch"
              aria-checked={checked}
              onClick={() => toggle(row.key)}
              className={cn(
                "flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md border px-4 py-3 text-left text-[15px] font-medium transition-colors",
                checked
                  ? "border-good/30 bg-good/5 text-ink"
                  : "border-line bg-white text-ink-soft hover:bg-surface",
              )}
            >
              {row.label}
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  checked ? "border-good bg-good text-white" : "border-line text-transparent",
                )}
              >
                <IconCheck aria-hidden="true" className="h-3.5 w-3.5" />
              </span>
            </button>
          );
        })}
      </div>
      <label className="mt-4 block" htmlFor={`return-checklist-notes-${tripId}`}>
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Notes</span>
        <textarea
          id={`return-checklist-notes-${tripId}`}
          name="returnChecklistNotes"
          value={checklist.notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything the next host should know…"
          className="mt-1.5 w-full resize-none rounded-md border border-line bg-white px-3.5 py-3 text-[14px] text-ink placeholder:text-muted"
        />
      </label>
    </Card>
  );
}
