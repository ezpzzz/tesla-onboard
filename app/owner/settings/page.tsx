import { TenantSettingsForm } from "@/components/owner/TenantSettingsForm";
import { OwnerIntegrations } from "@/components/owner/OwnerIntegrations";
import { WorkspaceDomains } from "@/components/owner/WorkspaceDomains";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";

export default function OwnerSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Rental settings</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Brand, contact, vehicle, and policy details shown in this workspace&apos;s guest walkthrough.
        </p>
      </div>
      {ONLYEVS_OPERATIONS_ENABLED ? <OwnerIntegrations /> : null}
      {ONLYEVS_OPERATIONS_ENABLED ? <WorkspaceDomains /> : null}
      <TenantSettingsForm />
    </div>
  );
}
