import { describe, expect, it } from "vitest";
import {
  composeStripDetail,
  telemetryErrorDetail,
  telemetryErrorStripCopy,
  telemetryNeedsPairingDetail,
  telemetryPendingSyncDetail,
  telemetrySettingUpDetail,
  telemetryUnsupportedFirmwareDetail,
  telemetryUnsupportedHardwareDetail,
} from "@/components/owner/telemetry-status-strip";

describe("telemetryErrorStripCopy", () => {
  it("tells the honest truth when the deployment's telemetry proxy was never configured: operator setup, no auto-start implied", () => {
    const copy = telemetryErrorStripCopy("telemetry_proxy_not_configured");

    expect(copy.title).toMatch(/isn't configured/i);
    expect(`${copy.title} ${copy.detail}`).toMatch(/deployment/i);
    expect(`${copy.title} ${copy.detail}`).toMatch(/operator/i);
    // Never claim this resolves itself -- that's the "setting-up" state's
    // vocabulary, not this one's.
    expect(`${copy.title} ${copy.detail}`).not.toMatch(/no action needed/i);
    expect(`${copy.title} ${copy.detail}`).not.toMatch(/we're configuring/i);
    // The inverted sentence bug: this must never claim the service stays
    // dead even *after* operator setup happens.
    expect(copy.detail).not.toMatch(/on its own once that happens/i);
    // It must instead say the service will not start UNTIL an operator
    // configures it -- and still say reconnecting Tesla won't fix it.
    expect(copy.detail).toMatch(/will not start until an operator/i);
    expect(copy.detail).toMatch(/reconnecting tesla will not fix this/i);
  });

  it("falls back to the existing reconnect-and-retry copy for any other error code", () => {
    const copy = telemetryErrorStripCopy("some_other_code");
    expect(copy.title).toBe("Telemetry setup failed");
    expect(copy.detail).toMatch(/reconnect tesla/i);
  });

  it("falls back to the existing reconnect-and-retry copy when there is no error code at all", () => {
    const copy = telemetryErrorStripCopy(null);
    expect(copy.title).toBe("Telemetry setup failed");
    expect(copy.detail).toMatch(/reconnect tesla/i);
  });
});

describe("composeStripDetail", () => {
  it("capitalizes the age clause into its own sentence rather than a lowercase fragment after a period", () => {
    expect(composeStripDetail("We're configuring this vehicle's telemetry stream with Tesla.", "enrolled 1h ago"))
      .toBe("We're configuring this vehicle's telemetry stream with Tesla. Enrolled 1h ago.");
  });
});

describe("full strip detail composers pin exact prose for every age-appending state", () => {
  it("setting-up", () => {
    expect(telemetrySettingUpDetail("enrolled 5m ago")).toBe(
      "We're configuring this vehicle's telemetry stream with Tesla. Enrolled 5m ago.",
    );
  });

  it("error, generic code", () => {
    expect(telemetryErrorDetail("some_other_code", "enrolled 5m ago")).toBe(
      "Reconnect Tesla to retry configuring this vehicle. Enrolled 5m ago.",
    );
  });

  it("error, telemetry_proxy_not_configured", () => {
    expect(telemetryErrorDetail("telemetry_proxy_not_configured", "enrolled 5m ago")).toBe(
      "This deployment's telemetry service needs operator setup before it can stream data. It will not start until an operator finishes that setup -- reconnecting Tesla will not fix this. Enrolled 5m ago.",
    );
  });
});

describe("no lowercase sentence fragment after a full stop, across every age-appending state", () => {
  // Matches ". x" / ". enrolled" -- a full stop followed by a lowercase
  // letter, the signature of a fragment glued onto the end of a sentence.
  const fragmentAfterPeriod = /\.\s+[a-z]/;

  it("setting-up / pending-sync / needs-pairing / both error variants all read as proper prose", () => {
    expect(telemetrySettingUpDetail("enrolled 5m ago")).not.toMatch(fragmentAfterPeriod);
    expect(telemetryPendingSyncDetail("enrolled 5m ago")).not.toMatch(fragmentAfterPeriod);
    expect(telemetryNeedsPairingDetail("enrolled 5m ago")).not.toMatch(fragmentAfterPeriod);
    expect(telemetryErrorDetail("some_other_code", "enrolled 5m ago")).not.toMatch(fragmentAfterPeriod);
    expect(telemetryErrorDetail("telemetry_proxy_not_configured", "enrolled 5m ago")).not.toMatch(fragmentAfterPeriod);
  });
});

// D3(a) -- Tesla defines synced=false ("pending_sync") as the normal state
// of a parked, sleeping car that will adopt its accepted config next time it
// wakes and phones home. It is not an error and does not mean "pair the
// virtual key" -- that was the inversion the audit flagged.
describe("telemetryPendingSyncDetail (D3a: pending_sync is a normal, no-action state)", () => {
  it("says the configuration is accepted and will apply when the car next wakes -- never asks for pairing", () => {
    const detail = telemetryPendingSyncDetail("enrolled 5m ago");
    expect(detail).toMatch(/accept/i);
    expect(detail).toMatch(/wakes|wake|connects|next time/i);
    expect(detail).not.toMatch(/pair/i);
  });

  it("does not read as an error and does not ask for any owner action", () => {
    const detail = telemetryPendingSyncDetail("enrolled 5m ago");
    expect(detail).not.toMatch(/error|fail|isn't supported|unsupported/i);
    expect(detail).toMatch(/no action needed/i);
  });

  it("pins the exact composed prose", () => {
    expect(telemetryPendingSyncDetail("enrolled 5m ago")).toBe(
      "This vehicle's telemetry configuration is accepted and will apply the next time it wakes and connects -- no action needed. Enrolled 5m ago.",
    );
  });
});

// D3(b) + D7 -- a genuine telemetry_missing_key skip reason is the ONLY
// state that should show pairing instructions. It must not be described as
// a firmware problem or as permanent: it self-heals the moment the owner
// pairs the virtual key.
describe("telemetryNeedsPairingDetail (D3b: the only state that asks for pairing)", () => {
  it("asks the owner to pair the virtual key and explains it is self-healing", () => {
    const detail = telemetryNeedsPairingDetail("enrolled 5m ago");
    expect(detail).toMatch(/pair/i);
    expect(detail).toMatch(/tesla app/i);
    expect(detail).toMatch(/once (it's|it is|you) paired|starts (streaming )?automatically/i);
  });

  it("never describes this as a firmware or hardware problem, and never claims it is permanent", () => {
    const detail = telemetryNeedsPairingDetail("enrolled 5m ago");
    expect(detail).not.toMatch(/firmware/i);
    expect(detail).not.toMatch(/hardware/i);
    expect(detail).not.toMatch(/unsupported/i);
    expect(detail).not.toMatch(/permanent/i);
  });

  it("pins the exact composed prose", () => {
    expect(telemetryNeedsPairingDetail("enrolled 5m ago")).toBe(
      "Open the Tesla app → Locks → pair the virtual key for this vehicle. Telemetry starts automatically once it's paired -- this isn't an error and nothing else needs fixing. Enrolled 5m ago.",
    );
  });
});

// D2/contract -- telemetry_unsupported_hardware is genuinely permanent and
// distinct from a firmware update; telemetry_unsupported_firmware is not
// permanent and is fixed by an update. The two must read differently.
describe("telemetryUnsupportedHardwareDetail vs telemetryUnsupportedFirmwareDetail (genuinely distinct causes)", () => {
  it("hardware copy says the condition is permanent and explicitly rules out an update fixing it", () => {
    const detail = telemetryUnsupportedHardwareDetail();
    expect(detail).toMatch(/hardware/i);
    expect(detail).toMatch(/no update/i);
  });

  it("firmware copy points at an update and does not claim permanence", () => {
    const detail = telemetryUnsupportedFirmwareDetail();
    expect(detail).toMatch(/update/i);
    expect(detail).not.toMatch(/permanent/i);
  });
});

// D6 -- the proxy-signed path we actually use requires firmware >= 2024.26.
// 2023.20.6 was only ever the retired legacy-CSR floor and must not appear
// in owner-visible copy again.
describe("firmware floor copy pins the proxy-signed path's real floor (D6)", () => {
  it("states 2024.26 and never the stale legacy-CSR floor 2023.20.6", () => {
    const detail = telemetryUnsupportedFirmwareDetail();
    expect(detail).toMatch(/2024\.26/);
    expect(detail).not.toMatch(/2023\.20\.6/);
  });
});
