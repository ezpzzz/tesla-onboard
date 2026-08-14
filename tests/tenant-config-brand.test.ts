import { describe, expect, it } from "vitest";
import { accessibleAccentColor, DEFAULT_TENANT_CONFIG, normalizeTenantConfig } from "@/lib/tenant-config";

describe("tenant branding normalization", () => {
  it("accepts a bucket-scoped raster asset path and normalized hex accent", () => {
    const config = normalizeTenantConfig({
      brand: {
        logoPath: "6acaf5d4-a1ce-4c32-a17f-ae3779be897f/onlyevs/logo-1a907a5a-6776-4ba8-ae11-6a9c39554e92.webp",
        faviconPath: "6acaf5d4-a1ce-4c32-a17f-ae3779be897f/onlyevs/favicon-2a907a5a-6776-4ba8-ae11-6a9c39554e92.png",
        logoAlt: "Example Rentals",
        accentColor: "#aBc123",
      },
    });
    expect(config.brand).toEqual({
      logoPath: "6acaf5d4-a1ce-4c32-a17f-ae3779be897f/onlyevs/logo-1a907a5a-6776-4ba8-ae11-6a9c39554e92.webp",
      faviconPath: "6acaf5d4-a1ce-4c32-a17f-ae3779be897f/onlyevs/favicon-2a907a5a-6776-4ba8-ae11-6a9c39554e92.png",
      logoAlt: "Example Rentals",
      accentColor: "#ABC123",
    });
  });

  it.each(["javascript:alert(1)", "../logo.png", "logo.svg", "other-workspace/logo.png"])(
    "fails closed on an unsafe logo path: %s",
    (logoPath) => {
      expect(normalizeTenantConfig({ brand: { logoPath } }).brand.logoPath).toBeNull();
    },
  );

  it("rejects cross-workspace, cross-shop, and cross-purpose brand references", () => {
    const path = "6acaf5d4-a1ce-4c32-a17f-ae3779be897f/onlyevs/logo-1a907a5a-6776-4ba8-ae11-6a9c39554e92.webp";
    expect(normalizeTenantConfig({ brand: { logoPath: path } }, {
      workspaceId: "7bcaf5d4-a1ce-4c32-a17f-ae3779be897f",
      shopSlug: "onlyevs",
    }).brand.logoPath).toBeNull();
    expect(normalizeTenantConfig({ brand: { logoPath: path } }, {
      workspaceId: "6acaf5d4-a1ce-4c32-a17f-ae3779be897f",
      shopSlug: "another-shop",
    }).brand.logoPath).toBeNull();
    expect(normalizeTenantConfig({ brand: { faviconPath: path } }).brand.faviconPath).toBeNull();
  });

  it("falls back from a malformed accent without affecting publication fields", () => {
    expect(normalizeTenantConfig({ brand: { accentColor: "red" } }).brand.accentColor)
      .toBe(DEFAULT_TENANT_CONFIG.brand.accentColor);
  });

  it("darkens low-contrast accents while preserving already readable colors", () => {
    expect(accessibleAccentColor("#FFFFFF")).not.toBe("#FFFFFF");
    expect(accessibleAccentColor("#171A20")).toBe("#171A20");
  });
});
