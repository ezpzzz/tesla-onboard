export const CUSTOM_DOMAIN_STATUSES = [
  "requested",
  "pending_verification",
  "pending_dns",
  "active",
  "error",
  "removal_requested",
] as const;

export type CustomDomainStatus = (typeof CUSTOM_DOMAIN_STATUSES)[number];

export interface DomainVerificationRecord {
  type: "A" | "AAAA" | "CNAME" | "TXT";
  name: string;
  value: string;
  reason?: string;
}

export interface WorkspaceCustomDomain {
  id: string;
  workspaceId: string;
  shopSlug: string;
  hostname: string;
  status: CustomDomainStatus;
  verification: DomainVerificationRecord[];
  lastErrorCode: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const HOST_LABEL = /^(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const PLATFORM_RESERVED_HOSTNAMES = [
  "evhost.app",
  "www.evhost.app",
  "onboarding.onlyevs.rentals",
  "onlyevs-onboard.vercel.app",
];

/** Canonicalize an owner-entered host without ever accepting a URL, path, IP,
 * wildcard, localhost, or port. URL supplies standards-compliant IDN punycode. */
export function normalizeCustomHostname(input: string): string {
  const raw = input.trim().replace(/\.$/, "");
  if (!raw || raw.includes("://") || /[/?#@:*\s]/.test(raw)) {
    throw new Error("Enter a hostname only, such as welcome.example.com.");
  }
  let hostname: string;
  try {
    hostname = new URL(`https://${raw}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    throw new Error("That hostname is not valid.");
  }
  const labels = hostname.split(".");
  if (
    hostname.length > 253
    || labels.length < 2
    || labels.some((label) => !HOST_LABEL.test(label))
    || hostname === "localhost"
    || /^\d+(?:\.\d+){3}$/.test(hostname)
  ) {
    throw new Error("Use a valid public domain or subdomain.");
  }
  return hostname;
}

/** Defense in depth for the canonical auth broker and provider-owned hosts.
 * A tenant must never be able to attach the platform entrypoint to itself. */
export function isReservedCustomHostname(
  hostname: string,
  canonicalOrigin: string | null | undefined,
  additionalHostnames: string | null | undefined = "",
): boolean {
  const normalizedHostname = hostname.toLowerCase().replace(/\.$/, "");
  // Every Vercel-generated preview/production alias is a platform surface,
  // even though its randomized hostname cannot be enumerated in advance.
  if (normalizedHostname === "vercel.app" || normalizedHostname.endsWith(".vercel.app")) {
    return true;
  }
  const reserved = [
    ...PLATFORM_RESERVED_HOSTNAMES,
    ...(additionalHostnames ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase().replace(/\.$/, ""))
      .filter(Boolean),
  ];
  try {
    const canonical = new URL(canonicalOrigin ?? "");
    if (canonical.protocol === "https:") reserved.push(canonical.hostname.toLowerCase());
  } catch {
    // The worker separately treats an invalid canonical origin as a gate.
  }
  return new Set(reserved).has(normalizedHostname);
}

export function normalizeVerificationRecords(value: unknown): DomainVerificationRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type.toUpperCase() : "";
    const name = typeof (row.name ?? row.domain) === "string"
      ? String(row.name ?? row.domain).trim()
      : "";
    const recordValue = typeof row.value === "string" ? row.value.trim() : "";
    if (!(["A", "AAAA", "CNAME", "TXT"] as const).includes(type as DomainVerificationRecord["type"]) || !name || !recordValue) {
      return [];
    }
    return [{
      type: type as DomainVerificationRecord["type"],
      name,
      value: recordValue,
      reason: typeof row.reason === "string" ? row.reason : undefined,
    }];
  });
}

export function domainStatusFromProvider(input: {
  ownershipVerified: boolean;
  dnsMisconfigured: boolean | null;
}): CustomDomainStatus {
  if (!input.ownershipVerified) return "pending_verification";
  return input.dnsMisconfigured === false ? "active" : "pending_dns";
}
