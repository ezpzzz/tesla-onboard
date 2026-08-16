"use client";

/**
 * Consequence-first countdown UI for a destructive `onlyevs_email_actions`
 * row (`cancel_trip` / `rotate_guest` / `swap_vehicle` / `revoke_access` —
 * the only action types the schema allows a `brake_deadline` on). Reads the
 * linked action row directly (manager-role RLS on `onlyevs_email_actions`,
 * same posture as `InboxCandidateCard`'s facts read) since
 * `OwnerInboxItem` doesn't carry it.
 *
 * The countdown itself never appears inside an `aria-live` region — it is a
 * plain, silently-updating number so screen readers are not spammed every
 * tick. A separate, visually-hidden `aria-live="assertive"` node announces
 * exactly once, the moment this panel first observes the brake actually
 * running (`revocation_pending`) — i.e. the owner-alert was accepted and the
 * 30-minute window started.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { VehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import { Button, cn } from "@/components/ui";

export type EmailActionType = "create_trip" | "apply_update" | "cancel_trip" | "rotate_guest" | "swap_vehicle" | "deliver_link" | "revoke_access";
export type EmailActionState =
  | "queued" | "claimed" | "validating" | "awaiting_owner_alert" | "revocation_pending" | "provider_mutating"
  | "db_committing" | "delivery_pending" | "succeeded" | "aborted" | "superseded" | "needs_review"
  | "failed_retryable" | "ambiguous" | "dead_letter";

export interface EmailActionRow {
  id: string;
  state: EmailActionState;
  actionType: EmailActionType;
  brakeDeadline: string | null;
  providerClaimedAt: string | null;
  revision: number;
}

const DESTRUCTIVE_ACTION_TYPES: readonly EmailActionType[] = ["cancel_trip", "rotate_guest", "swap_vehicle", "revoke_access"];

const CONSEQUENCE_COPY: Record<EmailActionType, { headline: string; consequence: string }> = {
  create_trip: { headline: "Creating a trip", consequence: "No effective trip or access exists yet." },
  apply_update: { headline: "Updating trip details", consequence: "The trip's effective state has not changed yet." },
  deliver_link: { headline: "Sending the guest link", consequence: "No effective trip or access has changed." },
  cancel_trip: { headline: "This will cancel the guest's trip", consequence: "Their Tesla access will be revoked once this proceeds." },
  rotate_guest: { headline: "This will move the trip to a different guest", consequence: "The previous guest's Tesla access will be revoked once this proceeds." },
  swap_vehicle: { headline: "This will move the trip to a different vehicle", consequence: "Access to the previous vehicle will be revoked once this proceeds." },
  revoke_access: { headline: "This will revoke the guest's Tesla access", consequence: "The trip's effective access has not changed yet." },
};

export type UrgentActionPhase =
  | "notifying" | "counting_down" | "grace_expired" | "in_progress"
  | "resolved_succeeded" | "resolved_aborted" | "needs_review" | "failed";

export interface UrgentActionView {
  visible: boolean;
  phase: UrgentActionPhase;
  headline: string;
  detail: string;
  deadlineLabel: string | null;
  minutesRemaining: number | null;
  abortEnabled: boolean;
  abortDisabledReason: string | null;
}

const TERMINAL_MESSAGE: Partial<Record<EmailActionState, { phase: UrgentActionPhase; detail: string }>> = {
  succeeded: { phase: "resolved_succeeded", detail: "This change was applied." },
  aborted: { phase: "resolved_aborted", detail: "Aborted — no changes were made." },
  superseded: { phase: "resolved_aborted", detail: "A newer update superseded this action." },
  needs_review: { phase: "needs_review", detail: "The owner alert couldn't be confirmed delivered. This needs manual review." },
  failed_retryable: { phase: "failed", detail: "This action failed and needs manual follow-up." },
  ambiguous: { phase: "failed", detail: "The last step's outcome is unclear and needs manual follow-up." },
  dead_letter: { phase: "failed", detail: "This action failed repeatedly and needs manual follow-up." },
};

export function deriveUrgentActionView(action: EmailActionRow | null, nowMs: number): UrgentActionView {
  if (!action || !DESTRUCTIVE_ACTION_TYPES.includes(action.actionType)) {
    return { visible: false, phase: "notifying", headline: "", detail: "", deadlineLabel: null, minutesRemaining: null, abortEnabled: false, abortDisabledReason: null };
  }
  const copy = CONSEQUENCE_COPY[action.actionType];
  const claimed = Boolean(action.providerClaimedAt);

  const terminal = TERMINAL_MESSAGE[action.state];
  if (terminal) {
    return { visible: true, phase: terminal.phase, headline: copy.headline, detail: terminal.detail, deadlineLabel: null, minutesRemaining: null, abortEnabled: false, abortDisabledReason: null };
  }
  if (action.state === "provider_mutating" || action.state === "db_committing" || action.state === "delivery_pending") {
    return { visible: true, phase: "in_progress", headline: copy.headline, detail: "Revocation in progress — this can no longer be stopped.", deadlineLabel: null, minutesRemaining: null, abortEnabled: false, abortDisabledReason: "Already in progress" };
  }
  if (action.state === "revocation_pending" && action.brakeDeadline) {
    const deadline = new Date(action.brakeDeadline);
    const deadlineLabel = new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(deadline);
    const remainingMs = deadline.getTime() - nowMs;
    if (remainingMs <= 0) {
      return { visible: true, phase: "grace_expired", headline: copy.headline, detail: `${copy.consequence} The grace period ended at ${deadlineLabel}.`, deadlineLabel, minutesRemaining: 0, abortEnabled: false, abortDisabledReason: "The grace period has ended" };
    }
    return {
      visible: true,
      phase: "counting_down",
      headline: copy.headline,
      detail: copy.consequence,
      deadlineLabel,
      minutesRemaining: Math.max(1, Math.ceil(remainingMs / 60000)),
      abortEnabled: !claimed,
      abortDisabledReason: claimed ? "Revocation in progress" : null,
    };
  }
  // queued | claimed | validating | awaiting_owner_alert
  return {
    visible: true,
    phase: "notifying",
    headline: copy.headline,
    detail: `Notifying you before this proceeds. ${copy.consequence}`,
    deadlineLabel: null,
    minutesRemaining: null,
    abortEnabled: false,
    abortDisabledReason: "Waiting for the owner alert to be confirmed delivered",
  };
}

export async function fetchLinkedEmailAction(scope: VehicleWorkspaceScope, candidateId: string): Promise<EmailActionRow | null> {
  const { data, error } = await createClient()
    .from("onlyevs_email_actions")
    .select("id,state,action_type,brake_deadline,provider_claimed_at,revision")
    .eq("workspace_id", scope.workspaceId)
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    state: data.state as EmailActionState,
    actionType: data.action_type as EmailActionType,
    brakeDeadline: data.brake_deadline,
    providerClaimedAt: data.provider_claimed_at,
    revision: data.revision,
  };
}

function msUntilNextMinute(nowMs: number): number {
  return 60000 - (nowMs % 60000);
}

/**
 * One shared minute-boundary clock for a countdown, rather than letting each
 * consumer (the panel's own display and the sticky-footer Abort gate) drift
 * out of sync with independent timers.
 */
export function useMinuteTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timeout = window.setTimeout(() => setNow(Date.now()), msUntilNextMinute(Date.now()));
    return () => window.clearTimeout(timeout);
  }, [active, now]);
  return now;
}

const TONE_BY_PHASE: Record<UrgentActionPhase, string> = {
  notifying: "border-line bg-surface",
  counting_down: "border-danger/30 bg-danger/[0.06]",
  grace_expired: "border-danger/30 bg-danger/[0.06]",
  in_progress: "border-line bg-surface",
  resolved_succeeded: "border-good/30 bg-good/[0.06]",
  resolved_aborted: "border-line bg-surface",
  needs_review: "border-warn/30 bg-warn/[0.06]",
  failed: "border-danger/30 bg-danger/[0.06]",
};

export function UrgentActionPanel({ action, now }: { action: EmailActionRow | null; now: number }) {
  const announcedRef = useRef<UrgentActionPhase | null>(null);
  const [assertiveMessage, setAssertiveMessage] = useState("");
  // Desktop inline + mobile sheet can both have this mounted at once (one
  // hidden via CSS, not unmounted) — a per-instance id avoids a duplicate-id
  // aria-labelledby reference.
  const headlineId = useId();

  const view = useMemo(() => deriveUrgentActionView(action, now), [action, now]);

  useEffect(() => {
    if (view.phase === "counting_down" && announcedRef.current !== "counting_down") {
      setAssertiveMessage(`Destructive change accepted. ${view.headline}. Abort within the next ${view.minutesRemaining ?? 30} minutes to stop it.`);
    }
    announcedRef.current = view.phase;
  }, [view.phase, view.headline, view.minutesRemaining]);

  if (!view.visible) return null;

  return (
    <div className={cn("rounded-lg border p-4", TONE_BY_PHASE[view.phase])} aria-labelledby={headlineId}>
      <div aria-live="assertive" className="sr-only">{assertiveMessage}</div>
      <p id={headlineId} className="font-semibold text-ink">{view.headline}</p>
      <p className="mt-1 text-sm text-ink-soft">{view.detail}</p>
      {view.phase === "counting_down" && view.deadlineLabel ? (
        <p className="mt-2 text-sm font-medium text-danger">
          {view.minutesRemaining} minute{view.minutesRemaining === 1 ? "" : "s"} left to abort — proceeds at {view.deadlineLabel} unless stopped.
        </p>
      ) : null}
    </div>
  );
}

export function UrgentActionAbortButton({
  view,
  onAbort,
  busy,
  fullWidth,
}: {
  view: UrgentActionView;
  onAbort: (reason: string) => void | Promise<void>;
  busy: boolean;
  fullWidth?: boolean;
}) {
  const [reason, setReason] = useState("Owner aborted from the Inbox.");
  // The same card can render this control twice at once (desktop inline +
  // mobile sheet, one hidden via CSS rather than unmounted) — a stable but
  // per-instance id keeps the label association valid for each.
  const reasonId = useId();
  if (!view.visible || view.phase === "resolved_succeeded" || view.phase === "resolved_aborted" || view.phase === "needs_review" || view.phase === "failed") {
    return null;
  }
  return (
    <div className={cn("space-y-2", fullWidth && "w-full")}>
      <label className="block text-xs font-medium text-muted" htmlFor={reasonId}>
        Reason (kept with the audit record)
      </label>
      <input
        id={reasonId}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        disabled={!view.abortEnabled || busy}
        className="w-full rounded-md border border-line px-3 py-2.5 text-sm disabled:bg-surface disabled:text-muted"
      />
      {/* Abort is the protective action here — it prevents the destructive
          change, so it is never styled as a destructive confirmation. */}
      <Button
        type="button"
        variant="primary"
        fullWidth={fullWidth}
        disabled={!view.abortEnabled || busy}
        title={view.abortDisabledReason ?? undefined}
        onClick={() => void onAbort(reason.trim() || "Owner aborted from the Inbox.")}
      >
        {busy ? "Aborting…" : view.phase === "grace_expired" || view.phase === "in_progress" ? "Revocation in progress" : "Abort — keep current state"}
      </Button>
    </div>
  );
}
