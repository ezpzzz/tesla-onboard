import { TenantSettingsForm } from "@/components/owner/TenantSettingsForm";
import { WorkspaceDomains } from "@/components/owner/WorkspaceDomains";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";
import { PageHeader } from "@/components/evhost-ui";

export default function OwnerSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader eyebrow="Workspace" title="Settings" description="Brand, contacts, rental policy, domains, and guest-facing workspace configuration." />
      {ONLYEVS_OPERATIONS_ENABLED ? <WorkspaceDomains /> : null}
      <TenantSettingsForm />
    </div>
  );
}
