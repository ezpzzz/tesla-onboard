"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { Badge, Button, Card } from "@/components/ui";
import {
  fetchWorkspaceDomains,
  requestWorkspaceDomain,
  requestWorkspaceDomainRemoval,
} from "@/lib/owner/custom-domain-repository";
import { vehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import type { CustomDomainStatus, WorkspaceCustomDomain } from "@/lib/custom-domain";

const STATUS_COPY: Record<CustomDomainStatus, string> = {
  requested: "Queued for provider attachment",
  pending_verification: "Add the ownership TXT record below",
  pending_dns: "Update DNS routing with the record below",
  active: "Ownership and DNS verified; Vercel manages TLS",
  error: "Provisioning needs attention",
  removal_requested: "Queued for safe provider removal",
};

function tone(status: CustomDomainStatus): "good" | "warn" | "neutral" {
  return status === "active" ? "good" : status === "error" ? "warn" : "neutral";
}

export function WorkspaceDomains() {
  const { workspace, persistence } = useOwnerTenant();
  const scope = useMemo(() => vehicleWorkspaceScope(workspace?.tenantRef), [workspace?.tenantRef]);
  const [domains, setDomains] = useState<WorkspaceCustomDomain[]>([]);
  const [hostname, setHostname] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setDomains([]);
    setMessage(null);
    if (!scope || persistence !== "workspace") {
      setDomains([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchWorkspaceDomains(scope);
      if (version === requestVersion.current) setDomains(next);
    } catch (error) {
      if (version === requestVersion.current) {
        setMessage(error instanceof Error ? error.message : "Custom domains could not be loaded.");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [persistence, scope]);

  useEffect(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!scope) return;
    setBusy(true);
    setMessage(null);
    try {
      const domain = await requestWorkspaceDomain(scope, hostname);
      setDomains((current) => [...current, domain]);
      setHostname("");
      setMessage("Domain requested. Provider attachment and DNS checks run asynchronously.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The domain could not be requested.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(domain: WorkspaceCustomDomain) {
    if (!window.confirm(`Remove ${domain.hostname} from this workspace?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      await requestWorkspaceDomainRemoval(domain);
      await load();
      setMessage("Domain removal queued. It stays mapped until the provider confirms detachment.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The domain could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  if (!workspace || persistence !== "workspace") return null;
  return (
    <section className="space-y-3" aria-labelledby="domains-title">
      <div>
        <h2 id="domains-title" className="text-base font-semibold text-ink">Custom domains</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Connect a domain you control. It cannot serve this workspace until provider attachment, ownership, and DNS routing pass; Vercel then manages TLS.
          Guest email verification completes securely on the canonical evhost.app domain, then returns to the same branded workspace.
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="onlyevs-custom-domain" className="sr-only">Custom domain hostname</label>
        <input
          id="onlyevs-custom-domain"
          required
          name="onlyevs-custom-domain"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          placeholder="welcome.example.com"
          value={hostname}
          onChange={(event) => setHostname(event.target.value)}
          className="min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-white px-3.5 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
        <Button type="submit" disabled={busy}>Add domain</Button>
      </form>
      {message ? <p role="status" className="text-sm leading-relaxed text-muted">{message}</p> : null}
      {loading ? <p className="text-sm text-muted">Loading domains…</p> : null}
      {domains.map((domain) => (
        <Card key={domain.id} className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-all font-medium text-ink">{domain.hostname}</p>
              <p className="mt-1 text-xs text-muted">{STATUS_COPY[domain.status]}</p>
            </div>
            <Badge tone={tone(domain.status)}>{domain.status.replaceAll("_", " ")}</Badge>
          </div>
          {domain.verification.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-line bg-surface p-3 text-xs">
              {domain.verification.map((record, index) => (
                <dl key={`${record.type}-${record.name}-${index}`} className="grid grid-cols-[70px_1fr] gap-x-2 gap-y-1 border-b border-line py-2 last:border-0">
                  <dt className="text-muted">Type</dt><dd className="font-medium text-ink">{record.type}</dd>
                  <dt className="text-muted">Name</dt><dd className="break-all font-mono text-ink">{record.name}</dd>
                  <dt className="text-muted">Value</dt><dd className="break-all font-mono text-ink">{record.value}</dd>
                </dl>
              ))}
            </div>
          ) : null}
          {domain.lastErrorCode ? <p className="text-xs text-danger">{domain.lastErrorCode.replaceAll("_", " ")}</p> : null}
          <div className="flex flex-wrap gap-2">
            {domain.status === "active" ? (
              <a href={`https://${domain.hostname}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-medium text-ink hover:bg-surface">Open</a>
            ) : null}
            {domain.status !== "removal_requested" ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove(domain)}>Remove</Button>
            ) : null}
          </div>
        </Card>
      ))}
    </section>
  );
}
