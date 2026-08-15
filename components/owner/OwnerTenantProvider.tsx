"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TenantConfigBoundary, useTenantConfig } from "@/components/TenantConfigProvider";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_TENANT_CONFIG,
  featuresWithTenantConfig,
  newTenantConfigDraft,
  tenantReference,
  tenantConfigFromFeatures,
  tenantSetupCompletedAt,
  type TenantConfigSaveOptions,
  type TenantConfig,
} from "@/lib/tenant-config";
import { useVehicleState } from "@/lib/owner/vehicle-state";
import { tenantCarFromVehicle, tenantCarMatchesVehicle } from "@/lib/tenant-vehicle";
import { DEMO_TENANT_CONFIG_KEY, DEMO_TENANT_SLUG } from "@/lib/tenant-storage";

const ACTIVE_WORKSPACE_KEY = "rtr:owner-workspace:v1";
const DEMO_WORKSPACE_ID = "local-demo";

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
}

interface BrandingRow {
  workspace_id: string;
  shop_slug: string;
  display_name: string;
  features: unknown;
  updated_at: string;
}

export interface OwnerWorkspace {
  key: string;
  id: string;
  name: string;
  slug: string;
  role: string;
  shopSlug: string;
  tenantRef: string;
  config: TenantConfig;
  features: unknown;
  brandingUpdatedAt: string | null;
}

interface OwnerTenantContextValue {
  workspaces: OwnerWorkspace[];
  workspace: OwnerWorkspace | null;
  loading: boolean;
  error: string | null;
  persistence: "workspace" | "browser";
  setWorkspace: (workspaceId: string) => void;
  saveConfig: (config: TenantConfig, options?: TenantConfigSaveOptions) => Promise<void>;
}

const OwnerTenantContext = createContext<OwnerTenantContextValue | null>(null);
const DEMO_OWNER_TENANT: OwnerTenantContextValue = {
  workspaces: [],
  workspace: null,
  loading: false,
  error: "Owner tenant provider is unavailable.",
  persistence: "browser",
  setWorkspace: () => undefined,
  saveConfig: async () => {
    throw new Error("Owner tenant provider is unavailable.");
  },
};

/**
 * Keep the public guest snapshot synchronized with its private workspace fleet
 * source whenever this owner session can see that vehicle. This publishes
 * presentation fields only; VIN, plate, notes, and telemetry never leave the
 * owner store.
 */
function GuestVehicleSync() {
  const { config } = useTenantConfig();
  const { workspace, saveConfig } = useOwnerTenant();
  const { vehicles, hydrated, error } = useVehicleState();
  const attemptedKey = useRef<string | null>(null);

  useEffect(() => {
    const sourceId = config.car.sourceVehicleId;
    if (!workspace || !hydrated || error) return;
    const publishedAt = tenantSetupCompletedAt(workspace.features);
    if (!sourceId) {
      if (!publishedAt) return;
      const key = `${workspace.key}:unpublish:unlinked`;
      if (attemptedKey.current === key) return;
      attemptedKey.current = key;
      void saveConfig(config, { publishedAt: null }).catch(() => {
        attemptedKey.current = null;
      });
      return;
    }
    const source = vehicles.find((vehicle) =>
      vehicle.guestSourceId === sourceId && vehicle.status === "active"
    );
    if (!source) {
      if (!publishedAt) return;
      const key = `${workspace.key}:unpublish:${sourceId}`;
      if (attemptedKey.current === key) return;
      attemptedKey.current = key;
      void saveConfig(config, { publishedAt: null }).catch(() => {
        attemptedKey.current = null;
      });
      return;
    }
    if (tenantCarMatchesVehicle(config.car, source)) {
      attemptedKey.current = null;
      return;
    }

    const key = `${workspace.key}:${source.id}:${source.updatedAt}`;
    if (attemptedKey.current === key) return;
    attemptedKey.current = key;

    void saveConfig({ ...config, car: tenantCarFromVehicle(source) }).catch(() => {
      attemptedKey.current = null;
      // TenantSettingsForm exposes the stale state and lets the owner retry.
      // Avoid an effect retry loop when the workspace optimistic lock rejects.
    });
  }, [config, error, hydrated, saveConfig, vehicles, workspace]);

  return null;
}

function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

function demoWorkspace(): OwnerWorkspace {
  let config = newTenantConfigDraft("Local demo");
  let features: unknown = {};
  try {
    window.localStorage.removeItem("rtr:demo-tenant-config:v1");
    const raw = window.localStorage.getItem(DEMO_TENANT_CONFIG_KEY);
    features = raw ? JSON.parse(raw) : {};
    config = tenantConfigFromFeatures(features) ?? config;
  } catch {
    // Invalid or unavailable local storage remains an empty, unpublished draft.
  }
  return {
    key: DEMO_WORKSPACE_ID,
    id: DEMO_WORKSPACE_ID,
    name: "Local demo",
    slug: DEMO_TENANT_SLUG,
    role: "admin",
    shopSlug: DEMO_TENANT_SLUG,
    tenantRef: DEMO_TENANT_SLUG,
    config,
    features,
    brandingUpdatedAt: null,
  };
}

function rememberWorkspace(id: string): void {
  try {
    window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
  } catch {
    // URL/auth session remains usable if browser storage is unavailable.
  }
}

function rememberedWorkspace(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function OwnerTenantProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<OwnerWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!supabaseConfigured()) {
      const demo = demoWorkspace();
      setWorkspaces([demo]);
      setWorkspaceId(demo.id);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (userError || !userId) {
      setError("Your owner session expired. Sign in again to load workspace settings.");
      setLoading(false);
      return;
    }

    let { data: memberships, error: membershipsError } = await supabase
      .from("workspace_users")
      .select("workspace_id,role")
      .eq("user_id", userId);
    if (membershipsError) {
      setError("Workspace access could not be loaded.");
      setLoading(false);
      return;
    }

    let membershipRows = (memberships ?? []) as Array<{ workspace_id: string; role: string }>;
    if (membershipRows.length === 0) {
      const { error: bootstrapError } = await supabase.rpc("bootstrap_evhost_workspace");
      if (!bootstrapError) {
        const refreshed = await supabase
          .from("workspace_users")
          .select("workspace_id,role")
          .eq("user_id", userId);
        memberships = refreshed.data;
        membershipsError = refreshed.error;
        membershipRows = (memberships ?? []) as Array<{ workspace_id: string; role: string }>;
      }
    }
    if (membershipsError) {
      setError("Workspace access could not be loaded.");
      setLoading(false);
      return;
    }
    const ids = membershipRows.map((row) => row.workspace_id);
    if (ids.length === 0) {
      setWorkspaces([]);
      setWorkspaceId(null);
      setError("Your EVhost workspace could not be created. Try signing in again.");
      setLoading(false);
      return;
    }

    const [
      { data: workspaceData, error: workspaceError },
      { data: brandingData, error: brandingError },
    ] =
      await Promise.all([
        supabase.from("workspaces").select("id,name,slug").in("id", ids),
        supabase
          .from("workspace_branding")
          .select("workspace_id,shop_slug,display_name,features,updated_at")
          .in("workspace_id", ids),
      ]);
    if (workspaceError || brandingError) {
      setError("Workspace details could not be loaded.");
      setLoading(false);
      return;
    }

    const workspaceRows = (workspaceData ?? []) as WorkspaceRow[];
    const brandingRows = (brandingData ?? []) as BrandingRow[];
    const next = workspaceRows
      .flatMap<OwnerWorkspace>((row) => {
        const membership = membershipRows.find((item) => item.workspace_id === row.id);
        const matches = brandingRows.filter((item) => item.workspace_id === row.id);
        const tenantRows: Array<BrandingRow | null> = matches.length > 0 ? matches : [null];
        return tenantRows.map((branding) => {
          const shopSlug = branding?.shop_slug ?? row.slug;
          const key = tenantReference(row.id, shopSlug);
          return {
            key,
            id: row.id,
            name: matches.length > 1
              ? `${row.name} — ${branding?.display_name ?? shopSlug}`
              : row.name,
            slug: row.slug,
            role: membership?.role ?? "member",
            shopSlug,
            tenantRef: key,
            config: tenantConfigFromFeatures(branding?.features)
              ?? newTenantConfigDraft(
                branding?.display_name || row.name || DEFAULT_TENANT_CONFIG.companyName,
              ),
            features: branding?.features ?? {},
            brandingUpdatedAt: branding?.updated_at ?? null,
          };
        });
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const remembered = rememberedWorkspace();
    const configured = next.find((item) => tenantConfigFromFeatures(item.features));
    const likelyOnlyEvs = next.find((item) =>
      /(onlyev|tesla|rental)/i.test(`${item.name} ${item.slug} ${item.shopSlug}`),
    );
    const selected = next.find((item) => item.key === remembered)
      ?? next.find((item) => item.id === remembered)
      ?? configured
      ?? likelyOnlyEvs
      ?? next[0];
    setWorkspaces(next);
    setWorkspaceId(selected?.key ?? null);
    if (selected) rememberWorkspace(selected.key);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const workspace = workspaces.find((item) => item.key === workspaceId) ?? null;

  const setWorkspace = useCallback((id: string) => {
    setWorkspaceId(id);
    rememberWorkspace(id);
  }, []);

  const saveConfig = useCallback(
    async (config: TenantConfig, options?: TenantConfigSaveOptions) => {
      const current = workspaces.find((item) => item.key === workspaceId);
      if (!current) throw new Error("Choose a workspace before saving settings.");
      const features = featuresWithTenantConfig(current.features, config, options);
      const savedConfig = tenantConfigFromFeatures(features) ?? config;
      const displayName = savedConfig.companyName || current.name.replace(/ — .+$/, "");

      if (!supabaseConfigured() || current.id === DEMO_WORKSPACE_ID) {
        try {
          window.localStorage.setItem(DEMO_TENANT_CONFIG_KEY, JSON.stringify(features));
        } catch {
          throw new Error("Browser storage is unavailable, so this local preview could not be saved.");
        }
        setWorkspaces((items) =>
          items.map((item) => item.key === current.key
            ? { ...item, config: savedConfig, features }
            : item),
        );
        return;
      }

      const supabase = createClient();
      let saved: BrandingRow | null = null;

      if (current.brandingUpdatedAt) {
        const { data, error: updateError } = await supabase
          .from("workspace_branding")
          .update({ features, display_name: displayName })
          .eq("workspace_id", current.id)
          .eq("shop_slug", current.shopSlug)
          .eq("updated_at", current.brandingUpdatedAt)
          .select("workspace_id,shop_slug,display_name,features,updated_at")
          .maybeSingle();
        if (updateError) {
          await load();
          throw new Error(updateError.message);
        }
        if (!data) {
          await load();
          throw new Error("These settings changed in another session. Reload and try again.");
        }
        saved = data as BrandingRow;
      } else {
        const { data, error: insertError } = await supabase
          .from("workspace_branding")
          .insert({
            workspace_id: current.id,
            shop_slug: current.shopSlug,
            display_name: displayName,
            features,
          })
          .select("workspace_id,shop_slug,display_name,features,updated_at")
          .single();
        if (insertError) throw new Error(insertError.message);
        saved = data as BrandingRow;
      }

      setWorkspaces((items) =>
        items.map((item) =>
          item.key === current.key
            ? {
                ...item,
                config: tenantConfigFromFeatures(saved?.features ?? features) ?? savedConfig,
                features: saved?.features ?? features,
                shopSlug: saved?.shop_slug ?? item.shopSlug,
                name: workspaces.filter((candidate) => candidate.id === item.id).length > 1
                  ? `${item.name.replace(/ — .+$/, "")} — ${saved?.display_name ?? displayName}`
                  : item.name,
                brandingUpdatedAt: saved?.updated_at ?? item.brandingUpdatedAt,
              }
            : item,
        ),
      );
    },
    [load, workspaceId, workspaces],
  );

  const value = useMemo<OwnerTenantContextValue>(
    () => ({
      workspaces,
      workspace,
      loading,
      error,
      persistence: supabaseConfigured() ? "workspace" : "browser",
      setWorkspace,
      saveConfig,
    }),
    [workspaces, workspace, loading, error, setWorkspace, saveConfig],
  );

  return (
    <OwnerTenantContext.Provider value={value}>
      <TenantConfigBoundary
        config={workspace?.config ?? DEFAULT_TENANT_CONFIG}
        tenantSlug={workspace?.tenantRef ?? null}
        loading={loading}
      >
        <GuestVehicleSync />
        {children}
      </TenantConfigBoundary>
    </OwnerTenantContext.Provider>
  );
}

export function useOwnerTenant(): OwnerTenantContextValue {
  const value = useContext(OwnerTenantContext);
  return value ?? DEMO_OWNER_TENANT;
}
