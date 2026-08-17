"use client";

/**
 * Evidence packet Inbox card (Phase 6, T9/T15) — additive insertion into the
 * owner Inbox surface (OwnerInbox.tsx wires in `<PacketEvidenceQueue />`).
 * Reads `public.onlyevs_trip_evidence_packets` directly, the same pattern
 * `InboxCandidateCard.tsx` uses for `onlyevs_email_candidates`: manager-role
 * RLS scopes the read, so this module doesn't need a dedicated repository
 * file to stay within this lane's file ownership.
 *
 * Payload shape note: this parses the *actual* runtime shape
 * `composeTripEvidencePacket` (services/onlyevs-worker/index.ts, worker
 * lane) writes — tripId/guestName/startsAt/endsAt/bookends.{start,end}/
 * milesDriven/batteryDeltaPct/odometerRegression/chargingSessionsDerived/
 * chargingSessions — which differs in shape from the aspirational
 * `EvidencePacketPayload` interface in lib/owner/types.ts (that type adds
 * milesAllowance/batteryPolicyPct/outOfAreaOccurrences fields the worker
 * doesn't populate yet, and an array-of-bookends shape rather than
 * start/end keys). Parsing here is defensive field-by-field (mirroring
 * `parseEmailCandidateFacts`'s `firstString` approach) precisely so an
 * absent/renamed field degrades to "not shown" rather than a crash, and so
 * this card doesn't need to block on that type being reconciled.
 *
 * Collapsed order (design review Issue 1, 1A — inherits InboxCandidateCard's
 * convention): status badge -> consequence-led title -> deltas-vs-policy
 * facts -> age -> actions ("View trip" · invoice-window countdown). At most
 * one desktop card expands at once, matching OwnerInbox's existing rule.
 *
 * Supersede model (G4): onlyevs_trip_evidence_packets is versioned
 * (`unique(trip_id, version)`; the current packet for a trip is always the
 * row with the highest version — see composeTripEvidencePacket's doc
 * comment in services/onlyevs-worker/index.ts). selectLatestPacketPerTrip
 * below picks the highest-version row per trip, and the card shows a
 * "Corrected" label whenever that row's version is greater than 1, so a
 * correction is visible without the queue ever showing two rows for the
 * same trip.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useOwnerTenant } from "./OwnerTenantProvider";
import { formatMiles, formatPct } from "@/lib/owner/derive";
import { Badge, Card } from "@/components/ui";
import { IconBattery } from "@/components/icons";
import { TURO_INVOICE_WINDOW_MS } from "@/lib/owner/telemetry-policy";

/**
 * Turo's invoice-eligibility window closes 72h after trip end. Centralized
 * in lib/owner/telemetry-policy.ts per the plan's cross-cutting
 * no-inline-threshold rule (Issue 2, 2A) — re-exported here so existing
 * imports of `TURO_INVOICE_WINDOW_MS` from this module keep working.
 */
export { TURO_INVOICE_WINDOW_MS };

export interface ParsedPacketBookend {
  odometerMi: number | null;
  odometerObservedAt: number | null;
  batteryPct: number | null;
  batteryObservedAt: number | null;
  stale: boolean;
}

export interface ParsedPacketChargeSession {
  kind: string | null;
  kWhAdded: number | null;
  gapAffected: boolean;
}

export interface ParsedEvidencePacket {
  tripId: string;
  guestName: string | null;
  startsAt: number | null;
  endsAt: number | null;
  bookendStart: ParsedPacketBookend | null;
  bookendEnd: ParsedPacketBookend | null;
  milesDriven: number | null;
  batteryDeltaPct: number | null;
  odometerRegression: boolean;
  chargingSessionsDerived: boolean;
  chargingSessions: ParsedPacketChargeSession[];
}

function toMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseBookend(raw: unknown): ParsedPacketBookend | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return {
    odometerMi: toNumberOrNull(row.odometerMi),
    odometerObservedAt: toMs(row.odometerObservedAt),
    batteryPct: toNumberOrNull(row.batteryPct),
    batteryObservedAt: toMs(row.batteryObservedAt),
    stale: row.stale === true,
  };
}

/** Defensive field-by-field parse of the packet payload jsonb — see the
 * module doc comment for why this doesn't trust lib/owner/types.ts's
 * EvidencePacketPayload shape verbatim. Never throws on an unexpected or
 * partial payload; every field independently degrades to null/false. */
export function parseEvidencePacketPayload(raw: unknown): ParsedEvidencePacket {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bookends = row.bookends && typeof row.bookends === "object" ? (row.bookends as Record<string, unknown>) : {};
  const sessions = Array.isArray(row.chargingSessions) ? row.chargingSessions : [];
  return {
    tripId: typeof row.tripId === "string" ? row.tripId : "",
    guestName: typeof row.guestName === "string" && row.guestName.trim() ? row.guestName : null,
    startsAt: toMs(row.startsAt),
    endsAt: toMs(row.endsAt),
    bookendStart: parseBookend(bookends.start),
    bookendEnd: parseBookend(bookends.end),
    milesDriven: toNumberOrNull(row.milesDriven),
    batteryDeltaPct: toNumberOrNull(row.batteryDeltaPct),
    odometerRegression: row.odometerRegression === true,
    chargingSessionsDerived: row.chargingSessionsDerived === true,
    chargingSessions: sessions.map((session) => {
      const s = session && typeof session === "object" ? (session as Record<string, unknown>) : {};
      return {
        kind: typeof s.kind === "string" ? s.kind : null,
        kWhAdded: toNumberOrNull(s.kWhAdded),
        gapAffected: s.gapAffected === true,
      };
    }),
  };
}

export interface PacketStatus {
  label: "Clean return" | "Needs attention";
  tone: "good" | "warn";
}

/**
 * Honest, evidence-only status: "Needs attention" whenever the record
 * itself says so — a missing bookend, an odometer regression (data error),
 * or a charging session whose kWh crossed a stream gap. Never claims a
 * miles-/battery-vs-policy verdict the payload doesn't carry (see the
 * module doc comment on the milesAllowance/batteryPolicyPct gap).
 */
export function derivePacketStatus(packet: ParsedEvidencePacket): PacketStatus {
  const needsAttention =
    packet.odometerRegression ||
    !packet.bookendStart ||
    !packet.bookendEnd ||
    packet.bookendStart.stale ||
    packet.bookendEnd.stale ||
    packet.chargingSessions.some((session) => session.gapAffected);
  return needsAttention ? { label: "Needs attention", tone: "warn" } : { label: "Clean return", tone: "good" };
}

/** Consequence-led title, e.g. "Clean return · 421 mi driven · 74% return
 * charge" — omits a fact entirely rather than rendering a placeholder dash
 * for something the packet never captured. */
export function derivePacketTitle(packet: ParsedEvidencePacket): string {
  const status = derivePacketStatus(packet);
  const parts: string[] = [status.label];
  if (packet.milesDriven !== null) parts.push(`${formatMiles(packet.milesDriven)} driven`);
  if (packet.bookendEnd?.batteryPct !== null && packet.bookendEnd?.batteryPct !== undefined) {
    parts.push(`${formatPct(packet.bookendEnd.batteryPct)} return charge`);
  }
  return parts.join(" · ");
}

export interface InvoiceCountdown {
  text: string;
  expired: boolean;
}

/** Time remaining in Turo's 72h post-trip invoice-eligibility window,
 * anchored to the trip's actual end time. Returns null when the packet
 * carries no endsAt at all (never fabricates a deadline). */
export function formatInvoiceWindowCountdown(endsAtMs: number | null, nowMs: number): InvoiceCountdown | null {
  if (endsAtMs === null) return null;
  const deadline = endsAtMs + TURO_INVOICE_WINDOW_MS;
  const remainingMs = deadline - nowMs;
  if (remainingMs <= 0) {
    const closedHoursAgo = Math.round(-remainingMs / (60 * 60 * 1_000));
    return { text: `Invoice window closed ${closedHoursAgo}h ago`, expired: true };
  }
  const remainingHours = Math.round(remainingMs / (60 * 60 * 1_000));
  return { text: `${remainingHours}h left to invoice`, expired: false };
}

function formatAge(composedAtMs: number, nowMs: number): string {
  const ms = Math.max(0, nowMs - composedAtMs);
  const hours = Math.floor(ms / (60 * 60 * 1_000));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export interface EvidencePacketRow {
  id: string;
  tripId: string;
  version: number;
  composedAt: number;
  payload: ParsedEvidencePacket;
}

/** The current packet for a trip is always the row with the highest
 * `version` (`unique(trip_id, version)` — a correction is a new row, never
 * a mutation). Keeps only that row per trip; earlier versions drop from the
 * active queue (their correction supersedes them, per `isSupersedingPacket`
 * below rendering a "Corrected" label on the row that replaced them). Ties
 * (should never occur given the DB constraint) break on composedAt. */
export function selectLatestPacketPerTrip(rows: EvidencePacketRow[]): EvidencePacketRow[] {
  const latestByTrip = new Map<string, EvidencePacketRow>();
  for (const row of rows) {
    const existing = latestByTrip.get(row.tripId);
    if (!existing || row.version > existing.version || (row.version === existing.version && row.composedAt > existing.composedAt)) {
      latestByTrip.set(row.tripId, row);
    }
  }
  return [...latestByTrip.values()].sort((a, b) => b.composedAt - a.composedAt);
}

/** True when this is a correction (version 2+) rather than a trip's first
 * packet — drives the collapsed card's "Corrected" label (G4). */
export function isSupersedingPacket(row: Pick<EvidencePacketRow, "version">): boolean {
  return row.version > 1;
}

interface PacketBrandingRow {
  id: string;
  trip_id: string;
  version: number;
  composed_at: string;
  payload: unknown;
}

export function PacketEvidenceQueue() {
  const { workspace } = useOwnerTenant();
  const [rows, setRows] = useState<EvidencePacketRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!workspace) { setLoaded(true); return; }
    (async () => {
      const { data } = await createClient()
        .from("onlyevs_trip_evidence_packets")
        .select("id,trip_id,version,composed_at,payload")
        .eq("workspace_id", workspace.id)
        .order("composed_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      const parsed = ((data ?? []) as PacketBrandingRow[]).map((row) => ({
        id: row.id,
        tripId: row.trip_id,
        version: row.version,
        composedAt: Date.parse(row.composed_at),
        payload: parseEvidencePacketPayload(row.payload),
      }));
      setRows(selectLatestPacketPerTrip(parsed));
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [workspace]);

  const now = Date.now();

  // Absent until the first packet arrives — no loading skeleton, no empty
  // state card (interaction-state table: "n/a (arrives ready)" / "absent
  // until first packet").
  if (!loaded || rows.length === 0) return null;

  return (
    <section aria-label="Trip evidence" className="space-y-3">
      <h2 className="text-lg font-semibold">Trip evidence</h2>
      <div className="space-y-3">
        {rows.map((row) => (
          <PacketEvidenceCard
            key={row.id}
            row={row}
            now={now}
            expanded={expandedId === row.id}
            onToggle={() => setExpandedId((current) => (current === row.id ? null : row.id))}
          />
        ))}
      </div>
    </section>
  );
}

function PacketEvidenceCard({
  row, now, expanded, onToggle,
}: {
  row: EvidencePacketRow;
  now: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const status = useMemo(() => derivePacketStatus(row.payload), [row.payload]);
  const title = useMemo(() => derivePacketTitle(row.payload), [row.payload]);
  const countdown = useMemo(() => formatInvoiceWindowCountdown(row.payload.endsAt, now), [row.payload, now]);

  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-h-20 w-full items-start gap-3 p-4 text-left sm:p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
          <IconBattery className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            {isSupersedingPacket(row) ? <Badge tone="brand">Corrected</Badge> : null}
            <strong className="line-clamp-2 text-sm sm:text-base">{title}</strong>
          </span>
          <span className="mt-1 block text-sm text-muted">
            {row.payload.guestName ?? "Guest"} · {formatAge(row.composedAt, now)}
          </span>
        </span>
      </button>
      {expanded ? (
        <div className="border-t border-line p-5">
          {isSupersedingPacket(row) ? (
            <p className="mb-3 text-xs text-muted">
              This is a corrected record (version {row.version}) — it replaces an earlier evidence packet for this trip.
            </p>
          ) : null}
          <PacketEvidenceDetail payload={row.payload} />
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link href={`/owner/trips/${row.tripId}`} className="inline-flex min-h-11 items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white">
              View trip
            </Link>
            {countdown ? (
              <span className={countdown.expired ? "text-sm text-muted" : "text-sm font-medium text-warn"}>
                {countdown.text}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function bookendLine(label: string, bookend: ParsedPacketBookend | null): string {
  if (!bookend) return `${label}: Not captured`;
  const parts: string[] = [];
  if (bookend.odometerMi !== null) parts.push(`${formatMiles(bookend.odometerMi)} odometer`);
  if (bookend.batteryPct !== null) parts.push(`${formatPct(bookend.batteryPct)} battery`);
  if (parts.length === 0) return `${label}: Not captured`;
  return `${label}: ${parts.join(", ")}${bookend.stale ? " (stale)" : ""}`;
}

function PacketEvidenceDetail({ payload }: { payload: ParsedEvidencePacket }) {
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-xs text-muted">Pickup</dt><dd className="mt-1 font-medium text-ink">{bookendLine("Pickup", payload.bookendStart)}</dd></div>
      <div><dt className="text-xs text-muted">Return</dt><dd className="mt-1 font-medium text-ink">{bookendLine("Return", payload.bookendEnd)}</dd></div>
      <div><dt className="text-xs text-muted">Miles driven</dt><dd className="mt-1 font-medium text-ink">{payload.milesDriven === null ? "Not captured" : formatMiles(payload.milesDriven)}</dd></div>
      <div><dt className="text-xs text-muted">Battery delta</dt><dd className="mt-1 font-medium text-ink">{payload.batteryDeltaPct === null ? "Not captured" : `${payload.batteryDeltaPct > 0 ? "+" : ""}${payload.batteryDeltaPct}%`}</dd></div>
      {payload.odometerRegression ? (
        <div className="sm:col-span-2">
          <dt className="sr-only">Data error</dt>
          <dd className="rounded-md border border-danger/20 bg-danger/[0.04] px-3 py-2 text-danger">
            Odometer reading looks inconsistent (end before start) — treated as a data error, never a negative mileage figure.
          </dd>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        <dt className="text-xs text-muted">Charging</dt>
        <dd className="mt-1 font-medium text-ink">
          {!payload.chargingSessionsDerived
            ? "Not yet derived"
            : payload.chargingSessions.length === 0
              ? "No charging sessions during this trip"
              : payload.chargingSessions.map((session, index) => (
                  <span key={index} className="mr-3 inline-block">
                    {session.kind ?? "session"}: {session.kWhAdded === null ? "—" : `${session.kWhAdded.toFixed(1)} kWh`}
                    {session.gapAffected ? " (gap-affected)" : ""}
                  </span>
                ))}
        </dd>
      </div>
    </dl>
  );
}
