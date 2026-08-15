import { PageHeader, StatePanel } from "@/components/evhost-ui";
import { OwnerIntegrations } from "@/components/owner/OwnerIntegrations";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";

export default function OwnerIntegrationsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Integrations" description="Connection health and actions for Tesla Fleet and Google Calendar." />
      {ONLYEVS_OPERATIONS_ENABLED ? <OwnerIntegrations /> : <StatePanel title="Operations integrations are disabled" detail="The guest portal remains available. Enable the operations feature only after the Tesla worker and command-proxy gates have been verified." />}
    </div>
  );
}
