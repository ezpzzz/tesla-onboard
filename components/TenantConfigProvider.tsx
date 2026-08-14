"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_TENANT_CONFIG,
  accessibleAccentColor,
  parseTenantReference,
  publishedTenantConfigFromFeatures,
  tenantBrandAssetUrl,
  type TenantConfig,
} from "@/lib/tenant-config";
import {
  DEMO_TENANT_CONFIG_KEY,
  DEMO_TENANT_SLUG,
  LAST_TENANT_KEY,
} from "@/lib/tenant-storage";

export interface TenantConfigContextValue {
  config: TenantConfig;
  tenantSlug: string | null;
  loading: boolean;
  source: "default" | "workspace";
  readiness: "loading" | "missing-tenant" | "workspace-unavailable" | "setup-required" | "ready";
}

const DEFAULT_CONTEXT: TenantConfigContextValue = {
  config: DEFAULT_TENANT_CONFIG,
  tenantSlug: null,
  loading: false,
  source: "default",
  readiness: "missing-tenant",
};

const TenantConfigContext = createContext<TenantConfigContextValue>(DEFAULT_CONTEXT);

function darkenHex(value: string): string {
  const channels = [1, 3, 5].map((offset) =>
    Math.max(0, Math.round(Number.parseInt(value.slice(offset, offset + 2), 16) * 0.78)),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function TenantTheme({ config, children }: { config: TenantConfig; children: ReactNode }) {
  const faviconUrl = tenantBrandAssetUrl(config.brand.faviconPath);
  const safeAccent = accessibleAccentColor(config.brand.accentColor);
  const style = {
    "--color-brand": safeAccent,
    "--color-brand-dark": darkenHex(safeAccent),
  } as CSSProperties;

  useEffect(() => {
    if (!faviconUrl) return;
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = faviconUrl;
    icon.dataset.onlyevsWorkspaceIcon = "true";
    document.head.append(icon);
    return () => icon.remove();
  }, [faviconUrl]);

  return <div className="contents" style={style}>{children}</div>;
}

function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function TenantConfigProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [value, setValue] = useState<TenantConfigContextValue>({
    ...DEFAULT_CONTEXT,
    loading: true,
    readiness: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams(search);
      const querySlug = params.get("tenant")?.trim() || null;
      let customDomainSlug: string | null = null;
      let storedSlug: string | null = null;
      let allowStoredTenant = false;

      // A verified custom domain is authoritative over this browser's last
      // tenant. This prevents stale localStorage from crossing workspace
      // boundaries when a guest opens another business's branded hostname.
      if (supabaseConfigured()) {
        try {
          const response = await fetch("/api/tenant/resolve-domain", { cache: "no-store" });
          const body = await response.json().catch(() => ({})) as {
            kind?: unknown;
            tenant?: unknown;
          };
          allowStoredTenant = response.ok && body.kind === "canonical";
          customDomainSlug = response.ok && body.kind === "custom" && typeof body.tenant === "string"
            ? body.tenant
            : null;
        } catch {
          // Fail closed when the serving hostname cannot be classified. A
          // stale remembered tenant must never render on an unknown domain.
        }
      }
      try {
        storedSlug = window.localStorage.getItem(LAST_TENANT_KEY);
      } catch {
        // Storage can be unavailable in private browsing.
      }
      const slug = supabaseConfigured()
        ? customDomainSlug ?? (allowStoredTenant ? querySlug ?? storedSlug : null)
        : querySlug ?? storedSlug;

      if (!slug) {
        if (!cancelled) setValue({ ...DEFAULT_CONTEXT, tenantSlug: null, loading: false, readiness: "missing-tenant" });
        return;
      }
      if (querySlug || customDomainSlug) {
        try {
          window.localStorage.setItem(LAST_TENANT_KEY, slug);
        } catch {
          // Non-fatal; the current URL/host remains authoritative.
        }
      }

      if (!supabaseConfigured()) {
        let config: TenantConfig | null = null;
        if (slug === DEMO_TENANT_SLUG) {
          try {
            const raw = window.localStorage.getItem(DEMO_TENANT_CONFIG_KEY);
            config = raw ? publishedTenantConfigFromFeatures(JSON.parse(raw)) : null;
          } catch {
            // A malformed preview value remains unavailable.
          }
        }
        if (!cancelled) setValue({
          config: config ?? DEFAULT_TENANT_CONFIG,
          tenantSlug: slug,
          loading: false,
          source: config ? "workspace" : "default",
          readiness: config ? "ready" : "setup-required",
        });
        return;
      }

      const reference = parseTenantReference(slug);
      const supabase = createClient();
      let query = supabase
        .from("workspace_branding")
        .select("workspace_id,shop_slug,features")
        .eq("shop_slug", reference.shopSlug);
      if (reference.workspaceId) query = query.eq("workspace_id", reference.workspaceId);
      const { data, error } = await query.maybeSingle();
      if (!cancelled) {
        const config = !error ? publishedTenantConfigFromFeatures(data?.features, {
          workspaceId: data?.workspace_id,
          shopSlug: data?.shop_slug,
        }) : null;
        setValue({
          config: config ?? DEFAULT_TENANT_CONFIG,
          tenantSlug: slug,
          loading: false,
          source: config ? "workspace" : "default",
          readiness: error || !data
            ? "workspace-unavailable"
            : config
              ? "ready"
              : "setup-required",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [search]);

  return (
    <TenantConfigContext.Provider value={value}>
      <TenantTheme config={value.config}>{children}</TenantTheme>
    </TenantConfigContext.Provider>
  );
}

export function TenantConfigBoundary({
  children,
  config,
  tenantSlug,
  loading = false,
  readiness = "ready",
}: {
  children: ReactNode;
  config: TenantConfig;
  tenantSlug: string | null;
  loading?: boolean;
  readiness?: TenantConfigContextValue["readiness"];
}) {
  const value = useMemo<TenantConfigContextValue>(
    () => ({
      config,
      tenantSlug,
      loading,
      source: tenantSlug ? "workspace" : "default",
      readiness: loading ? "loading" : readiness,
    }),
    [config, tenantSlug, loading, readiness],
  );
  return (
    <TenantConfigContext.Provider value={value}>
      <TenantTheme config={config}>{children}</TenantTheme>
    </TenantConfigContext.Provider>
  );
}

export function useTenantConfig(): TenantConfigContextValue {
  return useContext(TenantConfigContext);
}
