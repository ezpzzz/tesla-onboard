import { describe, expect, it } from "vitest";
import {
  composeStripDetail,
  telemetryErrorDetail,
  telemetryErrorStripCopy,
  telemetryPendingPairingDetail,
  telemetrySettingUpDetail,
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

  it("pending-pairing", () => {
    expect(telemetryPendingPairingDetail("enrolled 5m ago")).toBe(
      "Open the Tesla app → Locks → pair the virtual key for this vehicle to start streaming. Enrolled 5m ago.",
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

  it("setting-up / pending-pairing / both error variants all read as proper prose", () => {
    expect(telemetrySettingUpDetail("enrolled 5m ago")).not.toMatch(fragmentAfterPeriod);
    expect(telemetryPendingPairingDetail("enrolled 5m ago")).not.toMatch(fragmentAfterPeriod);
    expect(telemetryErrorDetail("some_other_code", "enrolled 5m ago")).not.toMatch(fragmentAfterPeriod);
    expect(telemetryErrorDetail("telemetry_proxy_not_configured", "enrolled 5m ago")).not.toMatch(fragmentAfterPeriod);
  });
});
