"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_TENANT_CONFIG,
  parseTenantReference,
  publishedTenantConfigFromFeatures,
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
    const params = new URLSearchParams(search);
    const querySlug = params.get("tenant")?.trim() || null;
    let storedSlug: string | null = null;
    try {
      storedSlug = window.localStorage.getItem(LAST_TENANT_KEY);
    } catch {
      // Storage can be unavailable in private browsing; the URL remains authoritative.
    }
    const slug = querySlug ?? storedSlug;

    if (!slug) {
      setValue({
        ...DEFAULT_CONTEXT,
        tenantSlug: slug,
        loading: false,
        readiness: "missing-tenant",
      });
      return () => {
        cancelled = true;
      };
    }

    if (querySlug) {
      try {
        window.localStorage.setItem(LAST_TENANT_KEY, querySlug);
      } catch {
        // Non-fatal; shared links continue to work from their tenant query.
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
      setValue({
        config: config ?? DEFAULT_TENANT_CONFIG,
        tenantSlug: slug,
        loading: false,
        source: config ? "workspace" : "default",
        readiness: config ? "ready" : "setup-required",
      });
      return () => {
        cancelled = true;
      };
    }

    const reference = parseTenantReference(slug);
    const supabase = createClient();
    let query = supabase
      .from("workspace_branding")
      .select("shop_slug,features")
      .eq("shop_slug", reference.shopSlug);
    if (reference.workspaceId) {
      query = query.eq("workspace_id", reference.workspaceId);
    }
    void query
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        const config = !error ? publishedTenantConfigFromFeatures(data?.features) : null;
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
      });

    return () => {
      cancelled = true;
    };
  }, [search]);

  return <TenantConfigContext.Provider value={value}>{children}</TenantConfigContext.Provider>;
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
  return <TenantConfigContext.Provider value={value}>{children}</TenantConfigContext.Provider>;
}

export function useTenantConfig(): TenantConfigContextValue {
  return useContext(TenantConfigContext);
}
