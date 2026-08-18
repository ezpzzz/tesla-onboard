import { describe, expect, it } from "vitest";
import { telemetryErrorStripCopy } from "@/components/owner/telemetry-status-strip";

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
