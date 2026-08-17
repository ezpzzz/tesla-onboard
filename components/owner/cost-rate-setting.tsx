"use client";

/**
 * Workspace $/kWh rate setting (Phase 3, TODO 2 choice C, mechanism Issue 9
 * choice 9B). Prices home/AC charge sessions at kWh x this rate
 * (`lib/owner/charge-sessions.ts`'s `reconcileHomeRateCost`,
 * `costProvenance: 'rate'`) — DC-fast sessions are priced from a reconciled
 * Tesla invoice instead and never use this setting. Unset -> every home
 * session renders kWh-only, never a guessed price (7A's unit rule).
 *
 * This is deliberately its own section, saved on its own cycle, separate
 * from TenantSettingsForm/`saveConfig` — a $/kWh rate is private operational
 * data, not a guest-safe presentation field, so it must never enter
 * `workspace_branding.features` (the exact jsonb TenantConfigProvider
 * publishes to guests). It targets a sibling, non-features column on the
 * same `workspace_branding` row instead, added by the accompanying
 * additive migration (supabase/migrations/
 * 20260817090000_onlyevs_vehicle_telemetry_ledger.sql):
 *
 *   alter table public.workspace_branding
 *     add column if not exists home_charge_rate_usd_per_kwh numeric(6,4)
 *       check (home_charge_rate_usd_per_kwh is null or home_charge_rate_usd_per_kwh > 0);
 *
 * Every existing read of `workspace_branding` in this codebase (owner and
 * guest alike) already explicit-selects its column list rather than
 * `select("*")` (verified in OwnerTenantProvider.tsx and
 * TenantConfigProvider.tsx), so this column is inert to those paths — never
 * leaked to guests. The `loadState === "unavailable"` / `isMissingColumnError`
 * handling below stays even now that the column ships: it's what keeps this
 * screen degrading honestly (rather than crashing) against a workspace
 * whose branding row predates this migration or whose PostgREST schema
 * cache hasn't refreshed yet.
 */

import { useEffect, useState } from "react";
import { useOwnerTenant } from "./OwnerTenantProvider";
import { createClient } from "@/lib/supabase/client";
import { Button, Card } from "@/components/ui";
import { IconBolt } from "@/components/icons";

const RATE_COLUMN = "home_charge_rate_usd_per_kwh";
const MAX_REASONABLE_RATE_USD_PER_KWH = 5;

/** Blank clears the rate (kWh-only rendering resumes); anything else must be
 * a finite, positive, plausible $/kWh figure. Never silently clamps or
 * rounds — the caller shows the message verbatim beside the field. */
export function validateRateDraft(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return "Enter a number, e.g. 0.14.";
  if (n <= 0) return "Rate must be greater than $0.";
  if (n > MAX_REASONABLE_RATE_USD_PER_KWH) return `Rate must be $${MAX_REASONABLE_RATE_USD_PER_KWH} per kWh or less.`;
  return null;
}

/** Blank -> null (clears the rate); a validated draft's numeric value
 * otherwise. Returns null for an invalid draft too — callers must check
 * validateRateDraft first and not attempt the write on an error. */
export function parseRateDraft(raw: string): number | null {
  if (validateRateDraft(raw) !== null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : Number(trimmed);
}

/** True when the write failed specifically because the backing column
 * doesn't exist yet (Postgres 42703 / PostgREST's schema-cache-miss
 * PGRST204) — the one case this component surfaces a distinct "not
 * available yet" message instead of the generic save-failed one. */
export function isMissingColumnError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

type LoadState = "loading" | "loaded" | "unavailable";
type SaveState = "idle" | "saving" | "saved" | "error" | "unavailable";

export function CostRateSetting() {
  const { workspace } = useOwnerTenant();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [draft, setDraft] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    let cancelled = false;
    if (!workspace) { setLoadState("loaded"); return; }
    (async () => {
      const { data, error } = await createClient()
        .from("workspace_branding")
        .select(RATE_COLUMN)
        .eq("workspace_id", workspace.id)
        .eq("shop_slug", workspace.shopSlug)
        .maybeSingle<Record<string, number | null>>();
      if (cancelled) return;
      if (error) {
        setLoadState(isMissingColumnError(error) ? "unavailable" : "loaded");
        return;
      }
      const rate = data?.[RATE_COLUMN];
      setDraft(typeof rate === "number" ? String(rate) : "");
      setLoadState("loaded");
    })();
    return () => { cancelled = true; };
  }, [workspace]);

  function onChange(value: string) {
    setDraft(value);
    setSaveState("idle");
    setFieldError(validateRateDraft(value));
  }

  async function save() {
    const error = validateRateDraft(draft);
    if (error) { setFieldError(error); return; }
    if (!workspace) return;
    setSaveState("saving");
    const { error: writeError } = await createClient()
      .from("workspace_branding")
      .update({ [RATE_COLUMN]: parseRateDraft(draft) })
      .eq("workspace_id", workspace.id)
      .eq("shop_slug", workspace.shopSlug);
    if (writeError) {
      setSaveState(isMissingColumnError(writeError) ? "unavailable" : "error");
      return;
    }
    setSaveState("saved");
  }

  if (!workspace) return null;

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Charging cost</h2>
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <IconBolt className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
          <span className="text-sm font-semibold text-ink">Home charging rate</span>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Prices home/AC charging sessions at kWh added × this rate. Supercharging is always priced
          from Tesla&apos;s own invoice, never this rate. Leave blank to show kWh only, with no dollar
          guess.
        </p>
        {loadState === "unavailable" ? (
          <p className="text-sm text-muted">Rate setting isn&apos;t available in this workspace yet.</p>
        ) : (
          <>
            <label htmlFor="cost-rate-per-kwh" className="block text-xs font-medium text-muted">
              $ per kWh
            </label>
            <input
              id="cost-rate-per-kwh"
              name="homeChargeRatePerKwh"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              disabled={loadState === "loading"}
              value={draft}
              onChange={(e) => onChange(e.target.value)}
              className="field min-h-11"
              placeholder="e.g. 0.14"
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "cost-rate-per-kwh-error" : undefined}
            />
            {fieldError ? (
              <p id="cost-rate-per-kwh-error" className="text-xs text-danger">{fieldError}</p>
            ) : null}
            {saveState === "error" ? (
              <p role="alert" className="text-sm text-danger">The rate couldn&apos;t be saved. Try again.</p>
            ) : null}
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                className="min-h-11"
                disabled={loadState === "loading" || saveState === "saving" || Boolean(fieldError)}
                onClick={() => void save()}
              >
                {saveState === "saving" ? "Saving…" : "Save rate"}
              </Button>
              {saveState === "saved" ? <span className="text-sm font-medium text-good">Saved</span> : null}
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
