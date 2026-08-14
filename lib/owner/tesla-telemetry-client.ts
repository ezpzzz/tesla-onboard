import { telemetryFields } from "./telemetry-ingest";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TelemetryProviderState {
  synced: boolean;
  keyPaired: boolean | null;
  limitReached: boolean;
}

export class TeslaTelemetryError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId: string | null,
  ) {
    super(code);
    this.name = "TeslaTelemetryError";
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function responseValue(value: unknown): Record<string, unknown> {
  const root = record(value);
  return record(Object.prototype.hasOwnProperty.call(root, "response") ? root.response : root);
}

function requestId(response: Response): string | null {
  return response.headers.get("x-txid")
    ?? response.headers.get("x-request-id")
    ?? response.headers.get("request-id");
}

export interface TelemetryDestination {
  hostname: string;
  port: number;
  ca: string;
}

export function telemetryDestinationFromEnv(): TelemetryDestination {
  const hostname = process.env.ONLYEVS_TELEMETRY_HOSTNAME?.trim() ?? "";
  const port = Number(process.env.ONLYEVS_TELEMETRY_PORT ?? "443");
  const ca = (process.env.ONLYEVS_TELEMETRY_CA_PEM ?? "").replaceAll("\\n", "\n").trim();
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}$/i.test(hostname)) {
    throw new TeslaTelemetryError("telemetry_hostname_not_configured", 0, false, null);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TeslaTelemetryError("telemetry_port_invalid", 0, false, null);
  }
  if (!/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(ca)) {
    throw new TeslaTelemetryError("telemetry_ca_not_configured", 0, false, null);
  }
  return { hostname: hostname.toLowerCase(), port, ca };
}

export function telemetryConfiguration(
  destination: TelemetryDestination,
  locationEnabled: boolean,
) {
  return {
    hostname: destination.hostname,
    port: destination.port,
    ca: destination.ca,
    delivery_policy: "latest",
    fields: telemetryFields(locationEnabled),
    alert_types: [] as string[],
  };
}

export class TeslaTelemetryClient {
  constructor(
    private readonly proxyUrl: string,
    private readonly accessToken: string,
    private readonly fetcher: FetchLike = fetch,
  ) {
    let url: URL;
    try {
      url = new URL(proxyUrl);
    } catch {
      throw new TeslaTelemetryError("telemetry_proxy_not_configured", 0, false, null);
    }
    if (url.protocol !== "https:" || !accessToken) {
      throw new TeslaTelemetryError("invalid_telemetry_client_config", 0, false, null);
    }
  }

  private async request(path: string, init: RequestInit): Promise<{ body: unknown; requestId: string | null }> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, `${this.proxyUrl.replace(/\/$/, "")}/`), {
        ...init,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
        cache: "no-store",
        signal: init.signal ?? AbortSignal.timeout(10_000),
      });
    } catch {
      throw new TeslaTelemetryError("telemetry_proxy_unreachable", 0, true, null);
    }
    const body = await response.json().catch(() => ({}));
    const txid = requestId(response);
    if (!response.ok) {
      const root = record(body);
      const error = record(root.error);
      const code = typeof error.code === "string"
        ? error.code
        : typeof root.error === "string" ? root.error : `tesla_http_${response.status}`;
      throw new TeslaTelemetryError(
        code,
        response.status,
        response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
        txid,
      );
    }
    return { body, requestId: txid };
  }

  async configure(vin: string, config: ReturnType<typeof telemetryConfiguration>) {
    const result = await this.request("/api/1/vehicles/fleet_telemetry_config", {
      method: "POST",
      body: JSON.stringify({ vins: [vin], config }),
    });
    const response = responseValue(result.body);
    const updated = response.updated_vehicles;
    const skipped = response.skipped_vehicles;
    const skippedVin = Array.isArray(skipped)
      ? skipped.some((item) => typeof item === "string" ? item === vin : record(item).vin === vin)
      : Object.prototype.hasOwnProperty.call(record(skipped), vin);
    if (skippedVin || (typeof updated === "number" && updated < 1)) {
      throw new TeslaTelemetryError("telemetry_vehicle_skipped", 422, false, result.requestId);
    }
    return result.requestId;
  }

  async status(vin: string): Promise<{ state: TelemetryProviderState; requestId: string | null }> {
    const result = await this.request(`/api/1/vehicles/${encodeURIComponent(vin)}/fleet_telemetry_config`, { method: "GET" });
    const response = responseValue(result.body);
    return {
      requestId: result.requestId,
      state: {
        synced: response.synced === true,
        keyPaired: typeof response.key_paired === "boolean" ? response.key_paired : null,
        limitReached: response.limit_reached === true,
      },
    };
  }

  async remove(vin: string): Promise<string | null> {
    try {
      const result = await this.request(`/api/1/vehicles/${encodeURIComponent(vin)}/fleet_telemetry_config`, { method: "DELETE" });
      return result.requestId;
    } catch (error) {
      // Provider absence is the idempotent success condition for cleanup.
      if (error instanceof TeslaTelemetryError && error.status === 404) return error.requestId;
      throw error;
    }
  }
}
