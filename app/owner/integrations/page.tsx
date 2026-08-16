import { PageHeader } from "@/components/evhost-ui";
import { OwnerIntegrations } from "@/components/owner/OwnerIntegrations";
import { getOwnerIntegrationCapabilities } from "@/lib/owner/integration-capabilities";

export default function OwnerIntegrationsPage() {
  const capabilities = getOwnerIntegrationCapabilities();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Connections" title="Integrations" description="Connection health and actions for Tesla Fleet, Google Calendar, and private Turo email intake." />
      <OwnerIntegrations capabilities={capabilities} />
    </div>
  );
}
