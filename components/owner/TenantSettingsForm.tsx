"use client";

import { useEffect, useState } from "react";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { normalizeTenantConfig, type TenantConfig } from "@/lib/tenant-config";
import { useVehicleState } from "@/lib/owner/vehicle-state";
import { Button, Card } from "@/components/ui";

function Field({
  label,
  value,
  onChange,
  type = "text",
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "tel" | "number";
  multiline?: boolean;
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
          className={`${className} resize-y leading-relaxed`}
        />
      ) : (
        <input
          type={type}
          value={value}
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
  const { vehicles, hydrated: vehiclesHydrated } = useVehicleState();
  const [draft, setDraft] = useState<TenantConfig>(config);
  const [rules, setRules] = useState(config.houseRules.join("\n"));
  const [vehicleSource, setVehicleSource] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft(config);
    setRules(config.houseRules.join("\n"));
    setVehicleSource("");
    setMessage(null);
  }, [config, workspace?.id]);

  function patchRoot(patch: Partial<TenantConfig>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function useFleetVehicle(vehicleId: string) {
    setVehicleSource(vehicleId);
    const vehicle = vehicles.find((item) => item.id === vehicleId);
    if (!vehicle) return;
    patchRoot({
      car: {
        model: vehicle.model,
        trim: vehicle.trim,
        year: vehicle.year,
        color: vehicle.color,
        shifter: vehicle.shifter,
        wheelType: vehicle.wheelType ?? null,
        interior: vehicle.interior ?? null,
        teslaInteriorCode: vehicle.teslaInteriorCode ?? null,
        teslaPaintCode: vehicle.teslaPaintCode ?? null,
      },
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const next = normalizeTenantConfig({
        ...draft,
        houseRules: rules.split("\n").map((rule) => rule.trim()).filter(Boolean),
      });
      await saveConfig(next);
      setDraft(next);
      setRules(next.houseRules.join("\n"));
      setMessage(
        persistence === "workspace"
          ? "Saved. Guest links now use these workspace settings."
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
        {vehiclesHydrated && vehicles.some((vehicle) => vehicle.status === "active") ? (
          <label className="block text-sm font-medium text-ink">
            Use a fleet vehicle
            <select
              value={vehicleSource}
              onChange={(event) => useFleetVehicle(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-line bg-white px-3.5 py-3 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            >
              <option value="">Keep the current guest vehicle</option>
              {vehicles.filter((vehicle) => vehicle.status === "active").map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.displayName} — {vehicle.year} {vehicle.model} {vehicle.trim}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <Field label="Model" value={draft.car.model} onChange={(model) => patchRoot({ car: { ...draft.car, model } })} />
        <Field label="Trim" value={draft.car.trim} onChange={(trim) => patchRoot({ car: { ...draft.car, trim } })} />
        <Field label="Year" type="number" value={String(draft.car.year)} onChange={(value) => patchRoot({ car: { ...draft.car, year: Number(value) } })} />
        <Field label="Exterior color" value={draft.car.color} onChange={(color) => patchRoot({ car: { ...draft.car, color } })} />
        <Field label="Interior" value={draft.car.interior ?? ""} onChange={(interior) => patchRoot({ car: { ...draft.car, interior: interior || null } })} />
        <Field label="Wheel package or Tesla code" value={draft.car.wheelType ?? ""} onChange={(wheelType) => patchRoot({ car: { ...draft.car, wheelType: wheelType || null } })} />
        <Field label="Tesla paint option code" value={draft.car.teslaPaintCode ?? ""} onChange={(teslaPaintCode) => patchRoot({ car: { ...draft.car, teslaPaintCode: teslaPaintCode || null } })} />
        <Field label="Tesla interior option code" value={draft.car.teslaInteriorCode ?? ""} onChange={(teslaInteriorCode) => patchRoot({ car: { ...draft.car, teslaInteriorCode: teslaInteriorCode || null } })} />
        <label className="block text-sm font-medium text-ink">
          Shifter
          <select
            value={draft.car.shifter}
            onChange={(event) => {
              const value = event.target.value;
              patchRoot({
                car: {
                  ...draft.car,
                  shifter: value === "stalk" || value === "console" ? value : "screen",
                },
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
