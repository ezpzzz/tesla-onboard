import { describe, expect, it } from "vitest";
import {
  DEFAULT_TENANT_CONFIG,
  TURO_POLICY_STARTER,
  newTenantConfigDraft,
  normalizeTenantConfig,
} from "@/lib/tenant-config";

describe("Turo-aligned tenant policy starter", () => {
  it("seeds a new workspace draft while the generic guest fallback stays empty", () => {
    const draft = newTenantConfigDraft("Example EV Host");

    expect(DEFAULT_TENANT_CONFIG.rental.keyAccess).toBe("");
    expect(DEFAULT_TENANT_CONFIG.houseRules).toEqual([]);
    expect(draft.companyName).toBe("Example EV Host");
    expect(draft.rental).toEqual(TURO_POLICY_STARTER.rental);
    expect(draft.houseRules).toEqual(TURO_POLICY_STARTER.houseRules);
  });

  it("fills only blank policy fields when a legacy workspace is normalized", () => {
    const migrated = normalizeTenantConfig({
      version: 2,
      rental: {
        keyAccess: "Owner-authored pickup instructions.",
        chargeAccess: "",
      },
      houseRules: [],
    });

    expect(migrated.version).toBe(3);
    expect(migrated.rental.keyAccess).toBe("Owner-authored pickup instructions.");
    expect(migrated.rental.chargeAccess).toBe(TURO_POLICY_STARTER.rental.chargeAccess);
    expect(migrated.rental.returnChargeLevel).toBe(
      TURO_POLICY_STARTER.rental.returnChargeLevel,
    );
    expect(migrated.houseRules).toEqual(TURO_POLICY_STARTER.houseRules);
  });

  it("never resurrects defaults after an owner edits a version-3 record", () => {
    const edited = normalizeTenantConfig({
      ...newTenantConfigDraft(),
      version: 3,
      rental: {
        ...TURO_POLICY_STARTER.rental,
        keyAccess: "",
        chargingPolicy: "Custom charging terms.",
      },
      houseRules: [],
    });

    expect(edited.rental.keyAccess).toBe("");
    expect(edited.rental.chargingPolicy).toBe("Custom charging terms.");
    expect(edited.houseRules).toEqual([]);
  });
});
