"use client";

/**
 * Shared vehicle create/edit form — the single source of the vehicle field
 * set, used by both /owner/vehicles/new (mode "create") and embedded on
 * /owner/vehicles/[id] (mode "edit"). Pure controlled form: local field
 * state (strings, so number/nullable fields can be empty mid-edit),
 * validated with validateVehicleInput on submit. Durable workspace writes are
 * awaited and failures stay visible in the form instead of reporting success.
 *
 * Note: this form edits the *owner dashboard's* record of the vehicle
 * (stats, policy overrides, notes) — it never writes to hostConfig, so it
 * intentionally cannot change the selected guest vehicle until the owner
 * chooses it in Settings. See the hint copy below.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { VehicleInput, VehicleShifter } from "@/lib/owner/types";
import { validateVehicleInput } from "@/lib/owner/vehicle-state";
import { validCoordinates } from "@/lib/owner/telemetry-policy";
import { createClient } from "@/lib/supabase/client";
import { useOwnerTenant } from "./OwnerTenantProvider";
import { Button, Segmented } from "../ui";
import { IconMapPin } from "../icons";

// Fixed SSR-safe fallback for "current year" — reading Date.now() during
// render risks server/client clock skew producing a hydration mismatch.
// The real year is patched in via a mount effect below, after hydration.
const SSR_FALLBACK_YEAR = 2026;

interface VehicleFormProps {
  mode: "create" | "edit";
  initialValues?: Partial<VehicleInput>;
  globalPolicyPct: number;
  onSubmit: (input: VehicleInput) => void | Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
  /**
   * Durable vehicle id — only known once the vehicle record exists (edit
   * mode). The home-area field group (Phase 4 sub-task, T8/T22) needs this
   * to read/write `onlyevs_vehicles.home_area_*` directly, since those
   * columns aren't part of `VehicleInput`/the create/edit submit contract.
   * Callers that don't yet pass this see the "save the vehicle first"
   * guidance state instead of the field group — see HomeAreaFieldGroup below.
   */
  vehicleId?: string;
}

interface FormValues {
  displayName: string;
  model: string;
  trim: string;
  year: string;
  color: string;
  interior: string;
  wheelType: string;
  shifter: VehicleShifter;
  licensePlate: string;
  vin: string;
  returnChargeLevelPct: string;
  notes: string;
}

function initialFormValues(initial: Partial<VehicleInput> | undefined): FormValues {
  return {
    displayName: initial?.displayName ?? "",
    model: initial?.model ?? "",
    trim: initial?.trim ?? "",
    year: initial?.year !== undefined ? String(initial.year) : String(SSR_FALLBACK_YEAR),
    color: initial?.color ?? "",
    interior: initial?.interior ?? "",
    wheelType: initial?.wheelType ?? "",
    shifter: initial?.shifter ?? "stalk",
    licensePlate: initial?.licensePlate ?? "",
    vin: initial?.vin ?? "",
    returnChargeLevelPct:
      initial?.returnChargeLevelPct !== undefined && initial?.returnChargeLevelPct !== null
        ? String(initial.returnChargeLevelPct)
        : "",
    notes: initial?.notes ?? "",
  };
}

function toVehicleInput(
  values: FormValues,
  preserved?: Partial<VehicleInput>,
): VehicleInput {
  const trimmedPlate = values.licensePlate.trim();
  const trimmedVin = values.vin.trim();
  const trimmedPct = values.returnChargeLevelPct.trim();
  const trimmedInterior = values.interior.trim();
  const trimmedWheelType = values.wheelType.trim();
  const interiorChanged = trimmedInterior !== (preserved?.interior ?? "");
  const colorChanged = values.color.trim() !== (preserved?.color ?? "");
  const interiorCode = interiorChanged ? null : preserved?.teslaInteriorCode ?? null;
  return {
    displayName: values.displayName.trim(),
    model: values.model.trim(),
    trim: values.trim.trim(),
    year: Number(values.year),
    color: values.color.trim(),
    shifter: values.shifter,
    licensePlate: trimmedPlate === "" ? null : trimmedPlate,
    vin: trimmedVin === "" ? null : trimmedVin,
    returnChargeLevelPct: trimmedPct === "" ? null : Number(trimmedPct),
    notes: values.notes,
    wheelType: trimmedWheelType === "" ? null : trimmedWheelType,
    interior: trimmedInterior === "" ? null : trimmedInterior,
    teslaInteriorCode: interiorCode,
    teslaPaintCode: colorChanged ? null : preserved?.teslaPaintCode ?? null,
    teslaSpecSource: preserved?.teslaSpecSource ?? null,
    teslaImportedSpec: preserved?.teslaImportedSpec ?? null,
    teslaImportKey: preserved?.teslaImportKey ?? null,
  };
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  const errorId = `${id}-error`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
      {error && (
        <p id={errorId} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/* ── Home area (Phase 4 sub-task, design-review 8A) ───────────────────────
 *
 * Optional per-vehicle center + radius, used only to compute the out-of-area
 * evidence row (Phase 4's location route). Never guest-visible. Storage:
 * `onlyevs_vehicles.home_area_center_lat` / `_center_lng` / `_radius_mi`
 * (additive columns already migrated — see
 * supabase/migrations/20260817090000_onlyevs_vehicle_telemetry_ledger.sql).
 * These three columns are edited independently of the rest of the vehicle
 * record (their own load/save cycle, own error/saved state) rather than
 * folded into VehicleInput/onSubmit, since `lib/owner/types.ts` and
 * `lib/owner/vehicle-repository.ts` are owned by a different lane in this
 * build and this field group must not require editing either file.
 */

const HOME_AREA_RADIUS_PRESETS_MI = [25, 50, 100, 250] as const;

export interface HomeAreaDraft {
  centerLat: string;
  centerLng: string;
  radiusMi: string;
}

export const EMPTY_HOME_AREA_DRAFT: HomeAreaDraft = { centerLat: "", centerLng: "", radiusMi: "" };

/** Blank -> null; a non-blank, non-finite string is reported by the
 * validator below rather than silently coerced to null here. */
function parseOptionalNumberInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Field-level errors for the home-area draft. Lat/lng must be present as a
 * pair (or both blank, to clear the home area) and in-range; a radius is
 * required exactly when a center is set. Never fabricates a default radius.
 */
export function validateHomeAreaDraft(draft: HomeAreaDraft): Partial<Record<keyof HomeAreaDraft, string>> {
  const errors: Partial<Record<keyof HomeAreaDraft, string>> = {};
  const lat = parseOptionalNumberInput(draft.centerLat);
  const lng = parseOptionalNumberInput(draft.centerLng);
  const latBlank = draft.centerLat.trim() === "";
  const lngBlank = draft.centerLng.trim() === "";
  if (latBlank !== lngBlank) {
    errors.centerLat = "Enter both latitude and longitude, or leave both blank.";
    errors.centerLng = "Enter both latitude and longitude, or leave both blank.";
  } else if (!latBlank && !lngBlank) {
    if (Number.isNaN(lat) || Number.isNaN(lng) || !validCoordinates(lat as number, lng as number)) {
      errors.centerLat = "Enter a valid latitude (-90 to 90) and longitude (-180 to 180).";
    }
  }
  const radius = parseOptionalNumberInput(draft.radiusMi);
  if (!latBlank && !lngBlank) {
    if (draft.radiusMi.trim() === "") errors.radiusMi = "Choose a radius for the home area.";
    else if (Number.isNaN(radius) || (radius as number) <= 0) errors.radiusMi = "Radius must be a positive number of miles.";
  }
  return errors;
}

/** Draft -> the exact patch to write to onlyevs_vehicles, or null when the
 * draft doesn't validate (caller should not attempt the write). Clearing
 * both coordinate fields clears the radius too, so a reset always lands in
 * the fully-unset state rather than an orphaned radius with no center. */
export function buildHomeAreaPatch(draft: HomeAreaDraft): {
  home_area_center_lat: number | null;
  home_area_center_lng: number | null;
  home_area_radius_mi: number | null;
} | null {
  if (Object.keys(validateHomeAreaDraft(draft)).length > 0) return null;
  const lat = parseOptionalNumberInput(draft.centerLat);
  const lng = parseOptionalNumberInput(draft.centerLng);
  const radius = parseOptionalNumberInput(draft.radiusMi);
  return {
    home_area_center_lat: lat === null || Number.isNaN(lat) ? null : lat,
    home_area_center_lng: lng === null || Number.isNaN(lng) ? null : lng,
    home_area_radius_mi: lat === null ? null : (radius === null || Number.isNaN(radius) ? null : radius),
  };
}

/** Which of the fixed presets (if any) the draft's radius currently matches,
 * for highlighting the right Segmented option; "custom" covers everything
 * else, including blank. */
export function matchedRadiusPreset(radiusMi: string): (typeof HOME_AREA_RADIUS_PRESETS_MI)[number] | "custom" {
  const n = Number(radiusMi.trim());
  const match = HOME_AREA_RADIUS_PRESETS_MI.find((preset) => preset === n);
  return match ?? "custom";
}

export type LocateSetupOutcome =
  | { kind: "filled"; latitude: number; longitude: number }
  | { kind: "vehicle_not_found" }
  | { kind: "vin_unknown" }
  | { kind: "reconnect_required" }
  | { kind: "read_failed" }
  | { kind: "network_error" };

/**
 * Interprets `/api/owner/vehicles/[id]/locate-setup`'s JSON body (see that
 * route's docstring for the full state contract) into a UI-facing outcome.
 * Pure and network-free so it's directly unit-testable; the fetch call
 * itself lives in HomeAreaFieldGroup below.
 */
export function interpretLocateSetupResponse(status: number, body: unknown): LocateSetupOutcome {
  if (status === 404) return { kind: "vehicle_not_found" };
  const row = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (row.state === "reading" && typeof row.latitude === "number" && typeof row.longitude === "number") {
    return { kind: "filled", latitude: row.latitude, longitude: row.longitude };
  }
  if (row.state === "vin_unknown") return { kind: "vin_unknown" };
  if (row.state === "reconnect_required") return { kind: "reconnect_required" };
  if (row.state === "read_failed") return { kind: "read_failed" };
  return { kind: "network_error" };
}

/** Copy shown beside the "Use car's current location" button for each
 * non-"filled" outcome. `reconnect_required` also covers the honest no-op
 * state the locate-setup route reports when operations are enabled (see
 * that route's docstring) — the same wording fits both an expired session
 * and a mode where a live read isn't available yet, and in either case the
 * manual fields below are the actual way forward, so `useCurrentLocation`
 * expands them automatically on this outcome (design-review 8A: "manual
 * fallback prominent"). */
const LOCATE_SETUP_OUTCOME_COPY: Record<LocateSetupOutcome["kind"], string | null> = {
  filled: null,
  vehicle_not_found: "This vehicle couldn't be found. Save it first, then try again.",
  vin_unknown: "This vehicle has no VIN on file yet — add one to use a live location read.",
  reconnect_required: "Reconnect Tesla to use the car's location, or enter coordinates manually.",
  read_failed: "The car didn't respond to the location request. It may be asleep or out of signal — try again in a moment, or enter coordinates manually.",
  network_error: "The location request failed. Check your connection and try again, or enter coordinates manually.",
};

/** Outcomes for which the manual fields should expand automatically —
 * every case where a live read is not the way forward right now, so the
 * "or enter coordinates manually" copy above is backed by fields already
 * visible rather than a second click to find them. */
const LOCATE_SETUP_OUTCOMES_EXPAND_MANUAL: ReadonlySet<LocateSetupOutcome["kind"]> = new Set([
  "reconnect_required",
  "read_failed",
  "network_error",
]);

type SaveState = "idle" | "saving" | "saved" | "error";
type LocateState = "idle" | "reading";

function HomeAreaFieldGroup({ vehicleId }: { vehicleId: string }) {
  const { workspace } = useOwnerTenant();
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<HomeAreaDraft>(EMPTY_HOME_AREA_DRAFT);
  const [errors, setErrors] = useState<Partial<Record<keyof HomeAreaDraft, string>>>({});
  const [showManual, setShowManual] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [locateState, setLocateState] = useState<LocateState>("idle");
  const [locateNote, setLocateNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!workspace) { setLoaded(true); return; }
    (async () => {
      const { data } = await createClient()
        .from("onlyevs_vehicles")
        .select("home_area_center_lat,home_area_center_lng,home_area_radius_mi")
        .eq("workspace_id", workspace.id)
        .eq("shop_slug", workspace.shopSlug)
        .eq("id", vehicleId)
        .maybeSingle<{ home_area_center_lat: number | null; home_area_center_lng: number | null; home_area_radius_mi: number | null }>();
      if (cancelled) return;
      if (data) {
        setDraft({
          centerLat: data.home_area_center_lat === null ? "" : String(data.home_area_center_lat),
          centerLng: data.home_area_center_lng === null ? "" : String(data.home_area_center_lng),
          radiusMi: data.home_area_radius_mi === null ? "" : String(data.home_area_radius_mi),
        });
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [workspace, vehicleId]);

  function setField<K extends keyof HomeAreaDraft>(key: K, value: string) {
    setSaveState("idle");
    setSaveError(null);
    setDraft((prev) => {
      const next = { ...prev, [key]: value };
      setErrors((prevErrors) => (Object.keys(prevErrors).length > 0 ? validateHomeAreaDraft(next) : prevErrors));
      return next;
    });
  }

  async function save() {
    const fieldErrors = validateHomeAreaDraft(draft);
    if (Object.keys(fieldErrors).length > 0) { setErrors(fieldErrors); return; }
    const patch = buildHomeAreaPatch(draft);
    if (!patch || !workspace) return;
    setErrors({});
    setSaveState("saving");
    setSaveError(null);
    const { error } = await createClient()
      .from("onlyevs_vehicles")
      .update(patch)
      .eq("workspace_id", workspace.id)
      .eq("shop_slug", workspace.shopSlug)
      .eq("id", vehicleId);
    if (error) {
      setSaveState("error");
      setSaveError("The home area couldn't be saved. Try again.");
      return;
    }
    setSaveState("saved");
  }

  async function useCurrentLocation() {
    setLocateState("reading");
    setLocateNote(null);
    try {
      const res = await fetch(`/api/owner/vehicles/${vehicleId}/locate-setup`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      const outcome = interpretLocateSetupResponse(res.status, body);
      if (outcome.kind === "filled") {
        setSaveState("idle");
        setDraft((prev) => ({
          ...prev,
          centerLat: String(outcome.latitude),
          centerLng: String(outcome.longitude),
        }));
        setErrors({});
        setShowManual(true);
      } else {
        setLocateNote(LOCATE_SETUP_OUTCOME_COPY[outcome.kind]);
        if (LOCATE_SETUP_OUTCOMES_EXPAND_MANUAL.has(outcome.kind)) setShowManual(true);
      }
    } catch {
      setLocateNote(LOCATE_SETUP_OUTCOME_COPY.network_error);
      setShowManual(true);
    } finally {
      setLocateState("idle");
    }
  }

  const hasHomeArea = draft.centerLat.trim() !== "" && draft.centerLng.trim() !== "";
  const preset = matchedRadiusPreset(draft.radiusMi);

  return (
    <div className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex items-center gap-2">
        <IconMapPin className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="text-sm font-semibold text-ink">Home area</span>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        Used only to flag out-of-area driving during an active, consented trip — informational, never a fee.
      </p>
      {!loaded ? (
        <p className="text-sm text-muted">Loading home area…</p>
      ) : (
        <>
          {!hasHomeArea ? (
            <p className="text-sm text-ink-soft">No home area set — add one to enable out-of-area alerts.</p>
          ) : (
            <p className="text-sm text-ink-soft">
              Home center: {Number(draft.centerLat).toFixed(4)}, {Number(draft.centerLng).toFixed(4)}
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => void useCurrentLocation()}
            disabled={locateState === "reading"}
            className="min-h-11"
          >
            {locateState === "reading" ? "Reading car's location…" : "Use car's current location"}
          </Button>
          <p className="text-xs text-muted">Tap while the car is parked at home. May briefly wake the car (a fraction of a cent).</p>
          {locateNote ? <p role="alert" className="text-sm text-danger">{locateNote}</p> : null}

          <div>
            <span id="home-area-radius-label" className="mb-1.5 block text-xs font-medium text-muted">Radius</span>
            <div role="group" aria-labelledby="home-area-radius-label">
              <Segmented
                options={[
                  ...HOME_AREA_RADIUS_PRESETS_MI.map((mi) => ({ value: String(mi), label: `${mi} mi` })),
                  { value: "custom", label: "Custom" },
                ]}
                value={preset === "custom" ? "custom" : String(preset)}
                onChange={(v) => setField("radiusMi", v === "custom" ? "" : v)}
              />
            </div>
            {preset === "custom" ? (
              <Field id="home-area-radius-custom" label="Custom radius (miles)" error={errors.radiusMi}>
                <input
                  id="home-area-radius-custom"
                  name="homeAreaRadiusMi"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  value={draft.radiusMi}
                  onChange={(e) => setField("radiusMi", e.target.value)}
                  className="field mt-2"
                  placeholder="e.g. 75"
                  aria-invalid={errors.radiusMi ? true : undefined}
                  aria-describedby={errors.radiusMi ? "home-area-radius-custom-error" : undefined}
                />
              </Field>
            ) : errors.radiusMi ? (
              <p className="mt-1.5 text-xs text-danger">{errors.radiusMi}</p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            className="min-h-11 text-left text-sm font-medium text-brand underline-offset-2 hover:underline"
            aria-expanded={showManual}
          >
            {showManual ? "Hide manual coordinates" : "Enter coordinates manually"}
          </button>
          {showManual ? (
            <div className="grid grid-cols-2 gap-3">
              <Field id="home-area-lat" label="Latitude" error={errors.centerLat}>
                <input
                  id="home-area-lat"
                  name="homeAreaCenterLat"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={draft.centerLat}
                  onChange={(e) => setField("centerLat", e.target.value)}
                  className="field"
                  placeholder="e.g. 38.6270"
                  aria-invalid={errors.centerLat ? true : undefined}
                  aria-describedby={errors.centerLat ? "home-area-lat-error" : undefined}
                />
              </Field>
              <Field id="home-area-lng" label="Longitude" error={errors.centerLng}>
                <input
                  id="home-area-lng"
                  name="homeAreaCenterLng"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={draft.centerLng}
                  onChange={(e) => setField("centerLng", e.target.value)}
                  className="field"
                  placeholder="e.g. -90.1994"
                  aria-invalid={errors.centerLng ? true : undefined}
                  aria-describedby={errors.centerLng ? "home-area-lng-error" : undefined}
                />
              </Field>
            </div>
          ) : null}

          {saveError ? <p role="alert" className="text-sm text-danger">{saveError}</p> : null}
          <div className="flex items-center gap-3">
            <Button type="button" variant="secondary" onClick={() => void save()} disabled={saveState === "saving"} className="min-h-11">
              {saveState === "saving" ? "Saving…" : "Save home area"}
            </Button>
            {saveState === "saved" ? <span className="text-sm font-medium text-good">Saved</span> : null}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Battery capacity (G2 remediation) ─────────────────────────────────────
 *
 * Owner-editable usable pack capacity (kWh), used only to estimate a
 * segmented ac_home charge session's kWhAdded from its battery-percent delta
 * (lib/owner/charge-sessions.ts's kWhFromBatteryDelta). Never guest-visible.
 * Storage: `onlyevs_vehicles.battery_capacity_kwh` (additive column already
 * migrated — see supabase/migrations/
 * 20260817090000_onlyevs_vehicle_telemetry_ledger.sql). Same rationale as
 * HomeAreaFieldGroup above for why this is its own independent load/save
 * cycle rather than folded into VehicleInput/onSubmit: `lib/owner/types.ts`
 * and `lib/owner/vehicle-repository.ts` are owned by a different lane in
 * this build, and this field must not require editing either file.
 */

const MAX_REASONABLE_BATTERY_CAPACITY_KWH = 200;

/** Blank clears the capacity (ac_home sessions render kWh as an honest
 * unknown again); anything else must be a finite, positive, plausible pack
 * size. Never silently clamps or rounds. */
export function validateBatteryCapacityDraft(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return "Enter a number, e.g. 75.";
  if (n <= 0) return "Capacity must be greater than 0 kWh.";
  if (n > MAX_REASONABLE_BATTERY_CAPACITY_KWH) return `Capacity must be ${MAX_REASONABLE_BATTERY_CAPACITY_KWH} kWh or less.`;
  return null;
}

/** Blank -> null (clears the capacity); a validated draft's numeric value
 * otherwise. Callers must check validateBatteryCapacityDraft first. */
export function parseBatteryCapacityDraft(raw: string): number | null {
  if (validateBatteryCapacityDraft(raw) !== null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : Number(trimmed);
}

function BatteryCapacityFieldGroup({ vehicleId }: { vehicleId: string }) {
  const { workspace } = useOwnerTenant();
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    let cancelled = false;
    if (!workspace) { setLoaded(true); return; }
    (async () => {
      const { data } = await createClient()
        .from("onlyevs_vehicles")
        .select("battery_capacity_kwh")
        .eq("workspace_id", workspace.id)
        .eq("shop_slug", workspace.shopSlug)
        .eq("id", vehicleId)
        .maybeSingle<{ battery_capacity_kwh: number | null }>();
      if (cancelled) return;
      if (data?.battery_capacity_kwh !== null && data?.battery_capacity_kwh !== undefined) {
        setDraft(String(data.battery_capacity_kwh));
      }
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [workspace, vehicleId]);

  function onChange(value: string) {
    setDraft(value);
    setSaveState("idle");
    setError(validateBatteryCapacityDraft(value));
  }

  async function save() {
    const validationError = validateBatteryCapacityDraft(draft);
    if (validationError) { setError(validationError); return; }
    if (!workspace) return;
    setError(null);
    setSaveState("saving");
    const { error: writeError } = await createClient()
      .from("onlyevs_vehicles")
      .update({ battery_capacity_kwh: parseBatteryCapacityDraft(draft) })
      .eq("workspace_id", workspace.id)
      .eq("shop_slug", workspace.shopSlug)
      .eq("id", vehicleId);
    if (writeError) { setSaveState("error"); return; }
    setSaveState("saved");
  }

  return (
    <div className="space-y-2 rounded-lg border border-line p-4">
      <Field id="vehicle-batteryCapacityKwh" label="Battery capacity (kWh)" error={error ?? undefined}>
        <input
          id="vehicle-batteryCapacityKwh"
          name="batteryCapacityKwh"
          type="number"
          inputMode="decimal"
          step="0.1"
          min={0}
          disabled={!loaded}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          className="field"
          placeholder="e.g. 75"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "vehicle-batteryCapacityKwh-error" : undefined}
        />
      </Field>
      <p className="text-xs leading-relaxed text-muted">
        Used to estimate home-charging energy from battery-percent readings. Leave blank to show
        home sessions&apos; kWh as unknown rather than a guessed figure.
      </p>
      {saveState === "error" ? <p role="alert" className="text-sm text-danger">The battery capacity couldn&apos;t be saved. Try again.</p> : null}
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => void save()} disabled={!loaded || saveState === "saving"} className="min-h-11">
          {saveState === "saving" ? "Saving…" : "Save battery capacity"}
        </Button>
        {saveState === "saved" ? <span className="text-sm font-medium text-good">Saved</span> : null}
      </div>
    </div>
  );
}

export function VehicleForm({
  mode,
  initialValues,
  globalPolicyPct,
  onSubmit,
  onCancel,
  submitLabel,
  vehicleId,
}: VehicleFormProps) {
  const [values, setValues] = useState<FormValues>(() => initialFormValues(initialValues));
  const [errors, setErrors] = useState<Partial<Record<keyof VehicleInput, string>>>({});
  const [currentYear, setCurrentYear] = useState(SSR_FALLBACK_YEAR);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const year = new Date().getFullYear();
    setCurrentYear(year);
    // A brand-new vehicle's default Year still shows the SSR fallback at
    // this point — sync it to the real year now that we're past hydration.
    if (initialValues?.year === undefined) {
      setValues((prev) =>
        prev.year === String(SSR_FALLBACK_YEAR) ? { ...prev, year: String(year) } : prev,
      );
    }
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof FormValues>(key: K, v: FormValues[K]) {
    setSubmitError(null);
    setValues((prev) => {
      const next = { ...prev, [key]: v };
      // Once errors are showing, keep them live so a corrected field clears
      // its message immediately instead of staying stuck until resubmit.
      setErrors((prevErrors) =>
        Object.keys(prevErrors).length > 0
          ? validateVehicleInput(toVehicleInput(next, initialValues), currentYear)
          : prevErrors,
      );
      return next;
    });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = toVehicleInput(values, initialValues);
    const fieldErrors = validateVehicleInput(input, currentYear);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(input);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Vehicle changes could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  const defaultSubmitLabel = mode === "create" ? "Add vehicle" : "Save changes";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off" noValidate>
      <div className="rounded-lg border border-line bg-surface px-3.5 py-3 text-xs leading-relaxed text-muted">
        Editing here updates the private workspace fleet. Choose the guest-facing vehicle in
        Settings to publish its safe presentation fields to the walkthrough.
      </div>

      {submitError ? (
        <div role="alert" className="rounded-lg border border-danger/20 bg-danger/[0.04] px-3.5 py-3 text-sm text-danger">
          {submitError}
        </div>
      ) : null}

      <Field id="vehicle-displayName" label="Display name" error={errors.displayName}>
        <input
          id="vehicle-displayName"
          name="displayName"
          type="text"
          autoComplete="off"
          required
          value={values.displayName}
          onChange={(e) => set("displayName", e.target.value)}
          className="field"
          placeholder="e.g. 2024 Model 3"
          aria-invalid={errors.displayName ? true : undefined}
          aria-describedby={errors.displayName ? "vehicle-displayName-error" : undefined}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field id="vehicle-model" label="Model" error={errors.model}>
          <input
            id="vehicle-model"
            name="model"
            type="text"
            autoComplete="off"
            required
            value={values.model}
            onChange={(e) => set("model", e.target.value)}
            className="field"
            placeholder="Model 3"
            aria-invalid={errors.model ? true : undefined}
            aria-describedby={errors.model ? "vehicle-model-error" : undefined}
          />
        </Field>
        <Field id="vehicle-trim" label="Trim" error={errors.trim}>
          <input
            id="vehicle-trim"
            name="trim"
            type="text"
            autoComplete="off"
            required
            value={values.trim}
            onChange={(e) => set("trim", e.target.value)}
            className="field"
            placeholder="Long Range"
            aria-invalid={errors.trim ? true : undefined}
            aria-describedby={errors.trim ? "vehicle-trim-error" : undefined}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field id="vehicle-year" label="Year" error={errors.year}>
          <input
            id="vehicle-year"
            name="year"
            type="number"
            inputMode="numeric"
            autoComplete="off"
            required
            value={values.year}
            onChange={(e) => set("year", e.target.value)}
            className="field"
            aria-invalid={errors.year ? true : undefined}
            aria-describedby={errors.year ? "vehicle-year-error" : undefined}
          />
        </Field>
        <Field id="vehicle-color" label="Color" error={errors.color}>
          <input
            id="vehicle-color"
            name="color"
            type="text"
            autoComplete="off"
            required
            value={values.color}
            onChange={(e) => set("color", e.target.value)}
            className="field"
            placeholder="Pearl White"
            aria-invalid={errors.color ? true : undefined}
            aria-describedby={errors.color ? "vehicle-color-error" : undefined}
          />
        </Field>
      </div>

      <Field id="vehicle-interior" label="Interior color">
        <input
          id="vehicle-interior"
          name="interior"
          type="text"
          autoComplete="off"
          value={values.interior}
          onChange={(e) => set("interior", e.target.value)}
          className="field"
          placeholder="e.g. White Interior"
        />
      </Field>

      <Field id="vehicle-wheelType" label="Wheels">
        <input
          id="vehicle-wheelType"
          name="wheelType"
          type="text"
          autoComplete="off"
          value={values.wheelType}
          onChange={(e) => set("wheelType", e.target.value)}
          className="field"
          placeholder={'e.g. 20" Warp Wheels'}
        />
      </Field>

      {vehicleId ? (
        <BatteryCapacityFieldGroup vehicleId={vehicleId} />
      ) : (
        <div className="rounded-lg border border-line bg-surface px-3.5 py-3 text-xs leading-relaxed text-muted">
          Save this vehicle first, then set its battery capacity from the vehicle page — used to
          estimate home-charging energy.
        </div>
      )}

      <div>
        <span id="vehicle-shifter-label" className="mb-1.5 block text-xs font-medium text-muted">
          Shifter
        </span>
        <div role="group" aria-labelledby="vehicle-shifter-label">
          <Segmented
            options={[
              { value: "stalk", label: "Column stalk" },
              { value: "screen", label: "Touchscreen" },
              { value: "console", label: "Center console" },
            ]}
            value={values.shifter}
            onChange={(v) => set("shifter", v)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field id="vehicle-licensePlate" label="License plate">
          <input
            id="vehicle-licensePlate"
            name="licensePlate"
            type="text"
            autoComplete="off"
            value={values.licensePlate}
            onChange={(e) => set("licensePlate", e.target.value)}
            className="field"
            placeholder="Optional"
          />
        </Field>
        <Field id="vehicle-vin" label="VIN">
          <input
            id="vehicle-vin"
            name="vin"
            type="text"
            autoComplete="off"
            value={values.vin}
            onChange={(e) => set("vin", e.target.value)}
            className="field"
            placeholder="Optional"
          />
        </Field>
      </div>

      <Field
        id="vehicle-returnChargeLevelPct"
        label="Return charge policy override"
        error={errors.returnChargeLevelPct}
      >
        <input
          id="vehicle-returnChargeLevelPct"
          name="returnChargeLevelPct"
          type="number"
          inputMode="numeric"
          autoComplete="off"
          min={10}
          max={100}
          value={values.returnChargeLevelPct}
          onChange={(e) => set("returnChargeLevelPct", e.target.value)}
          className="field"
          placeholder={`Global: ${globalPolicyPct}%`}
          aria-invalid={errors.returnChargeLevelPct ? true : undefined}
          aria-describedby={
            errors.returnChargeLevelPct ? "vehicle-returnChargeLevelPct-error" : undefined
          }
        />
      </Field>

      <Field id="vehicle-notes" label="Notes">
        <textarea
          id="vehicle-notes"
          name="notes"
          rows={3}
          autoComplete="off"
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          className="field resize-none"
          placeholder="Anything the next host should know…"
        />
      </Field>

      {vehicleId ? (
        <HomeAreaFieldGroup vehicleId={vehicleId} />
      ) : (
        <div className="rounded-lg border border-line bg-surface px-3.5 py-3 text-xs leading-relaxed text-muted">
          Save this vehicle first, then set its home area from the vehicle page — used only to flag
          out-of-area driving during an active trip.
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : submitLabel ?? defaultSubmitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
