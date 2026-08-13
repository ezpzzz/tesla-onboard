"use client";

/**
 * Shared vehicle create/edit form — the single source of the vehicle field
 * set, used by both /owner/vehicles/new (mode "create") and embedded on
 * /owner/vehicles/[id] (mode "edit"). Pure controlled form: local field
 * state (strings, so number/nullable fields can be empty mid-edit),
 * validated with validateVehicleInput on submit, and onSubmit only fires
 * once every field passes.
 *
 * Note: this form edits the *owner dashboard's* record of the vehicle
 * (stats, policy overrides, notes) — it never writes to hostConfig, so it
 * intentionally cannot change what a guest sees in the onboarding
 * walkthrough. See the hint copy below.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { VehicleInput } from "@/lib/owner/types";
import { validateVehicleInput } from "@/lib/owner/vehicle-state";
import { resolveTeslaVehicleMedia } from "@/lib/vehicle-media";
import { Button, Segmented } from "../ui";

// Fixed SSR-safe fallback for "current year" — reading Date.now() during
// render risks server/client clock skew producing a hydration mismatch.
// The real year is patched in via a mount effect below, after hydration.
const SSR_FALLBACK_YEAR = 2026;

interface VehicleFormProps {
  mode: "create" | "edit";
  initialValues?: Partial<VehicleInput>;
  globalPolicyPct: number;
  onSubmit: (input: VehicleInput) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

interface FormValues {
  displayName: string;
  model: string;
  trim: string;
  year: string;
  color: string;
  shifter: "stalk" | "screen";
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
    wheelType: preserved?.wheelType ?? null,
    teslaSpecSource: preserved?.teslaSpecSource ?? null,
    // Recompute from the edited tuple. Retaining an older URL here could show
    // the wrong paint or wheels after an owner correction.
    media: resolveTeslaVehicleMedia(
      values.model.trim(),
      values.color.trim(),
      values.trim.trim(),
      preserved?.wheelType,
      Number(values.year),
    ),
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

export function VehicleForm({
  mode,
  initialValues,
  globalPolicyPct,
  onSubmit,
  onCancel,
  submitLabel,
}: VehicleFormProps) {
  const [values, setValues] = useState<FormValues>(() => initialFormValues(initialValues));
  const [errors, setErrors] = useState<Partial<Record<keyof VehicleInput, string>>>({});
  const [currentYear, setCurrentYear] = useState(SSR_FALLBACK_YEAR);

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

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = toVehicleInput(values, initialValues);
    const fieldErrors = validateVehicleInput(input, currentYear);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    onSubmit(input);
  }

  const defaultSubmitLabel = mode === "create" ? "Add vehicle" : "Save changes";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off" noValidate>
      <div className="rounded-2xl border border-line bg-surface px-3.5 py-3 text-xs leading-relaxed text-muted">
        Editing here doesn&apos;t change what guests see in the walkthrough — that still comes
        from the host config.
      </div>

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

      <div>
        <span id="vehicle-shifter-label" className="mb-1.5 block text-xs font-medium text-muted">
          Shifter
        </span>
        <div role="group" aria-labelledby="vehicle-shifter-label">
          <Segmented
            options={[
              { value: "stalk", label: "Column stalk" },
              { value: "screen", label: "Touchscreen" },
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

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit">{submitLabel ?? defaultSubmitLabel}</Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
