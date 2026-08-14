import { tenantBrandAssetUrl, type TenantConfig } from "@/lib/tenant-config";

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function TenantBrandMark({
  config,
  className,
  showNameWhenLogo = false,
}: {
  config: TenantConfig;
  className?: string;
  showNameWhenLogo?: boolean;
}) {
  const logoUrl = tenantBrandAssetUrl(config.brand.logoPath);
  if (!logoUrl) {
    return (
      <span className={classes("truncate font-semibold tracking-tight text-ink", className)}>
        {config.companyName}
      </span>
    );
  }

  return (
    <span className={classes("flex min-w-0 items-center gap-2.5", className)}>
      {/* Workspace media is restricted to validated PNG, JPEG, or WebP uploads. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl}
        alt={config.brand.logoAlt || config.companyName}
        className="max-h-8 max-w-[140px] shrink-0 object-contain object-left"
        referrerPolicy="no-referrer"
      />
      {showNameWhenLogo ? (
        <span className="truncate font-semibold tracking-tight text-ink">{config.companyName}</span>
      ) : null}
    </span>
  );
}
