export interface TeslaInvitation {
  id: string;
  url: string | null;
}

export interface TeslaDriver {
  id: string;
  subject: string | null;
}

export interface TeslaRequestResult<T> {
  value: T;
  requestId: string | null;
}

export class TeslaAccessError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly requestId: string | null,
  ) {
    super(code);
    this.name = "TeslaAccessError";
  }
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function responseValue(body: unknown): unknown {
  const root = record(body);
  return Object.prototype.hasOwnProperty.call(root, "response") ? root.response : body;
}

function rows(value: unknown, collection: string): unknown[] {
  const candidate = responseValue(value);
  if (Array.isArray(candidate)) return candidate;
  const nested = record(candidate)[collection];
  return Array.isArray(nested) ? nested : [];
}

function firstText(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (typeof row[key] === "string" && String(row[key]).trim()) return String(row[key]).trim();
  }
  return null;
}

function firstIdentifier(row: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) {
      return String(value).trim();
    }
  }
  return null;
}

export function isTeslaInvitationUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && (hostname === "tesla.com" || hostname.endsWith(".tesla.com"))
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}

export function parseTeslaInvitations(value: unknown): TeslaInvitation[] {
  return rows(value, "invitations").flatMap((item) => {
    const row = record(item);
    const id = firstText(row, ["id", "invitation_id"]);
    if (!id) return [];
    const url = firstText(row, ["share_url", "share_link", "url"]);
    return [{ id, url: url && isTeslaInvitationUrl(url) ? url : null }];
  });
}

export function parseTeslaDrivers(value: unknown): TeslaDriver[] {
  return rows(value, "drivers").flatMap((item) => {
    const row = record(item);
    const id = firstIdentifier(row, ["id", "driver_id", "share_user_id"]);
    if (!id) return [];
    return [{ id, subject: firstIdentifier(row, ["subject", "user_id"]) }];
  });
}

export class TeslaAccessClient {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly fetcher: FetchLike = fetch,
  ) {
    if (!/^https:\/\//.test(baseUrl) || !accessToken) throw new Error("invalid_tesla_client_config");
  }

  private async request(path: string, init: RequestInit): Promise<TeslaRequestResult<unknown>> {
    const response = await this.fetcher(new URL(path, `${this.baseUrl.replace(/\/$/, "")}/`), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      signal: init.signal ?? AbortSignal.timeout(8_000),
    });
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id");
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = record(record(body).error);
      const code = firstText(error, ["code", "message"]) ?? `tesla_http_${response.status}`;
      throw new TeslaAccessError(code, response.status, response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500, requestId);
    }
    return { value: body, requestId };
  }

  async listInvitations(vin: string): Promise<TeslaRequestResult<TeslaInvitation[]>> {
    const result = await this.request(`/api/1/vehicles/${encodeURIComponent(vin)}/invitations`, { method: "GET" });
    return { value: parseTeslaInvitations(result.value), requestId: result.requestId };
  }

  async createInvitation(vin: string): Promise<TeslaRequestResult<TeslaInvitation | null>> {
    const result = await this.request(`/api/1/vehicles/${encodeURIComponent(vin)}/invitations`, { method: "POST", body: "{}" });
    const direct = parseTeslaInvitations({ response: [responseValue(result.value)] })[0] ?? null;
    return { value: direct, requestId: result.requestId };
  }

  async revokeInvitation(vin: string, invitationId: string): Promise<TeslaRequestResult<true>> {
    const result = await this.request(`/api/1/vehicles/${encodeURIComponent(vin)}/invitations/${encodeURIComponent(invitationId)}/revoke`, { method: "POST", body: "{}" });
    return { value: true, requestId: result.requestId };
  }

  async listDrivers(vin: string): Promise<TeslaRequestResult<TeslaDriver[]>> {
    const result = await this.request(`/api/1/vehicles/${encodeURIComponent(vin)}/drivers`, { method: "GET" });
    return { value: parseTeslaDrivers(result.value), requestId: result.requestId };
  }

  /** Remove one exact share user returned by the owner-only drivers list. */
  async removeDriver(vin: string, shareUserId: string): Promise<TeslaRequestResult<true>> {
    if (!shareUserId.trim()) throw new Error("invalid_tesla_share_user_id");
    const query = new URLSearchParams({ share_user_id: shareUserId }).toString();
    const result = await this.request(
      `/api/1/vehicles/${encodeURIComponent(vin)}/drivers?${query}`,
      { method: "DELETE" },
    );
    return { value: true, requestId: result.requestId };
  }
}
