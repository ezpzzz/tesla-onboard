"use client";

/**
 * Per-session owner cost override/entry field (Phase 3, TODO 2 choice C,
 * mechanism Issue 9 choice 9B) — a small, labeled control meant to sit on a
 * single charge-session row in the trip/ledger UI (`DerivedChargeSession`,
 * `lib/owner/charge-sessions.ts`). Always shows the row's current
 * provenance ('invoice' / 'rate' / 'manual' / none) so an owner-entered
 * value is never mistaken for a reconciled Tesla invoice figure — see
 * CostProvenanceTag below, used standalone anywhere a session's cost is
 * displayed.
 *
 * `applyManualChargeCostOverride` (charge-sessions.ts) is the pure function
 * that actually promotes a session to costProvenance 'manual' once a value
 * is entered; this component only validates the draft, applies that pure
 * function for an optimistic local preview, and hands the result to
 * `saveAction`, which the caller wires to
 * `saveManualChargeCostOverride` (charge-session-repository.ts) to persist
 * the correction to `onlyevs_manual_charge_cost_entries`. The prop is named
 * `saveAction` rather than `onSubmit` — this isn't a form, and Next flags an
 * `onSubmit`-named prop on a non-form client component as ambiguous with
 * native submit semantics; an `*Action` name matches the convention used
 * elsewhere for an async persistence callback. A caller may still leave
 * `saveAction` unset (e.g. a read-only surface), in which case Save is
 * disabled and the field explains why rather than silently discarding the
 * entry.
 */

import { useState } from "react";
import type { DerivedChargeSession } from "@/lib/owner/types";
import { applyManualChargeCostOverride } from "@/lib/owner/charge-sessions";
import { formatUsd } from "@/lib/owner/derive";
import { Button } from "@/components/ui";

const MAX_REASONABLE_SESSION_COST_USD = 500;

/** Validates a manual cost-override draft. Blank is invalid here (unlike the
 * workspace rate field) — this control only appears to *enter* a value;
 * clearing an existing override is a separate "Remove override" action, not
 * a blank save. */
export function validateCostOverrideDraft(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "Enter an amount.";
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return "Enter a number, e.g. 12.50.";
  if (n < 0) return "Amount can't be negative.";
  if (n > MAX_REASONABLE_SESSION_COST_USD) return `Amount must be $${MAX_REASONABLE_SESSION_COST_USD} or less.`;
  return null;
}

export function parseCostOverrideDraft(raw: string): number | null {
  if (validateCostOverrideDraft(raw) !== null) return null;
  return Number(raw.trim());
}

/** Human label for a session's cost provenance — 'manual' is always spelled
 * out as owner-entered, never left ambiguous with a reconciled invoice. */
export function costProvenanceLabel(provenance: DerivedChargeSession["costProvenance"]): string | null {
  switch (provenance) {
    case "invoice": return "From Tesla invoice";
    case "rate": return "Estimated from your rate";
    case "manual": return "Owner-entered";
    default: return null;
  }
}

export function CostProvenanceTag({ provenance }: { provenance: DerivedChargeSession["costProvenance"] }) {
  const label = costProvenanceLabel(provenance);
  if (!label) return null;
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">
      {label}
    </span>
  );
}

export function CostOverrideField({
  session,
  enteredBy,
  saveAction,
}: {
  session: DerivedChargeSession;
  /** Identifies who entered the override, per `ManualChargeCostOverride`'s
   * audit field — the caller already has the authenticated owner's id/email
   * in context (e.g. via Supabase auth), so it's threaded in rather than
   * re-fetched here. */
  enteredBy: string;
  /** Persists the correction — see the module doc comment. When absent,
   * Save is disabled with an explanatory message rather than silently
   * discarding the owner's entry. */
  saveAction?: (session: DerivedChargeSession) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.costUsd !== null ? String(session.costUsd) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const validationError = validateCostOverrideDraft(draft);
    if (validationError) { setError(validationError); return; }
    if (!saveAction) { setError("Cost overrides can't be saved yet in this workspace."); return; }
    const costUsd = parseCostOverrideDraft(draft);
    if (costUsd === null) return;
    const next = applyManualChargeCostOverride(session, { sessionId: session.id, costUsd, enteredBy });
    setSaving(true);
    setError(null);
    try {
      await saveAction(next);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The override couldn't be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink">{session.costUsd === null ? "No cost recorded" : formatUsd(session.costUsd)}</span>
        <CostProvenanceTag provenance={session.costProvenance} />
        <button
          type="button"
          onClick={() => { setEditing(true); setDraft(session.costUsd !== null ? String(session.costUsd) : ""); setError(null); }}
          className="min-h-11 text-sm font-medium text-brand underline-offset-2 hover:underline"
        >
          {session.costUsd === null ? "Enter cost" : "Correct cost"}
        </button>
      </div>
    );
  }

  const fieldId = `cost-override-${session.id}`;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label htmlFor={fieldId} className="text-xs font-medium text-muted">
        Cost ($)
        <input
          id={fieldId}
          type="number"
          inputMode="decimal"
          step="0.01"
          min={0}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(null); }}
          className="field mt-1 min-h-11 w-28"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
        />
      </label>
      <Button type="button" className="min-h-11" disabled={saving} onClick={() => void save()}>
        {saving ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="ghost" className="min-h-11" disabled={saving} onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {error ? <p id={`${fieldId}-error`} role="alert" className="w-full text-xs text-danger">{error}</p> : null}
    </div>
  );
}
