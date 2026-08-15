"use client";

import { useState } from "react";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { parseReturnPolicyPct } from "@/lib/owner/derive";
import { useVehicleState } from "@/lib/owner/vehicle-state";
import {
  mergePreservingOwnerFields,
  teslaKeyOf,
  vehicleInputFromTesla,
} from "@/lib/owner/import-mapping";
import { VehicleForm } from "@/components/owner/vehicle-form";
import { Badge, Button, Card, StepFrame, cn } from "@/components/ui";
import { EmptyState } from "@/components/owner/owner-ui";
import { VehicleArtwork } from "@/components/vehicle/VehicleArtwork";
import { IconArrowRight, IconCheck } from "@/components/icons";
import { indexOfSetupStep } from "@/lib/owner/setup-flow";
import type { TeslaVehicle } from "@/lib/tesla";
import type { Vehicle } from "@/lib/owner/types";
import type { SetupStepProps } from "./types";

export function ImportStep({ state, update, nav }: SetupStepProps) {
  const { config } = useTenantConfig();
  const profile = state.teslaProfile;
  const stepNumber = indexOfSetupStep(state.step) + 1;
  const {
    vehicles,
    error: vehicleError,
    addVehicle,
    updateVehicle,
    unarchiveVehicle,
  } = useVehicleState();
  const policyPct = parseReturnPolicyPct(config.rental.returnChargeLevel);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [committed, setCommitted] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const committedVehicles = committed
    .map((id) => vehicles.find((v) => v.id === id))
    .filter((v): v is NonNullable<typeof v> => !!v);

  /**
   * Resolve a Tesla vehicle to a local Vehicle it's already imported as, if
   * any. Matches the fleet itself first — by teslaImportKey, then by VIN —
   * before falling back to the setup-state ledger. The fleet is the durable
   * source: "Start over" wipes only the browser resume ledger, never the
   * workspace fleet table, so matching the fleet directly makes re-running
   * Import idempotent after a reset, in both mock mode (VIN-less personas,
   * teslaImportKey is the Tesla-side id) and live mode (VIN present).
   */
  function existingVehicleFor(tv: TeslaVehicle): Vehicle | undefined {
    const key = teslaKeyOf(tv);
    const byImportKey = vehicles.find((v) => v.teslaImportKey === key);
    if (byImportKey) return byImportKey;
    if (tv.vin) {
      const byVin = vehicles.find((v) => v.vin === tv.vin);
      if (byVin) return byVin;
    }
    const ledgerId = state.importedTeslaIds[key];
    return ledgerId ? vehicles.find((v) => v.id === ledgerId) : undefined;
  }

  function isChecked(tv: TeslaVehicle): boolean {
    const key = teslaKeyOf(tv);
    if (selected[key] !== undefined) return selected[key];
    const existing = existingVehicleFor(tv);
    return !existing || existing.status === "archived";
  }

  function toggle(key: string, checked: boolean) {
    setSelected((prev) => ({ ...prev, [key]: checked }));
  }

  async function handleImport() {
    if (!profile) return;
    // null in a patch entry means "delete this ledger key" (heals a stale
    // entry whose local vehicle is gone).
    const ledgerPatch: Record<string, string | null> = {};
    const touched: string[] = [];

    setImporting(true);
    setImportError(null);
    try {
      for (const tv of profile.vehicles) {
        const key = teslaKeyOf(tv);
        const ledgerId = state.importedTeslaIds[key];
        const existing = existingVehicleFor(tv);

        if (ledgerId && (!existing || existing.id !== ledgerId)) {
          ledgerPatch[key] = existing ? existing.id : null;
        }

        if (!isChecked(tv)) continue;

        if (existing) {
          const fresh = vehicleInputFromTesla(tv);
          await updateVehicle(existing.id, mergePreservingOwnerFields(fresh, existing));
          if (existing.status === "archived") await unarchiveVehicle(existing.id);
          touched.push(existing.id);
          continue;
        }

        const input = vehicleInputFromTesla(tv);
        const id = await addVehicle(input);
        ledgerPatch[key] = id;
        touched.push(id);
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Tesla vehicles could not be imported.");
    } finally {
      // Successful rows remain discoverable by Tesla key/VIN on retry. Keep
      // their ledger entries even if a later row failed.
      if (Object.keys(ledgerPatch).length > 0) {
        update((s) => {
          const nextLedger = { ...s.importedTeslaIds };
          for (const [key, id] of Object.entries(ledgerPatch)) {
            if (id === null) delete nextLedger[key];
            else nextLedger[key] = id;
          }
          return { importedTeslaIds: nextLedger };
        });
      }
      if (touched.length > 0) {
        setCommitted((prev) => Array.from(new Set([...prev, ...touched])));
      }
      setImporting(false);
    }
  }

  async function handleManualAdd(input: Parameters<typeof addVehicle>[0]) {
    const id = await addVehicle(input);
    setCommitted((prev) => Array.from(new Set([...prev, id])));
    setManualOpen(false);
  }

  const importedList = committedVehicles.length > 0 && (
    <div className="mt-6">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Imported
      </div>
      <div className="space-y-2">
        {committedVehicles.map((v) => {
          const expanded = expandedId === v.id;
          return (
            <Card key={v.id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : v.id)}
                className="flex min-h-[44px] w-full items-center justify-between gap-3 p-3.5 text-left"
              >
                <VehicleArtwork
                  model={v.model}
                  color={v.color}
                  trim={v.trim}
                  wheelType={v.wheelType}
                  interior={v.interior}
                  interiorCode={v.teslaInteriorCode}
                  paintCode={v.teslaPaintCode}
                  year={v.year}
                  compact
                  decorative
                  className="hidden sm:block"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink">
                    {v.displayName}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {v.trim
                      ? [v.trim, v.color, v.interior].filter(Boolean).join(" · ")
                      : "Tap to complete details"}
                  </span>
                </span>
                <Badge tone="good">
                  <IconCheck className="h-3 w-3" /> Imported
                </Badge>
              </button>
              {expanded && (
                <div className="border-t border-line p-3.5">
                  <p className="mb-3 text-xs text-muted">
                    Optional — you can finish later on the Vehicles page.
                  </p>
                  <VehicleForm
                    mode="edit"
                    initialValues={v}
                    globalPolicyPct={policyPct}
                    onSubmit={async (input) => {
                      await updateVehicle(v.id, input);
                      setExpandedId(null);
                    }}
                    onCancel={() => setExpandedId(null)}
                    submitLabel="Save details"
                  />
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );

  // No Tesla profile (skipped connect), or a connected account with no
  // vehicles on it — manual add is the primary path.
  if (!profile || profile.vehicles.length === 0) {
    return (
      <StepFrame
        inlineFooter
        footer={
          <Button fullWidth onClick={nav.next}>
            Continue <IconArrowRight className="h-4 w-4" />
          </Button>
        }
      >
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
          Step {stepNumber}
        </span>
        <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-tight">
          Add your vehicles.
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          {profile
            ? "No vehicles came back from your Tesla account — add one by hand instead."
            : "You skipped connecting a Tesla account — add vehicles to your fleet by hand."}
        </p>

        {!manualOpen && committedVehicles.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              title="No vehicles imported yet"
              detail="Add at least one car so guests have something to walk through."
            >
              <Button variant="secondary" onClick={() => setManualOpen(true)}>
                Add a vehicle manually
              </Button>
            </EmptyState>
          </div>
        ) : manualOpen ? (
          <Card className="mt-5 p-4">
            <VehicleForm
              mode="create"
              globalPolicyPct={policyPct}
              onSubmit={handleManualAdd}
              onCancel={() => setManualOpen(false)}
              submitLabel="Add vehicle"
            />
          </Card>
        ) : (
          <button
            onClick={() => setManualOpen(true)}
            className="mt-5 text-sm font-medium text-muted hover:text-ink"
          >
            + Add another vehicle manually
          </button>
        )}

        {importedList}
      </StepFrame>
    );
  }

  const hasSelections = profile.vehicles.some(isChecked);

  return (
    <StepFrame
      inlineFooter
      footer={
        <div className="space-y-2.5">
          <Button
            fullWidth
            onClick={handleImport}
            disabled={!hasSelections || importing || !!vehicleError}
          >
            {importing ? "Importing…" : "Import or refresh selected"}
          </Button>
          <Button variant="secondary" fullWidth onClick={nav.next}>
            Continue <IconArrowRight className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
        Step {stepNumber}
      </span>
      <h1 className="mt-1 text-[24px] font-semibold leading-tight tracking-tight">
        Import your vehicles.
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        New vehicles are pre-selected. Select an imported vehicle to refresh its Tesla specs.
      </p>

      {vehicleError || importError ? (
        <div role="alert" className="mt-4 rounded-lg border border-danger/20 bg-danger/[0.04] p-3.5 text-sm text-danger">
          {vehicleError ?? importError}
        </div>
      ) : null}

      <div className="mt-5 space-y-2">
        {profile.vehicles.map((tv) => {
          const key = teslaKeyOf(tv);
          const existing = existingVehicleFor(tv);
          const alreadyImported = !!existing && existing.status !== "archived";
          const isArchived = !!existing && existing.status === "archived";
          const checked = isChecked(tv);
          return (
            <label
              key={key}
              className={cn(
                "flex min-h-[44px] items-center gap-3 rounded-lg border p-3.5",
                alreadyImported ? "border-black/10 bg-white" : "border-line bg-white",
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => toggle(key, e.target.checked)}
                className="h-5 w-5 shrink-0 rounded border-line accent-brand"
              />
              <VehicleArtwork
                model={tv.model}
                color={tv.color}
                trim={tv.trim}
                wheelType={tv.wheelType}
                interior={tv.interior}
                interiorCode={tv.interiorCode}
                paintCode={tv.paintCode}
                year={tv.year}
                compact
                decorative
                className="hidden sm:block"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-ink">
                  {tv.displayName || `${tv.year ?? ""} ${tv.model}`.trim()}
                </span>
                <span className="block truncate text-sm text-muted">
                  {[tv.year, tv.trim, tv.color, tv.interior].filter(Boolean).join(" · ")
                    || tv.model}
                </span>
              </span>
              {alreadyImported && <Badge tone="good">Imported — select to refresh</Badge>}
              {isArchived && <Badge tone="warn">Removed — re-importing will restore it</Badge>}
            </label>
          );
        })}
      </div>

      {!manualOpen ? (
        <button
          onClick={() => setManualOpen(true)}
          className="mt-4 text-sm font-medium text-muted hover:text-ink"
        >
          + Add another vehicle manually
        </button>
      ) : (
        <Card className="mt-4 p-4">
          <VehicleForm
            mode="create"
            globalPolicyPct={policyPct}
            onSubmit={handleManualAdd}
            onCancel={() => setManualOpen(false)}
            submitLabel="Add vehicle"
          />
        </Card>
      )}

      {importedList}
    </StepFrame>
  );
}
