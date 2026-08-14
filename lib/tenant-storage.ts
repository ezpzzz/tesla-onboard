export const LAST_TENANT_KEY = "rtr:tenant:v1";
export const DEMO_TENANT_CONFIG_KEY = "rtr:demo-tenant-config:v2";
export const DEMO_TENANT_SLUG = "local-demo";

export function scopedStorageKey(base: string, tenantSlug?: string | null): string {
  const scope = tenantSlug?.trim().toLowerCase();
  return scope ? `${base}:${encodeURIComponent(scope)}` : base;
}

export function browserTenantScope(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return new URLSearchParams(window.location.search).get("tenant")?.trim()
      || window.localStorage.getItem(LAST_TENANT_KEY);
  } catch {
    return null;
  }
}

/** Move the former single-tenant value into the first selected workspace once. */
export function migrateLegacyStorage(base: string, tenantSlug?: string | null): string {
  const key = scopedStorageKey(base, tenantSlug);
  if (typeof window === "undefined" || key === base) return key;
  try {
    if (window.localStorage.getItem(key) === null) {
      const legacy = window.localStorage.getItem(base);
      if (legacy !== null) {
        window.localStorage.setItem(key, legacy);
        window.localStorage.removeItem(base);
      }
    }
  } catch {
    // Storage errors are handled by each caller's normal fallback path.
  }
  return key;
}
