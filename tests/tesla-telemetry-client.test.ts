import { describe, expect, it, vi } from "vitest";
import {
  telemetryConfiguration,
  TeslaTelemetryClient,
  TeslaTelemetryError,
} from "@/lib/owner/tesla-telemetry-client";

const destination = {
  hostname: "telemetry.onlyevs.example",
  port: 443,
  ca: "-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----",
};

const BASES = {
  proxyUrl: "https://proxy.internal.example",
  regionBaseUrl: "https://fleet-api.prd.na.vn.cloud.tesla.com",
};

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } as unknown as Headers,
    json: async () => body,
  } as Response;
}

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
    const client = new TeslaTelemetryClient(BASES, "token", fetcher);
    await expect(client.configure("5YJ3E1EA7KF000001", telemetryConfiguration(destination, false)))
      .resolves.toBe("tx-1");
    const [url, init] = fetcher.mock.calls[0];
    // configure() must go through the PROXY base, never the region base --
    // it is the only telemetry call that needs the signed
    // vehicle-command-proxy path (tesla-api-alignment-20260818.md D4).
    expect(String(url)).toBe("https://proxy.internal.example/api/1/vehicles/fleet_telemetry_config");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      vins: ["5YJ3E1EA7KF000001"],
      config: { hostname: destination.hostname, fields: { Soc: { interval_seconds: 60 } } },
    });
  });

  it("classifies a missing-key skip reason instead of collapsing it into the generic skipped code (D2)", async () => {
    const client = new TeslaTelemetryClient(BASES, "token", async () =>
      jsonResponse(200, { response: { updated_vehicles: 0, skipped_vehicles: { "5YJ3E1EA7KF000001": "missing_key" } } }));
    await expect(client.configure("5YJ3E1EA7KF000001", telemetryConfiguration(destination, false)))
      .rejects.toThrow("telemetry_missing_key");
  });

  it("classifies unsupported_hardware, unsupported_firmware, and max_configs skip reasons (D2)", async () => {
    const reasons: [string, string][] = [
      ["unsupported_hardware", "telemetry_unsupported_hardware"],
      ["unsupported_firmware", "telemetry_unsupported_firmware"],
      ["max_configs", "telemetry_max_configs"],
    ];
    for (const [teslaReason, expectedCode] of reasons) {
      const client = new TeslaTelemetryClient(BASES, "token", async () =>
        jsonResponse(200, { response: { updated_vehicles: 0, skipped_vehicles: { "5YJ3E1EA7KF000001": teslaReason } } }));
      await expect(client.configure("5YJ3E1EA7KF000001", telemetryConfiguration(destination, false)))
        .rejects.toThrow(expectedCode);
    }
  });

  it("falls back to the generic skipped code for a bare-VIN skip entry with no reason (legacy shape, regression pin)", async () => {
    const client = new TeslaTelemetryClient(BASES, "token", async () =>
      jsonResponse(200, { response: { updated_vehicles: 0, skipped_vehicles: ["5YJ3E1EA7KF000001"] } }));
    await expect(client.configure("5YJ3E1EA7KF000001", telemetryConfiguration(destination, false)))
      .rejects.toThrow("telemetry_vehicle_skipped");
  });

  it("falls back to the generic skipped code for an unrecognized reason string", async () => {
    const client = new TeslaTelemetryClient(BASES, "token", async () =>
      jsonResponse(200, { response: { updated_vehicles: 0, skipped_vehicles: { "5YJ3E1EA7KF000001": "some_future_reason" } } }));
    await expect(client.configure("5YJ3E1EA7KF000001", telemetryConfiguration(destination, false)))
      .rejects.toThrow("telemetry_vehicle_skipped");
  });

  it("status() and remove() succeed against the region base with NO proxy configured at all (D4)", async () => {
    const fetcher = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async (input) => {
      if (String(input).includes("fleet_telemetry_config") && String(input).startsWith(BASES.regionBaseUrl)) {
        return jsonResponse(200, { response: { synced: true, limit_reached: false } }, { "x-txid": "tx-status" });
      }
      throw new Error(`unexpected request to ${String(input)}`);
    });
    const client = new TeslaTelemetryClient({ proxyUrl: "", regionBaseUrl: BASES.regionBaseUrl }, "token", fetcher);

    const status = await client.status("5YJ3E1EA7KF000001");
    expect(status.state).toEqual({ synced: true, limitReached: false });
    expect(String(fetcher.mock.calls[0][0])).toBe(
      `${BASES.regionBaseUrl}/api/1/vehicles/5YJ3E1EA7KF000001/fleet_telemetry_config`,
    );

    fetcher.mockImplementationOnce(async () => jsonResponse(200, {}, { "x-txid": "tx-remove" }));
    await expect(client.remove("5YJ3E1EA7KF000001")).resolves.toBe("tx-remove");
  });

  it("configure() still fails closed with telemetry_proxy_not_configured when the proxy is missing (D4)", async () => {
    const client = new TeslaTelemetryClient({ proxyUrl: "", regionBaseUrl: BASES.regionBaseUrl }, "token", async () => {
      throw new Error("must not be called -- proxy validation must fail before any fetch");
    });
    await expect(client.configure("5YJ3E1EA7KF000001", telemetryConfiguration(destination, false)))
      .rejects.toThrow("telemetry_proxy_not_configured");
  });

  it("status()/remove() fail closed with telemetry_region_not_configured when the region base is missing", async () => {
    const client = new TeslaTelemetryClient({ proxyUrl: BASES.proxyUrl, regionBaseUrl: "" }, "token", async () => {
      throw new Error("must not be called");
    });
    await expect(client.status("5YJ3E1EA7KF000001")).rejects.toThrow("telemetry_region_not_configured");
    await expect(client.remove("5YJ3E1EA7KF000001")).rejects.toThrow("telemetry_region_not_configured");
  });

  it("fleetStatus() reads total_number_of_keys from the region base (D3 pairing probe)", async () => {
    const fetcher = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse(200, {
        response: { vehicle_info: { "5YJ3E1EA7KF000001": { total_number_of_keys: 2 } } },
      }, { "x-txid": "tx-fleet-status" }));
    const client = new TeslaTelemetryClient({ proxyUrl: "", regionBaseUrl: BASES.regionBaseUrl }, "token", fetcher);

    const probe = await client.fleetStatus("5YJ3E1EA7KF000001");
    expect(probe.totalNumberOfKeys).toBe(2);
    expect(probe.requestId).toBe("tx-fleet-status");
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`${BASES.regionBaseUrl}/api/1/vehicles/fleet_status`);
    expect(JSON.parse(String(init?.body))).toEqual({ vins: ["5YJ3E1EA7KF000001"] });
  });

  it("fleetStatus() returns null (not zero) when Tesla's response has no usable count for this VIN", async () => {
    const client = new TeslaTelemetryClient({ proxyUrl: "", regionBaseUrl: BASES.regionBaseUrl }, "token", async () =>
      jsonResponse(200, { response: { vehicle_info: {} } }));
    const probe = await client.fleetStatus("5YJ3E1EA7KF000001");
    expect(probe.totalNumberOfKeys).toBeNull();
  });

  it("status() never derives active/pending_sync from a key_paired-style field -- only synced and limit_reached are on the returned state", async () => {
    const client = new TeslaTelemetryClient({ proxyUrl: "", regionBaseUrl: BASES.regionBaseUrl }, "token", async () =>
      jsonResponse(200, { response: { synced: true, limit_reached: false, key_paired: false } }));
    const status = await client.status("5YJ3E1EA7KF000001");
    expect(status.state).toEqual({ synced: true, limitReached: false });
    expect(status.state).not.toHaveProperty("keyPaired");
  });

  it("constructing the client does not require a proxy at all (only status()/remove() need a region base, configure() needs a proxy)", () => {
    expect(() => new TeslaTelemetryClient({ proxyUrl: "", regionBaseUrl: BASES.regionBaseUrl }, "token")).not.toThrow();
  });

  it("classification helper: TeslaTelemetryError exposes the classified code directly", () => {
    const error = new TeslaTelemetryError("telemetry_missing_key", 422, false, null);
    expect(error.code).toBe("telemetry_missing_key");
    expect(error.message).toBe("telemetry_missing_key");
  });
});
