"use client";

import { useEffect, useRef, useState } from "react";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { vehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import { Button } from "@/components/ui";
import { tenantBrandAssetUrl, type TenantConfig } from "@/lib/tenant-config";

type BrandAssetPurpose = "logo" | "favicon";

function BrandAssetControl({
  label,
  description,
  imageUrl,
  imageAlt,
  compact,
  busy,
  disabled,
  onSelect,
  onRemove,
}: {
  label: string;
  description: string;
  imageUrl: string | null;
  imageAlt: string;
  compact?: boolean;
  busy: boolean;
  disabled: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-3 rounded-xl border border-line p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">{label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
        </div>
        <div className={`flex shrink-0 items-center justify-center overflow-hidden border border-dashed border-line bg-surface ${compact ? "h-14 w-14 rounded-xl" : "h-16 w-28 rounded-xl"}`}>
          {imageUrl ? (
            // Validated raster upload; SVG and arbitrary HTML are rejected server-side.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt={imageAlt} className="max-h-full max-w-full object-contain" />
          ) : (
            <span aria-hidden="true" className="text-xl text-muted">{compact ? "◇" : "—"}</span>
          )}
        </div>
      </div>
      <input
        ref={input}
        name={`onlyevs-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
        className="sr-only"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onSelect(file);
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy || disabled} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : imageUrl ? "Replace" : "Upload"}
        </Button>
        {imageUrl ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={onRemove}>Remove</Button>
        ) : null}
      </div>
    </div>
  );
}

export function BrandMediaField({
  brand,
  companyName,
  onChange,
}: {
  brand: TenantConfig["brand"];
  companyName: string;
  onChange: (brand: TenantConfig["brand"]) => void;
}) {
  const { workspace, persistence } = useOwnerTenant();
  const [busyPurpose, setBusyPurpose] = useState<BrandAssetPurpose | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const currentScope = vehicleWorkspaceScope(workspace?.tenantRef);
  const currentScopeKey = currentScope
    ? `${currentScope.workspaceId}~${currentScope.shopSlug}`
    : null;
  const scopeKeyRef = useRef(currentScopeKey);
  useEffect(() => {
    scopeKeyRef.current = currentScopeKey;
  }, [currentScopeKey]);
  const logoUrl = tenantBrandAssetUrl(brand.logoPath);
  const faviconUrl = tenantBrandAssetUrl(brand.faviconPath);

  async function upload(purpose: BrandAssetPurpose, file: File) {
    const scope = currentScope;
    if (!scope || persistence !== "workspace") {
      setMessage("Brand media uploads require a persisted workspace.");
      return;
    }
    setBusyPurpose(purpose);
    setMessage(null);
    const uploadScopeKey = `${scope.workspaceId}~${scope.shopSlug}`;
    try {
      const form = new FormData();
      form.set("workspace", scope.workspaceId);
      form.set("shop", scope.shopSlug);
      form.set("purpose", purpose);
      form.set("file", file);
      const response = await fetch("/api/owner/branding/assets", { method: "POST", body: form });
      const body = await response.json().catch(() => ({})) as { path?: string; error?: string };
      if (!response.ok || !body.path) throw new Error(body.error ?? "Logo upload failed.");
      if (scopeKeyRef.current !== uploadScopeKey) {
        setMessage("Upload completed in the previous workspace. Switch back there to select it.");
        return;
      }
      onChange({
        ...brand,
        ...(purpose === "logo" ? { logoPath: body.path } : { faviconPath: body.path }),
      });
      setMessage(`${purpose === "logo" ? "Logo" : "App icon"} uploaded. Save settings to publish this selection.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message.replaceAll("_", " ") : "Logo upload failed.");
    } finally {
      setBusyPurpose(null);
    }
  }

  return (
    <div className="space-y-3">
      <BrandAssetControl
        label="Business logo"
        description="Shown in owner and guest headers. Transparent images work best."
        imageUrl={logoUrl}
        imageAlt={brand.logoAlt || companyName || "Workspace logo"}
        busy={busyPurpose === "logo"}
        disabled={persistence !== "workspace" || busyPurpose !== null}
        onSelect={(file) => void upload("logo", file)}
        onRemove={() => onChange({ ...brand, logoPath: null })}
      />
      <BrandAssetControl
        label="Browser and app icon"
        description="A square icon for branded browser tabs and saved web apps."
        imageUrl={faviconUrl}
        imageAlt="Workspace app icon preview"
        compact
        busy={busyPurpose === "favicon"}
        disabled={persistence !== "workspace" || busyPurpose !== null}
        onSelect={(file) => void upload("favicon", file)}
        onRemove={() => onChange({ ...brand, faviconPath: null })}
      />
      <p className="text-xs leading-relaxed text-muted">PNG, JPEG, or WebP up to 2 MB. Custom media is isolated to this workspace and shop.</p>
      {message ? <p role="status" className="text-xs leading-relaxed text-muted">{message}</p> : null}
    </div>
  );
}
