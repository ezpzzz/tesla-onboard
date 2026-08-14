import {
  domainStatusFromProvider,
  normalizeVerificationRecords,
  type CustomDomainStatus,
  type DomainVerificationRecord,
} from "@/lib/custom-domain";

interface ProjectDomainResponse {
  name?: unknown;
  verified?: unknown;
  verification?: unknown;
  error?: { code?: unknown; message?: unknown };
}

interface DomainConfigResponse {
  misconfigured?: unknown;
  configuredBy?: unknown;
  recommendedIPv4?: unknown;
  recommendedCNAME?: unknown;
  error?: { code?: unknown; message?: unknown };
}

export interface DomainProviderResult {
  status: CustomDomainStatus;
  verification: DomainVerificationRecord[];
  providerProjectId: string;
}

export class DomainProviderError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "DomainProviderError";
  }
}

function providerConfig() {
  const token = process.env.VERCEL_ACCESS_TOKEN?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  if (!token || !projectId) {
    throw new DomainProviderError("provider_not_configured", "Custom-domain provisioning is not configured on this deployment.");
  }
  return { token, projectId, teamId };
}

async function vercelRequest<T>(path: string, init: RequestInit): Promise<T> {
  const config = providerConfig();
  const url = new URL(`https://api.vercel.com${path}`);
  if (config.teamId) url.searchParams.set("teamId", config.teamId);
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json().catch(() => ({})) as T & { error?: { code?: string; message?: string } };
  if (!response.ok) {
    throw new DomainProviderError(body.error?.code ?? `vercel_http_${response.status}`, body.error?.message ?? "The domain provider request failed.");
  }
  return body;
}

function projectDomainPath(projectId: string, hostname?: string, version = "v9"): string {
  const root = `/${version}/projects/${encodeURIComponent(projectId)}/domains`;
  return hostname ? `${root}/${encodeURIComponent(hostname)}` : root;
}

function dnsRecordsFromConfig(hostname: string, value: DomainConfigResponse): DomainVerificationRecord[] {
  const records: DomainVerificationRecord[] = [];
  const recommendedValues = (input: unknown): string[] => {
    const values = Array.isArray(input) ? input : [input];
    return values.flatMap((item) => {
      if (typeof item === "string" && item.trim()) return [item.trim()];
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const candidate = (item as { value?: unknown }).value;
        if (typeof candidate === "string" && candidate.trim()) return [candidate.trim()];
      }
      return [];
    });
  };
  const ipv4 = recommendedValues(value.recommendedIPv4);
  const cnames = recommendedValues(value.recommendedCNAME);
  for (const item of ipv4) records.push({ type: "A", name: hostname, value: item, reason: "Route the apex domain to Vercel." });
  for (const item of cnames) records.push({ type: "CNAME", name: hostname, value: item, reason: "Route this subdomain to Vercel." });
  return records;
}

async function reconcileProjectDomain(hostname: string, attemptVerify: boolean): Promise<DomainProviderResult> {
  const config = providerConfig();
  let domain = await vercelRequest<ProjectDomainResponse>(projectDomainPath(config.projectId, hostname), { method: "GET" });
  if (attemptVerify && domain.verified !== true) {
    domain = await vercelRequest<ProjectDomainResponse>(`${projectDomainPath(config.projectId, hostname)}/verify`, { method: "POST" });
  }
  const dns = await vercelRequest<DomainConfigResponse>(`/v6/domains/${encodeURIComponent(hostname)}/config`, { method: "GET" });
  const ownershipVerified = domain.verified === true;
  const dnsMisconfigured = typeof dns.misconfigured === "boolean" ? dns.misconfigured : null;
  return {
    providerProjectId: config.projectId,
    status: domainStatusFromProvider({ ownershipVerified, dnsMisconfigured }),
    verification: [
      ...normalizeVerificationRecords(domain.verification),
      ...dnsRecordsFromConfig(hostname, dns),
    ],
  };
}

export async function addProjectDomain(hostname: string): Promise<DomainProviderResult> {
  const config = providerConfig();
  try {
    await vercelRequest<ProjectDomainResponse>(projectDomainPath(config.projectId, undefined, "v10"), {
      method: "POST",
      body: JSON.stringify({ name: hostname }),
    });
  } catch (error) {
    // Vercel documents not_modified for a domain already attached to this
    // project. This is the expected retry outcome after an ambiguous worker
    // failure, so reconcile the existing provider state instead of failing.
    if (!(error instanceof DomainProviderError) || error.code !== "not_modified") throw error;
  }
  return reconcileProjectDomain(hostname, false);
}

export async function verifyProjectDomain(hostname: string): Promise<DomainProviderResult> {
  return reconcileProjectDomain(hostname, true);
}

export async function removeProjectDomain(hostname: string): Promise<void> {
  const config = providerConfig();
  try {
    await vercelRequest<ProjectDomainResponse>(projectDomainPath(config.projectId, hostname), { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof DomainProviderError) || error.code !== "not_found") throw error;
  }
}
