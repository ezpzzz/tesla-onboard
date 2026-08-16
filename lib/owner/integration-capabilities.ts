import { parseCredentialKeyring } from "@/lib/owner/credential-envelope";

export type TeslaConnectionMode = "durable" | "fleet_import" | "unavailable";

export interface OwnerIntegrationCapabilities {
  operationsEnabled: boolean;
  tesla: {
    configured: boolean;
    connectionMode: TeslaConnectionMode;
  };
  googleCalendar: {
    configured: boolean;
    connectionEnabled: boolean;
    automaticSyncEnabled: boolean;
  };
  turoEmail: {
    configured: boolean;
    intakeEnabled: boolean;
    automationEnabled: boolean;
  };
}

type IntegrationEnvironment = Record<string, string | undefined>;

function present(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function validUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function hasValidKeyring(value: string | undefined): boolean {
  try {
    parseCredentialKeyring(value ?? "");
    return true;
  } catch {
    return false;
  }
}

/**
 * Produces the browser-safe connection contract from server configuration.
 * It intentionally reports capabilities, never credential values.
 */
export function deriveOwnerIntegrationCapabilities(
  env: IntegrationEnvironment,
): OwnerIntegrationCapabilities {
  const operationsEnabled = env.NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED === "true";
  const mockTesla = env.NEXT_PUBLIC_TESLA_AUTH_MODE === "mock" && env.NODE_ENV !== "production";
  const teslaReadConfigured = mockTesla || (
    present(env.TESLA_CLIENT_ID)
    && present(env.TESLA_CLIENT_SECRET)
    && validUrl(env.TESLA_OWNER_REDIRECT_URI)
    && (env.TESLA_SESSION_SECRET?.length ?? 0) >= 32
  );
  const encryptedCredentialsConfigured = hasValidKeyring(env.ONLYEVS_DATA_ENCRYPTION_KEYS);
  const durableTeslaConfigured = teslaReadConfigured && encryptedCredentialsConfigured;
  const googleStateSecret = env.ONLYEVS_OAUTH_STATE_SECRET ?? env.TESLA_SESSION_SECRET;
  const googleConfigured = (
    present(env.GOOGLE_CALENDAR_CLIENT_ID)
    && present(env.GOOGLE_CALENDAR_CLIENT_SECRET)
    && validUrl(env.GOOGLE_CALENDAR_REDIRECT_URI)
    && encryptedCredentialsConfigured
    && (googleStateSecret?.length ?? 0) >= 32
  );
  const turoEmailConfigured = hasValidKeyring(env.EVHOST_EMAIL_ALIAS_HMAC_KEYS)
    && hasValidKeyring(env.ONLYEVS_DATA_ENCRYPTION_KEYS);

  return {
    operationsEnabled,
    tesla: {
      configured: teslaReadConfigured,
      connectionMode: operationsEnabled && durableTeslaConfigured
        ? "durable"
        : teslaReadConfigured
          ? "fleet_import"
          : "unavailable",
    },
    googleCalendar: {
      configured: googleConfigured,
      connectionEnabled: googleConfigured,
      automaticSyncEnabled: googleConfigured && operationsEnabled,
    },
    turoEmail: {
      configured: turoEmailConfigured,
      intakeEnabled: turoEmailConfigured && env.EVHOST_EMAIL_INGEST_ENABLED === "true",
      automationEnabled: turoEmailConfigured && env.ONLYEVS_EMAIL_WORKER_ENABLED === "true",
    },
  };
}

export function getOwnerIntegrationCapabilities(): OwnerIntegrationCapabilities {
  return deriveOwnerIntegrationCapabilities(process.env);
}
