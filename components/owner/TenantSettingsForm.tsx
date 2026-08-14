"use client";

import { useEffect, useRef, useState } from "react";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import {
  normalizeTenantConfig,
  tenantSetupCompletedAt,
  type TenantConfig,
} from "@/lib/tenant-config";
import { useVehicleState } from "@/lib/owner/vehicle-state";
import {
  customTenantCar,
  tenantCarForSettingsDraft,
  tenantCarFromVehicle,
  tenantCarMatchesVehicle,
} from "@/lib/tenant-vehicle";
import { Button, Card } from "@/components/ui";
import { VehicleArtwork } from "@/components/vehicle/VehicleArtwork";

function Field({
  label,
  value,
  onChange,
  type = "text",
  multiline = false,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel" | "number";
  multiline?: boolean;
  required?: boolean;
}) {
  const className =
    "mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-3 text-[15px] text-ink outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15";
  return (
    <label className="block text-sm font-medium text-ink">
      {label}
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          required={required}
          className={`${className} resize-y leading-relaxed`}
        />
      ) : (
        <input
          type={type}
          value={value}
          required={required}
          onChange={(event) => onChange(event.target.value)}
          className={className}
        />
      )}
    </label>
  );
}

export function TenantSettingsForm({
  onSaved,
  submitLabel = "Save settings",
}: {
  onSaved?: () => void;
  submitLabel?: string;
}) {
  const { config } = useTenantConfig();
  const { workspace, workspaces, loading, error, persistence, setWorkspace, saveConfig } = useOwnerTenant();
  const { vehicles, hydrated: vehiclesHydrated, error: vehicleError } = useVehicleState();
  const [draft, setDraft] = useState<TenantConfig>(config);
  const [rules, setRules] = useState(config.houseRules.join("\n"));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const initializedConfig = useRef<{
    config: TenantConfig;
    workspaceKey: string | null;
  } | null>(null);
  const carEditedSinceConfig = useRef(false);

  useEffect(() => {
    setDraft(config);
    setRules(config.houseRules.join("\n"));
    setMessage(null);
    initializedConfig.current = null;
    carEditedSinceConfig.current = false;
  }, [config, workspace?.key]);

  useEffect(() => {
    if (!vehiclesHydrated) return;
    const workspaceKey = workspace?.key ?? null;
    if (
      initializedConfig.current?.config === config
      && initializedConfig.current.workspaceKey === workspaceKey
    ) {
      return;
    }

    setDraft((current) => carEditedSinceConfig.current
      ? current
      : {
          ...current,
          car: tenantCarForSettingsDraft(config.car, vehicles),
        });
    initializedConfig.current = { config, workspaceKey };
  }, [config, vehicles, vehiclesHydrated, workspace?.key]);

  function patchRoot(patch: Partial<TenantConfig>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function useFleetVehicle(vehicleId: string) {
    carEditedSinceConfig.current = true;
    if (!vehicleId) {
      setDraft((current) => ({
        ...current,
        car: customTenantCar(current.car, {}),
      }));
      return;
    }
    const vehicle = vehicles.find((item) => item.id === vehicleId);
    if (!vehicle) return;
    patchRoot({ car: tenantCarFromVehicle(vehicle) });
  }

  function patchCar(patch: Partial<TenantConfig["car"]>) {
    carEditedSinceConfig.current = true;
    setDraft((current) => ({
      ...current,
      car: customTenantCar(current.car, patch),
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      let car = draft.car;
      if (car.sourceVehicleId) {
        const source = vehicles.find((vehicle) =>
          vehicle.guestSourceId === car.sourceVehicleId && vehicle.status === "active"
        );
        if (!source) {
          throw new Error(
            vehicleError
              ? `The private workspace fleet could not be loaded: ${vehicleError}`
              : "The selected fleet vehicle is no longer active in this workspace. Choose another vehicle or switch to a custom guest vehicle.",
          );
        }
        // The linked fleet record is authoritative. Re-materialize at the
        // save boundary so a stale form can never publish an older spec.
        car = tenantCarFromVehicle(source);
      }
      const next = normalizeTenantConfig({
        ...draft,
        car,
        houseRules: rules.split("\n").map((rule) => rule.trim()).filter(Boolean),
      });
      await saveConfig(next);
      setDraft(next);
      setRules(next.houseRules.join("\n"));
      setMessage(
        persistence === "workspace"
          ? tenantSetupCompletedAt(workspace?.features) && next.car.sourceVehicleId
            ? "Saved. The published guest walkthrough now uses these workspace settings."
            : "Saved as a workspace draft. Finish fleet setup with an active linked vehicle to publish it for guests."
          : "Saved to this browser for local preview.",
      );
      onSaved?.();
    } catch (saveError) {
      setMessage(saveError instanceof Error ? saveError.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="py-8 text-center text-sm text-muted">Loading workspaces…</p>;
  if (!workspace) {
    return <Card className="p-4 text-sm leading-relaxed text-muted">{error ?? "No workspace available."}</Card>;
  }

  const activeVehicles = vehicles.filter((vehicle) => vehicle.status === "active");
  const linkedVehicle = draft.car.sourceVehicleId
    ? vehicles.find((vehicle) => vehicle.guestSourceId === draft.car.sourceVehicleId)
    : null;
  const linkedVehicleActive = linkedVehicle?.status === "active";
  const linkedVehicleCurrent = linkedVehicle
    ? tenantCarMatchesVehicle(draft.car, linkedVehicle)
    : false;

  return (
    <form onSubmit={submit} className="space-y-6">
      {workspaces.length > 1 ? (
        <label className="block text-sm font-medium text-ink">
          Sophosic workspace
          <select
            value={workspace.key}
            onChange={(event) => setWorkspace(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-3 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          >
            {workspaces.map((item) => (
              <option key={item.key} value={item.key}>{item.name}</option>
            ))}
          </select>
        </label>
      ) : null}

      <SettingsSection title="Brand & contact">
        <Field label="Company name" value={draft.companyName} onChange={(companyName) => patchRoot({ companyName })} />
        <Field label="Tagline" value={draft.tagline} onChange={(tagline) => patchRoot({ tagline })} />
        <Field label="Host name" value={draft.hostName} onChange={(hostName) => patchRoot({ hostName })} />
        <Field label="Host phone" type="tel" value={draft.hostPhone} onChange={(hostPhone) => patchRoot({ hostPhone })} />
        <Field label="Support email" type="email" value={draft.supportEmail} onChange={(supportEmail) => patchRoot({ supportEmail })} />
        <Field label="Roadside phone" type="tel" value={draft.roadsidePhone} onChange={(roadsidePhone) => patchRoot({ roadsidePhone })} />
      </SettingsSection>

      <SettingsSection title="Guest vehicle">
        {vehicleError ? (
          <div role="alert" className="rounded-xl border border-danger/20 bg-danger/[0.04] px-3.5 py-3 text-sm text-danger">
            {vehicleError}
          </div>
        ) : null}
        {draft.car.model ? (
          <VehicleArtwork
            model={draft.car.model}
            color={draft.car.color}
            trim={draft.car.trim}
            wheelType={draft.car.wheelType}
            interior={draft.car.interior}
            interiorCode={draft.car.teslaInteriorCode}
            paintCode={draft.car.teslaPaintCode}
            year={draft.car.year}
            configurationVerified={Boolean(draft.car.sourceVehicleId)}
            decorative
            className="h-44 rounded-xl border border-line"
          />
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-surface px-4 py-8 text-center text-sm text-muted">
            No guest vehicle is configured.
          </div>
        )}
        {vehiclesHydrated && activeVehicles.length > 0 ? (
          <label className="block text-sm font-medium text-ink">
            Use a fleet vehicle
            <select
              value={linkedVehicle?.id ?? (draft.car.sourceVehicleId ? "unavailable" : "")}
              onChange={(event) => useFleetVehicle(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-3 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            >
              <option value="">Custom / unlinked guest vehicle</option>
              {draft.car.sourceVehicleId && !linkedVehicleActive ? (
                <option value="unavailable">Linked vehicle unavailable</option>
              ) : null}
              {activeVehicles.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.displayName} — {vehicle.year} {vehicle.model} {vehicle.trim}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="rounded-xl border border-line bg-surface px-3.5 py-3 text-sm leading-relaxed text-muted">
          {draft.car.sourceVehicleId
            ? !linkedVehicleActive
              ? "This linked fleet vehicle is unavailable in this workspace. Select another active vehicle before saving."
              : linkedVehicleCurrent
                ? `Linked to ${linkedVehicle?.displayName ?? "the selected vehicle"}. Guest and owner surfaces use the same exact-spec snapshot.`
                : `Linked to ${linkedVehicle?.displayName ?? "the selected vehicle"}. Its fleet details changed; saving will publish the latest exact-spec snapshot.`
            : activeVehicles.length > 1
              ? "Choose which imported fleet vehicle guests will use. Multiple active vehicles are never selected automatically."
              : "Guest onboarding is paused. Link an active workspace fleet vehicle before publishing so owner and guest details cannot drift."}
        </div>
        <Field label="Model" value={draft.car.model} onChange={(model) => patchCar({ model })} />
        <Field label="Trim" value={draft.car.trim} onChange={(trim) => patchCar({ trim })} />
        <Field label="Year" type="number" value={draft.car.year ? String(draft.car.year) : ""} onChange={(value) => patchCar({ year: Number(value) })} />
        <Field label="Exterior color" value={draft.car.color} onChange={(color) => patchCar({ color })} />
        <Field required={false} label="Interior" value={draft.car.interior ?? ""} onChange={(interior) => patchCar({ interior: interior || null })} />
        <Field required={false} label="Wheel package or Tesla code" value={draft.car.wheelType ?? ""} onChange={(wheelType) => patchCar({ wheelType: wheelType || null })} />
        <Field required={false} label="Tesla paint option code" value={draft.car.teslaPaintCode ?? ""} onChange={(teslaPaintCode) => patchCar({ teslaPaintCode: teslaPaintCode || null })} />
        <Field required={false} label="Tesla interior option code" value={draft.car.teslaInteriorCode ?? ""} onChange={(teslaInteriorCode) => patchCar({ teslaInteriorCode: teslaInteriorCode || null })} />
        <label className="block text-sm font-medium text-ink">
          Shifter
          <select
            value={draft.car.shifter}
            onChange={(event) => {
              const value = event.target.value;
              patchCar({
                shifter: value === "stalk" || value === "console" ? value : "screen",
              });
            }}
            className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-3 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          >
            <option value="screen">Touchscreen</option>
            <option value="stalk">Steering-column stalk</option>
            <option value="console">Center-console selector</option>
          </select>
        </label>
      </SettingsSection>

      <SettingsSection title="Rental policy">
        <Field multiline label="Key access" value={draft.rental.keyAccess} onChange={(keyAccess) => patchRoot({ rental: { ...draft.rental, keyAccess } })} />
        <Field multiline label="Charge access" value={draft.rental.chargeAccess} onChange={(chargeAccess) => patchRoot({ rental: { ...draft.rental, chargeAccess } })} />
        <Field multiline label="Charging policy" value={draft.rental.chargingPolicy} onChange={(chargingPolicy) => patchRoot({ rental: { ...draft.rental, chargingPolicy } })} />
        <Field label="Return charge level" value={draft.rental.returnChargeLevel} onChange={(returnChargeLevel) => patchRoot({ rental: { ...draft.rental, returnChargeLevel } })} />
        <Field multiline label="Skip-charge option" value={draft.rental.skipChargeOption} onChange={(skipChargeOption) => patchRoot({ rental: { ...draft.rental, skipChargeOption } })} />
        <Field multiline label="Pickup note" value={draft.rental.pickupNote} onChange={(pickupNote) => patchRoot({ rental: { ...draft.rental, pickupNote } })} />
        <Field multiline label="Return note" value={draft.rental.returnNote} onChange={(returnNote) => patchRoot({ rental: { ...draft.rental, returnNote } })} />
        <Field multiline label="Parking note" value={draft.rental.parkingNote} onChange={(parkingNote) => patchRoot({ rental: { ...draft.rental, parkingNote } })} />
      </SettingsSection>

      <SettingsSection title="House rules">
        <Field
          multiline
          label="One rule per line"
          value={rules}
          onChange={setRules}
        />
      </SettingsSection>

      <div className="rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed text-muted">
        {persistence === "workspace"
          ? "Tenant settings are saved to your Sophosic workspace. "
          : "Demo-mode settings stay in this browser and are not published. "}
        Supabase keys, Tesla OAuth secrets,
        callback URLs, and cookie-encryption secrets remain platform-managed and are never exposed
        in this form.
      </div>

      {message ? (
        <p role="status" className="text-sm leading-relaxed text-muted">{message}</p>
      ) : null}
      <Button fullWidth type="submit" disabled={saving}>
        {saving ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <Card className="space-y-4 p-4">{children}</Card>
    </section>
  );
}
