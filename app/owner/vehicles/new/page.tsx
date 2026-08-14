"use client";

/**
 * Add-vehicle form. On submit, hands the new id straight to the vehicle
 * detail page rather than back to the list, so a host lands where they can
 * immediately double-check what they just entered.
 */

import { useRouter } from "next/navigation";
import { useVehicleState } from "@/lib/owner/vehicle-state";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { parseReturnPolicyPct } from "@/lib/owner/derive";
import { VehicleForm } from "@/components/owner/vehicle-form";
import { Card } from "@/components/ui";
import type { VehicleInput } from "@/lib/owner/types";

export default function NewVehiclePage() {
  const { config } = useTenantConfig();
  const router = useRouter();
  const { addVehicle, hydrated } = useVehicleState();
  const policyPct = parseReturnPolicyPct(config.rental.returnChargeLevel);

  if (!hydrated) {
    return <Card className="p-6 text-center text-sm text-muted">Loading…</Card>;
  }

  function handleSubmit(input: VehicleInput) {
    const id = addVehicle(input);
    router.push(`/owner/vehicles/${id}`);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Add vehicle</h1>
        <p className="mt-1 text-sm text-muted">
          Add another car to your fleet. To publish it in the guest walkthrough,
          choose it from Rental settings and save.
        </p>
      </div>
      <Card className="p-4">
        <VehicleForm
          mode="create"
          globalPolicyPct={policyPct}
          onSubmit={handleSubmit}
          onCancel={() => router.push("/owner/vehicles")}
          submitLabel="Add vehicle"
        />
      </Card>
    </div>
  );
}
