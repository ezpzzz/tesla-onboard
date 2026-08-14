import { describe, expect, it, vi } from "vitest";
import {
  telemetryConfiguration,
  TeslaTelemetryClient,
} from "@/lib/owner/tesla-telemetry-client";

const destination = {
  hostname: "telemetry.onlyevs.example",
  port: 443,
  ca: "-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----",
};

describe("Tesla telemetry control plane", () => {
  it("keeps location out of the baseline configuration and enables it explicitly", () => {
    expect(telemetryConfiguration(destination, false).fields).not.toHaveProperty("Location");
    expect(telemetryConfiguration(destination, true).fields).toMatchObject({
      Location: { interval_seconds: 300, minimum_delta: 500 },
      Soc: { interval_seconds: 60 },
    });
  });

  it("configures exactly one VIN through the command proxy", async () => {
    const fetcher = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ response: { updated_vehicles: 1 } }), {
      status: 200,
      headers: { "x-txid": "tx-1" },
    }));
    const client = new TeslaTelemetryClient("https://proxy.internal.example", "token", fetcher);
    await expect(client.configure("5YJ3E1EA7KF000001", telemetryConfiguration(destination, false)))
      .resolves.toBe("tx-1");
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://proxy.internal.example/api/1/vehicles/fleet_telemetry_config");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      vins: ["5YJ3E1EA7KF000001"],
      config: { hostname: destination.hostname, fields: { Soc: { interval_seconds: 60 } } },
    });
  });

  it("fails closed when Tesla skips the requested VIN", async () => {
    const client = new TeslaTelemetryClient("https://proxy.internal.example", "token", async () =>
      new Response(JSON.stringify({ response: { updated_vehicles: 0, skipped_vehicles: { "5YJ3E1EA7KF000001": "missing_key" } } }), { status: 200 }));
    await expect(client.configure("5YJ3E1EA7KF000001", telemetryConfiguration(destination, false)))
      .rejects.toThrow("telemetry_vehicle_skipped");
  });
});
