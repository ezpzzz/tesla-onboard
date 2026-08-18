import { telemetryFields } from "./telemetry-ingest";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TelemetryProviderState {
  synced: boolean;
  limitReached: boolean;
}

/** Result of the pre-configure virtual-key probe (`fleetStatus`).
 * `totalNumberOfKeys` is `null` only when Tesla's response didn't carry a
 * usable value for this VIN -- callers must treat that as "unknown", never
 * as "zero keys". Per tesla-api-alignment-20260818.md's SHARED CONTRACT,
 * this -- never a `key_paired` field on `GET fleet_telemetry_config`, which
 * Tesla does not document there -- is the source of truth for virtual-key
 * pairing state. */
export interface TelemetryKeyProbe {
  totalNumberOfKeys: number | null;
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

/** Tesla's four documented `skipped_vehicles` reasons
 * (tesla-api-alignment-20260818.md D2 / SHARED CONTRACT), mapped to the
 * `TeslaTelemetryError` codes services/onlyevs-worker/index.ts's
 * processTelemetry branches on. An entry present in `skipped_vehicles` but
 * carrying a reason outside this map (or none at all) falls back to the
 * pre-existing, unrecognized-but-present `telemetry_vehicle_skipped` code
 * -- not a regression, since that classification existed before per-VIN
 * reasons were read at all. */
const SKIP_REASON_CODES: Record<string, string> = {
  missing_key: "telemetry_missing_key",
  unsupported_hardware: "telemetry_unsupported_hardware",
  unsupported_firmware: "telemetry_unsupported_firmware",
  max_configs: "telemetry_max_configs",
};

const SKIPPED_VEHICLE_REASON_KEYS = ["reason", "skip_reason", "result_reason", "error"];

/**
 * Reads the per-VIN skip reason out of one `skipped_vehicles` entry. Tesla
 * publishes the four reason strings themselves but not the exact JSON shape
 * that carries them per VIN, so this accepts either of the two shapes this
 * codebase has seen: `skipped_vehicles` as an object keyed by VIN whose
 * value IS the bare reason string (`{ "<vin>": "missing_key" }`), or an
 * array of per-vehicle objects carrying the reason under one of a few
 * plausible keys. A bare VIN string with no accompanying object (the
 * legacy `skipped_vehicles: ["<vin>", ...]` shape with no reason at all)
 * correctly yields `null` here -- the caller must not mistake the VIN
 * itself for a reason.
 */
function skippedVehicleReason(entry: unknown): string | null {
  if (entry === undefined) return null;
  if (typeof entry === "string") return entry;
  const row = record(entry);
  for (const key of SKIPPED_VEHICLE_REASON_KEYS) {
    if (typeof row[key] === "string") return row[key] as string;
  }
  return null;
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

export interface TeslaTelemetryClientBases {
  /** Base for the *signed* configure() write only. Per Tesla's
   * vehicle-command README, `fleet_telemetry_config` create/update "should
   * be called through the Vehicle Command Proxy" -- it signs the config
   * with the application's private key. Nothing else needs it. */
  proxyUrl: string;
  /** Base for every plain pass-through REST call (`status`, `remove`,
   * `fleetStatus`) -- the per-integration `onlyevs_integrations.region_base_url`
   * already stored at connect time. tesla-api-alignment-20260818.md D4: only
   * the signed configure() write requires the proxy; GET/DELETE
   * `fleet_telemetry_config` (and `fleet_status`) are ordinary REST calls
   * Tesla's own region API serves directly, so a proxy outage must not be
   * able to turn a healthy enrollment's status poll, or -- the failure class
   * that actually stranded a real owner integration -- its disconnect
   * teardown, into `telemetry_proxy_not_configured` churn. */
  regionBaseUrl: string;
}

export class TeslaTelemetryClient {
  constructor(
    private readonly bases: TeslaTelemetryClientBases,
    private readonly accessToken: string,
    private readonly fetcher: FetchLike = fetch,
  ) {
    // Only the access token is validated eagerly -- every base URL below is
    // validated lazily, per call, in resolveBase(). Eagerly requiring
    // `proxyUrl` here (the pre-D4 behavior) is exactly what made
    // status()/remove() depend on a proxy they never call.
    if (!accessToken) {
      throw new TeslaTelemetryError("invalid_telemetry_client_config", 0, false, null);
    }
  }

  private resolveBase(which: "proxy" | "region"): URL {
    const raw = which === "proxy" ? this.bases.proxyUrl : this.bases.regionBaseUrl;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new TeslaTelemetryError(
        which === "proxy" ? "telemetry_proxy_not_configured" : "telemetry_region_not_configured",
        0, false, null,
      );
    }
    if (url.protocol !== "https:") {
      throw new TeslaTelemetryError(
        which === "proxy" ? "telemetry_proxy_not_configured" : "telemetry_region_not_configured",
        0, false, null,
      );
    }
    return url;
  }

  private async request(
    which: "proxy" | "region",
    path: string,
    init: RequestInit,
  ): Promise<{ body: unknown; requestId: string | null }> {
    const base = this.resolveBase(which);
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, `${base.toString().replace(/\/$/, "")}/`), {
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
      throw new TeslaTelemetryError(
        which === "proxy" ? "telemetry_proxy_unreachable" : "telemetry_region_unreachable",
        0, true, null,
      );
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
    const result = await this.request("proxy", "/api/1/vehicles/fleet_telemetry_config", {
      method: "POST",
      body: JSON.stringify({ vins: [vin], config }),
    });
    const response = responseValue(result.body);
    const updated = response.updated_vehicles;
    const skipped = response.skipped_vehicles;
    let skippedVin = false;
    let skippedEntry: unknown;
    if (Array.isArray(skipped)) {
      const found = skipped.find((item) => (typeof item === "string" ? item === vin : record(item).vin === vin));
      skippedVin = found !== undefined;
      // A bare VIN string entry (the legacy shape) carries no reason of its
      // own -- only an object entry might.
      skippedEntry = typeof found === "string" ? undefined : found;
    } else {
      const root = record(skipped);
      skippedVin = Object.prototype.hasOwnProperty.call(root, vin);
      skippedEntry = root[vin];
    }
    if (skippedVin || (typeof updated === "number" && updated < 1)) {
      const reason = skippedVehicleReason(skippedEntry);
      const code = reason && SKIP_REASON_CODES[reason] ? SKIP_REASON_CODES[reason] : "telemetry_vehicle_skipped";
      throw new TeslaTelemetryError(code, 422, false, result.requestId);
    }
    return result.requestId;
  }

  async status(vin: string): Promise<{ state: TelemetryProviderState; requestId: string | null }> {
    const result = await this.request("region", `/api/1/vehicles/${encodeURIComponent(vin)}/fleet_telemetry_config`, { method: "GET" });
    const response = responseValue(result.body);
    return {
      requestId: result.requestId,
      state: {
        synced: response.synced === true,
        limitReached: response.limit_reached === true,
      },
    };
  }

  async remove(vin: string): Promise<string | null> {
    try {
      const result = await this.request("region", `/api/1/vehicles/${encodeURIComponent(vin)}/fleet_telemetry_config`, { method: "DELETE" });
      return result.requestId;
    } catch (error) {
      // Provider absence is the idempotent success condition for cleanup.
      if (error instanceof TeslaTelemetryError && error.status === 404) return error.requestId;
      throw error;
    }
  }

  /**
   * Tesla's own best-practice guidance: check the virtual key is present
   * before sending a signed command, so a missing key is never a billed,
   * rejected command (tesla-api-alignment-20260818.md D2/D3). Callers use
   * this once, before the *first* configure() for a VIN, to avoid spending
   * that billed call when it would only be rejected -- and to surface
   * `totalNumberOfKeys` for the UI to render pairing state from, per the
   * SHARED CONTRACT (never a `key_paired` field on `GET
   * fleet_telemetry_config`, which Tesla does not document there).
   */
  async fleetStatus(vin: string): Promise<TelemetryKeyProbe & { requestId: string | null }> {
    const result = await this.request("region", "/api/1/vehicles/fleet_status", {
      method: "POST",
      body: JSON.stringify({ vins: [vin] }),
    });
    const response = responseValue(result.body);
    const vehicleInfo = record(response.vehicle_info)[vin];
    const raw = record(vehicleInfo).total_number_of_keys;
    return {
      requestId: result.requestId,
      totalNumberOfKeys: typeof raw === "number" && Number.isFinite(raw) ? raw : null,
    };
  }
}
