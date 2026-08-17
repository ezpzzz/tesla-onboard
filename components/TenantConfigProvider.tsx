"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
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

// React warns if useLayoutEffect runs during SSR ("does nothing on the
// server"); it's a no-op there anyway, so fall back to useEffect
// server-side and only get the synchronous-before-paint behavior on the
// client, where it actually matters (see the resolution effect below).
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

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

// Module scope (not React state) on purpose: resolving the tenant is at
// least one microtask away from first paint even in the common case (it
// still reads localStorage inside an effect, and may hit
// /api/tenant/resolve-domain), and React can legitimately re-mount this
// provider for reasons that have nothing to do with tenant data (dev-only
// Suspense/Strict Mode remounts, etc.). Without this cache, every such
// remount would start over at `loading: true` and every consumer downstream
// (e.g. the owner dashboard's OwnerDataProvider, gated on
// useTenantConfig().loading) would drop back into its own loading state even
// though this exact route already resolved a value moments earlier in this
// browser tab. Keyed by the same (pathname, search) the resolution effect
// itself keys on, so a real route/query change still resolves fresh.
let lastResolvedKey: string | null = null;
let lastResolvedValue: TenantConfigContextValue | null = null;

function resolvedFor(pathname: string, search: string): TenantConfigContextValue | null {
  const key = `${pathname}?${search}`;
  return lastResolvedKey === key ? lastResolvedValue : null;
}

function rememberResolved(pathname: string, search: string, next: TenantConfigContextValue) {
  lastResolvedKey = `${pathname}?${search}`;
  lastResolvedValue = next;
}

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
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [value, setValue] = useState<TenantConfigContextValue>(
    () =>
      resolvedFor(pathname, search) ?? {
        ...DEFAULT_CONTEXT,
        loading: true,
        readiness: "loading",
      },
  );

  // A layout effect (not a passive one) so the synchronous fast path below
  // — no Supabase, no network call, just localStorage — resolves and commits
  // BEFORE the browser paints, instead of after. useOwnerDataValue (and
  // everything else reading useTenantConfig()) is then never given a chance
  // to render a "still loading" frame for that path in the first place: its
  // own effect, gated on `tenantLoading`, sees the resolved value on its very
  // first pass rather than waiting on a whole extra render+commit cycle. The
  // real Supabase path still resolves asynchronously after its network call,
  // same as before — this only removes the artificial wait for cases that
  // never actually needed one.
  useIsomorphicLayoutEffect(() => {
    // Already resolved this exact route in this tab (see the module cache
    // above) — adopt it immediately instead of re-announcing `loading: true`
    // to every consumer while the effect below re-resolves in the
    // background.
    const cached = resolvedFor(pathname, search);
    if (cached) setValue((current) => (current === cached ? current : cached));

    // Private trip routes carry an already-validated, guest-safe tenant
    // snapshot in their nested boundary. Resolving the serving hostname here
    // would be redundant and can create a blocked background request under
    // the portal's intentionally strict no-referrer policy.
    if (pathname.startsWith("/trip/")) {
      const next = { ...DEFAULT_CONTEXT, tenantSlug: null, loading: false, readiness: "missing-tenant" } as const;
      setValue(next);
      rememberResolved(pathname, search, next);
      return;
    }
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
        if (!cancelled) {
          const next = { ...DEFAULT_CONTEXT, tenantSlug: null, loading: false, readiness: "missing-tenant" } as const;
          setValue(next);
          rememberResolved(pathname, search, next);
        }
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
        if (!cancelled) {
          const next = {
            config: config ?? DEFAULT_TENANT_CONFIG,
            tenantSlug: slug,
            loading: false,
            source: config ? "workspace" : "default",
            readiness: config ? "ready" : "setup-required",
          } as const;
          setValue(next);
          rememberResolved(pathname, search, next);
        }
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
        const next = {
          config: config ?? DEFAULT_TENANT_CONFIG,
          tenantSlug: slug,
          loading: false,
          source: config ? "workspace" : "default",
          readiness: error || !data
            ? "workspace-unavailable"
            : config
              ? "ready"
              : "setup-required",
        } as const;
        setValue(next);
        rememberResolved(pathname, search, next);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, search]);

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
