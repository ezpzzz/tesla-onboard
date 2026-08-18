"use client";

/**
 * Rendering + data-shaping for a single Turo-email inbox candidate.
 *
 * `onlyevs_email_candidates.proposed_state` / `.correction_facts` are opaque
 * jsonb columns produced by the parser (`lib/email/turo-parser.ts`, owned by
 * a different workstream in this build). `OwnerInboxItem`
 * (`lib/owner/email-inbox-repository.ts`) intentionally does not surface
 * those columns — this module reads them directly, scoped the same way the
 * rest of the owner surface reads Supabase (manager-role RLS on
 * `onlyevs_email_candidates`), so this file's enrichment does not require
 * changing that shared type.
 *
 * proposed_state key contract, matching `lib/email/turo-parser.ts`'s actual
 * output (`guestAvatarUrl`, `guestFirstName`, `guestPhoneE164`,
 * `guestMessageText`, `messageText` (subject + plain-text body, present on
 * every candidate including `unknown`-template ones that have no other
 * extraction), `pickupAddress`, `pickupLat`/`pickupLng`,
 * `tripStartAt`/`tripEndAt`/`tripTimeZone`, `tripStartLocalText`/
 * `tripEndLocalText`). `parseEmailCandidateFacts` also accepts a few
 * alternate key spellings so a future parser tweak degrades to "field not
 * shown" instead of a crash. `correction_facts` (currently always `{}` —
 * nothing writes it yet) is read for the *current* (pre-change) window on
 * `change`/`cancellation` candidates, using the same key names prefixed with
 * `current`.
 */

import { createClient } from "@/lib/supabase/client";
import type { VehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import type { OwnerInboxItem } from "@/lib/owner/email-inbox-repository";
import { IconMail, IconMapPin, IconPhone } from "@/components/icons";
import { cn } from "@/components/ui";

export interface EmailCandidateFacts {
  guestName: string | null;
  guestAvatarUrl: string | null;
  guestPhoneE164: string | null;
  guestMessage: string | null;
  locationAddress: string | null;
  locationLat: string | null;
  locationLng: string | null;
  tripStartsAt: string | null;
  tripEndsAt: string | null;
  tripTimezone: string | null;
  /** Raw human-readable trip-window text Turo sent, always present when a
   *  window was found at all — used as the fallback display when the
   *  timezone couldn't be resolved, so the owner still sees *something*
   *  concrete instead of just "unavailable". */
  tripStartLocalText: string | null;
  tripEndLocalText: string | null;
  currentTripStartsAt: string | null;
  currentTripEndsAt: string | null;
  /** Subject + plain-text body captured for *every* candidate by
   *  `lib/email/turo-parser.ts`'s `buildMessageText` (unknown-template
   *  candidates included, since those get no other structured extraction at
   *  all) -- the raw-content fallback so a metadata-only card still shows
   *  the owner something readable, e.g. Turo's "Please verify your email
   *  address" notice, whose verification link only lives in this text. */
  messageText: string | null;
}

const EMPTY_FACTS: EmailCandidateFacts = {
  guestName: null,
  guestAvatarUrl: null,
  guestPhoneE164: null,
  guestMessage: null,
  locationAddress: null,
  locationLat: null,
  locationLng: null,
  tripStartsAt: null,
  tripEndsAt: null,
  tripTimezone: null,
  tripStartLocalText: null,
  tripEndLocalText: null,
  currentTripStartsAt: null,
  currentTripEndsAt: null,
  messageText: null,
};

function firstString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function parseEmailCandidateFacts(proposedState: unknown, correctionFacts: unknown): EmailCandidateFacts {
  const proposed = asRecord(proposedState);
  const current = asRecord(correctionFacts);
  return {
    guestName: firstString(proposed, "guestFirstName", "guestName", "driverName", "name"),
    guestAvatarUrl: firstString(proposed, "guestAvatarUrl", "avatarUrl", "avatar"),
    guestPhoneE164: firstString(proposed, "guestPhoneE164", "phoneE164", "phone"),
    guestMessage: firstString(proposed, "guestMessageText", "guestMessage", "message"),
    locationAddress: firstString(proposed, "pickupAddress", "locationAddress", "address"),
    locationLat: firstString(proposed, "pickupLat", "locationLat", "lat"),
    locationLng: firstString(proposed, "pickupLng", "locationLng", "lng"),
    tripStartsAt: firstString(proposed, "tripStartAt", "tripStartsAt", "startsAt"),
    tripEndsAt: firstString(proposed, "tripEndAt", "tripEndsAt", "endsAt"),
    tripTimezone: firstString(proposed, "tripTimeZone", "tripTimezone", "timezone"),
    tripStartLocalText: firstString(proposed, "tripStartLocalText"),
    tripEndLocalText: firstString(proposed, "tripEndLocalText"),
    currentTripStartsAt: firstString(current, "currentTripStartsAt", "tripStartAt", "tripStartsAt"),
    currentTripEndsAt: firstString(current, "currentTripEndsAt", "tripEndAt", "tripEndsAt"),
    messageText: firstString(proposed, "messageText"),
  };
}

/**
 * Which raw-message content (if any) belongs in the "Message" section.
 * `guest_message` candidates already show the guest's own short in-app text
 * (`facts.guestMessage`, extracted from the template's dedicated message
 * block) right above this section, so showing the full subject+body there
 * too would just duplicate it — this suppresses `messageText` in that one
 * case and otherwise shows it, which is what surfaces content for every
 * other candidate that has no better extraction (unknown-template candidates
 * most of all, since those have nothing else).
 */
export function selectDisplayMessage(
  facts: Pick<EmailCandidateFacts, "guestMessage" | "messageText">,
  eventType: OwnerInboxItem["eventType"],
): string | null {
  if (eventType === "guest_message" && facts.guestMessage) return null;
  return facts.messageText;
}

/**
 * The Turo driver-avatar CDN path only — deliberately excludes the sibling
 * `/media/vehicle/images/` path (per the parser spec, those are two
 * different asset families). Rendered directly from Turo's CDN, never
 * re-hosted. Anything that doesn't match this exact host+path is treated as
 * absent rather than rendered, since an owner-facing `<img src>` should never
 * point at an arbitrary URL sourced from an inbound email.
 */
export function isTuroDriverAvatarUrl(url: string | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "images.turo.com" && parsed.pathname.startsWith("/media/driver/");
  } catch {
    return false;
  }
}

/** `+15125550101` → `(512) 555-0101`; anything else passes through unchanged. */
export function formatPhoneDisplay(e164: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (!match) return e164;
  return `(${match[1]}) ${match[2]}-${match[3]}`;
}

export interface TripWindowLabel {
  text: string;
  unresolved: boolean;
  reason: "unresolved" | "ambiguous_dst" | null;
}

/**
 * `blockerCodes` (already on `OwnerInboxItem`) is the source of truth for
 * whether the trip window can be trusted — never fall back to UTC or
 * server-local time when the vehicle timezone couldn't be resolved.
 */
export function formatTripWindowLabel(
  facts: Pick<EmailCandidateFacts, "tripStartsAt" | "tripEndsAt" | "tripTimezone" | "tripStartLocalText" | "tripEndLocalText">,
  blockerCodes: readonly string[],
): TripWindowLabel | null {
  const rawFallback = facts.tripStartLocalText && facts.tripEndLocalText
    ? ` Turo said: ${facts.tripStartLocalText} to ${facts.tripEndLocalText}.`
    : "";
  if (blockerCodes.includes("trip_timezone_ambiguous_dst")) {
    return { text: `Trip time falls in a daylight-saving change — timezone couldn't be confirmed.${rawFallback}`, unresolved: true, reason: "ambiguous_dst" };
  }
  if (blockerCodes.includes("trip_timezone_unresolved")) {
    return { text: `Timezone couldn't be confirmed for this vehicle.${rawFallback}`, unresolved: true, reason: "unresolved" };
  }
  if (!facts.tripStartsAt || !facts.tripEndsAt || !facts.tripTimezone) return null;
  const start = new Date(facts.tripStartsAt);
  const end = new Date(facts.tripEndsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  // `dateStyle`/`timeStyle` cannot be combined with `timeZoneName` (ECMA-402
  // rejects the mix), so this spells out the equivalent field set instead.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: facts.tripTimezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return { text: `${formatter.format(start)} – ${formatter.format(end)}`, unresolved: false, reason: null };
}

/**
 * Href for the Inbox card's "View full email" link (T13, design doc
 * alex-email-inbox-design-20260817-123909.md step 4) into /owner/mail's
 * candidate-filtered view (components/owner/OwnerMailList.tsx's
 * `?candidateId=` mode). A candidate id, not an indexed message id -- the
 * mail surface resolves it server-side via
 * list_onlyevs_email_messages_for_candidate
 * (supabase/migrations/20260817170000_onlyevs_workspace_mail_crosslinks.sql)
 * since the Inbox never learns which private.onlyevs_email_message_index
 * row(s) a candidate maps to.
 */
export function buildViewFullEmailHref(candidateId: string): string {
  return `/owner/mail?candidateId=${encodeURIComponent(candidateId)}`;
}

export function deriveConsequenceTitle(item: Pick<OwnerInboxItem, "eventType" | "title">, guestName: string | null): string {
  const who = guestName ?? "A guest";
  switch (item.eventType) {
    case "booking":
      return `${who} booked a trip`;
    case "change":
      return `${who} requested a trip change`;
    case "cancellation":
      return `${who} cancelled their trip`;
    case "guest_message":
      return `${who} sent a message`;
    default:
      return item.title;
  }
}

export async function fetchEmailCandidateFacts(scope: VehicleWorkspaceScope, candidateId: string): Promise<EmailCandidateFacts> {
  const { data, error } = await createClient()
    .from("onlyevs_email_candidates")
    .select("proposed_state,correction_facts")
    .eq("workspace_id", scope.workspaceId)
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return EMPTY_FACTS;
  return parseEmailCandidateFacts(data.proposed_state, data.correction_facts);
}

const MESSAGE_EXCERPT_LIMIT = 220;

/* ── Timezone-aware correction editing ────────────────────────────────────
 *
 * A `<input type="datetime-local">` value is timezone-naive. The owner is
 * editing a wall-clock time *in the vehicle's resolved timezone*
 * (`facts.tripTimezone`), not in the browser's local zone, so a plain
 * `new Date(value)` would silently misinterpret it whenever those two zones
 * differ. Both helpers below convert by comparing how the same instant
 * renders in the target zone vs. UTC and correcting for the offset — no
 * dependency needed for this. Only used for the manual "correct before
 * confirming" flow (never for the trip-window display itself, which the
 * parser resolves and blocks on when ambiguous).
 */

export function isoToLocalWallTimeInput(iso: string, timeZone: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export function localWallTimeToIso(value: string, timeZone: string): string {
  const naive = new Date(`${value}:00Z`);
  const asTargetZone = new Date(naive.toLocaleString("en-US", { timeZone }));
  const asUtc = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  const offsetMs = asUtc.getTime() - asTargetZone.getTime();
  return new Date(naive.getTime() + offsetMs).toISOString();
}

/* ── Presentation ──────────────────────────────────────────────────────── */

export function CandidateAvatar({ url, guestName }: { url: string | null; guestName: string | null }) {
  if (isTuroDriverAvatarUrl(url)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- direct Turo CDN URL, never re-hosted.
      <img
        src={url}
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 rounded-full border border-line object-cover"
      />
    );
  }
  // Explicit no-image state — never a broken-image icon and never a
  // decorative fallback avatar (DESIGN.md's "no decorative icon circles"
  // rule applies to this empty state).
  const initial = guestName?.trim()?.[0]?.toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-sm font-semibold text-muted"
    >
      {initial ?? "?"}
    </span>
  );
}

export function CandidateMeta({
  facts,
  blockerCodes,
  eventType,
}: {
  facts: EmailCandidateFacts;
  blockerCodes: readonly string[];
  eventType: OwnerInboxItem["eventType"];
}) {
  const window = formatTripWindowLabel(facts, blockerCodes);
  const mapHref = facts.locationLat && facts.locationLng
    ? `https://www.google.com/maps?q=${encodeURIComponent(facts.locationLat)},${encodeURIComponent(facts.locationLng)}`
    : null;
  const displayMessage = selectDisplayMessage(facts, eventType);
  return (
    <dl className="space-y-3 text-sm">
      {window ? (
        <div className="flex items-start gap-2">
          <dt className="sr-only">Trip window</dt>
          <dd className={cn(window.unresolved ? "text-warn" : "text-ink-soft")}>{window.text}</dd>
        </div>
      ) : null}
      {facts.locationAddress || mapHref ? (
        <div className="flex items-start gap-2">
          <IconMapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <dt className="sr-only">Pickup location</dt>
          <dd>
            {facts.locationAddress ?? (
              <a href={mapHref!} target="_blank" rel="noopener noreferrer" className="text-brand underline-offset-2 hover:underline">
                View pickup location
              </a>
            )}
          </dd>
        </div>
      ) : blockerCodes.includes("pickup_location_unresolved") ? (
        <div className="flex items-start gap-2">
          <IconMapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <dt className="sr-only">Pickup location</dt>
          <dd className="text-warn">Pickup location couldn't be confirmed</dd>
        </div>
      ) : null}
      {facts.guestPhoneE164 ? (
        <div className="flex items-start gap-2">
          <IconPhone className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <dt className="sr-only">Guest phone</dt>
          <dd>
            <a href={`tel:${facts.guestPhoneE164}`} className="text-brand underline-offset-2 hover:underline">
              {formatPhoneDisplay(facts.guestPhoneE164)}
            </a>
          </dd>
        </div>
      ) : null}
      {eventType === "guest_message" && facts.guestMessage ? (
        <div className="flex items-start gap-2">
          <IconMail className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <dt className="sr-only">Guest message</dt>
          <dd className="whitespace-pre-line text-ink-soft">
            {facts.guestMessage.length > MESSAGE_EXCERPT_LIMIT
              ? `${facts.guestMessage.slice(0, MESSAGE_EXCERPT_LIMIT)}…`
              : facts.guestMessage}
          </dd>
        </div>
      ) : null}
      {displayMessage ? (
        <div className="flex items-start gap-2">
          <IconMail className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Message</dt>
            <dd className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface p-3 text-ink-soft">
              {displayMessage}
            </dd>
          </div>
        </div>
      ) : null}
    </dl>
  );
}

/** Current-vs-proposed facts row, shown only for `change`/`cancellation`. */
export function CandidateChangeComparison({ item, facts }: { item: Pick<OwnerInboxItem, "eventType">; facts: EmailCandidateFacts }) {
  if (item.eventType !== "change" && item.eventType !== "cancellation") return null;
  const hasCurrent = facts.currentTripStartsAt && facts.currentTripEndsAt;
  const hasProposed = facts.tripStartsAt && facts.tripEndsAt && facts.tripTimezone;
  if (!hasCurrent && !hasProposed) return null;
  const formatter = facts.tripTimezone
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: facts.tripTimezone })
    : null;
  return (
    <div className="grid grid-cols-1 gap-3 rounded-md border border-line bg-surface p-3 text-sm sm:grid-cols-2">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Current</p>
        <p className="mt-1 text-ink-soft">
          {hasCurrent && formatter
            ? `${formatter.format(new Date(facts.currentTripStartsAt!))} – ${formatter.format(new Date(facts.currentTripEndsAt!))}`
            : "Not available"}
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          {item.eventType === "cancellation" ? "Proposed" : "Requested"}
        </p>
        <p className="mt-1 font-medium text-ink">
          {item.eventType === "cancellation"
            ? "Cancelled — no trip"
            : hasProposed && formatter
              ? `${formatter.format(new Date(facts.tripStartsAt!))} – ${formatter.format(new Date(facts.tripEndsAt!))}`
              : "Not available"}
        </p>
      </div>
    </div>
  );
}
