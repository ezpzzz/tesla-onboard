"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { IconAlert, IconBolt, IconCalendar, IconCheck, IconShield } from "@/components/icons";
import { Badge, Button, Card, buttonClassName, cn } from "@/components/ui";
import type { OwnerIntegrationCapabilities } from "@/lib/owner/integration-capabilities";
import { connectHref } from "@/lib/owner/use-owner-tesla-connect";
import {
  disconnectOwnerIntegration,
  fetchOwnerIntegrations,
  type OwnerIntegration,
} from "@/lib/owner/integration-repository";
import { vehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import type { IntegrationProvider } from "@/lib/owner/access-types";

interface OwnerIntegrationsProps {
  capabilities: OwnerIntegrationCapabilities;
}

function statusTone(status: OwnerIntegration["status"]): "good" | "warn" | "neutral" {
  return status === "connected" ? "good" : status === "disconnected" ? "neutral" : "warn";
}

function statusLabel(status: OwnerIntegration["status"]): string {
  switch (status) {
    case "connected": return "Connected";
    case "degraded": return "Needs attention";
    case "disconnecting": return "Disconnecting";
    case "reauth_required": return "Reconnect needed";
    case "disconnected": return "Not connected";
  }
}

function lastSyncLabel(timestamp: number | null): string | null {
  if (!timestamp) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}

function oauthMessage(code: string): string {
  switch (code) {
    case "config": return "Google Calendar needs administrator setup before it can connect.";
    case "denied": return "Google Calendar access was cancelled. No changes were made.";
    case "session": return "Your owner session expired. Sign in and try again.";
    case "workspace_access": return "You no longer have permission to manage integrations for this workspace.";
    case "origin_mismatch": return "Open evhost.app at its configured domain and try again.";
    case "persistent_grant_missing": return "Google did not grant background calendar access. Reconnect and approve the requested permission.";
    default: return "Google Calendar could not connect. Try again or contact support.";
  }
}

export function OwnerIntegrations({ capabilities }: OwnerIntegrationsProps) {
  const { workspace } = useOwnerTenant();
  const scope = useMemo(
    () => vehicleWorkspaceScope(workspace?.tenantRef),
    [workspace?.tenantRef],
  );
  const scopeKey = scope ? `${scope.workspaceId}:${scope.shopSlug}` : null;
  const [connectionState, setConnectionState] = useState<{
    scopeKey: string | null;
    integrations: OwnerIntegration[];
  }>({ scopeKey: null, integrations: [] });
  const integrations = connectionState.scopeKey === scopeKey
    ? connectionState.integrations
    : [];
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<IntegrationProvider | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    if (!scope) {
      setConnectionState({ scopeKey: null, integrations: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchOwnerIntegrations(scope);
      if (version === requestVersion.current) {
        setConnectionState({ scopeKey, integrations: next });
      }
    } catch (error) {
      if (version === requestVersion.current) {
        setMessage(error instanceof Error ? error.message : "Connections could not be loaded.");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [scope, scopeKey]);

  useEffect(() => {
    setMessage(null);
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("google_calendar_error");
    if (error) setMessage(oauthMessage(error));
    if (params.get("google_calendar_connected") === "1") {
      setMessage("Google Calendar connected. Imported events are ready to review on Trips.");
      void load();
    }
    if (error || params.has("google_calendar_connected")) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }, [load]);

  function connect(provider: IntegrationProvider) {
    if (!scope) return;
    if (provider === "tesla") {
      window.location.href = connectHref({
        workspaceId: scope.workspaceId,
        shopSlug: scope.shopSlug,
        returnPath: "/owner/integrations",
      });
      return;
    }
    const params = new URLSearchParams({
      workspace: scope.workspaceId,
      shop: scope.shopSlug,
    });
    window.location.href = `/api/owner/google/login?${params.toString()}`;
  }

  async function disconnect(provider: IntegrationProvider) {
    if (!scope) return;
    setBusy(provider);
    setMessage(null);
    try {
      await disconnectOwnerIntegration(scope, provider);
      setMessage(provider === "tesla"
        ? "Tesla cleanup is queued. The encrypted credential is removed after telemetry is detached from every vehicle."
        : "Google Calendar disconnected. Its stored credential was destroyed.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The connection could not be disconnected.");
    } finally {
      setBusy(null);
    }
  }

  const tesla = integrations.find((item) => item.provider === "tesla");
  const google = integrations.find((item) => item.provider === "google_calendar");

  return (
    <section className="space-y-4" aria-label="Workspace connections">
      <div className="flex items-start gap-3 rounded-lg border border-line bg-white p-4 sm:p-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
          <IconShield aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Private by design</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Each workspace authorizes its own accounts. Credentials are encrypted server-side and are never returned to this browser.
          </p>
        </div>
      </div>

      {message ? (
        <div role="status" aria-live="polite" className="flex items-start gap-2 rounded-lg border border-line bg-white p-3 text-sm text-ink-soft">
          <IconAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <span className="min-w-0 break-words">{message}</span>
        </div>
      ) : null}

      <IntegrationCard
        title="Tesla Fleet"
        eyebrow="Vehicle connection"
        description={capabilities.tesla.connectionMode === "durable"
          ? "Import your fleet, keep vehicle readiness current, and manage trip-bound driver access."
          : "Securely import vehicles from your Tesla account without enabling vehicle commands or telemetry."}
        icon={<IconBolt aria-hidden="true" className="h-5 w-5" />}
        integration={tesla}
        loading={loading}
        configured={capabilities.tesla.configured}
        detail={capabilities.tesla.connectionMode === "durable"
          ? "Fleet sync and access automation are available."
          : capabilities.tesla.connectionMode === "fleet_import"
            ? "Fleet import is available. Live stats and access automation stay off until operations infrastructure is verified."
            : "Tesla OAuth must be configured by an administrator."}
        action={capabilities.tesla.connectionMode === "fleet_import"
          ? (
              <Link
                href="/owner/setup?step=connect"
                className={buttonClassName({ variant: "brand", className: "w-full sm:w-auto" })}
              >
                Import Tesla fleet
              </Link>
            )
          : capabilities.tesla.connectionMode === "durable"
            ? (
                <Button
                  variant="brand"
                  className="w-full sm:w-auto"
                  onClick={() => connect("tesla")}
                  disabled={loading || busy !== null || tesla?.status === "disconnecting"}
                >
                  {tesla?.status === "connected" ? "Reconnect" : "Connect Tesla"}
                </Button>
              )
            : <Button className="w-full sm:w-auto" disabled>Setup required</Button>}
        secondaryAction={tesla?.status === "connected" && capabilities.tesla.connectionMode === "durable"
          ? (
              <Button variant="ghost" onClick={() => void disconnect("tesla")} disabled={busy !== null}>
                {busy === "tesla" ? "Disconnecting…" : "Disconnect"}
              </Button>
            )
          : null}
      />

      <IntegrationCard
        title="Google Calendar"
        eyebrow="Trip intake"
        description="Import upcoming booking events into a private review queue. Nothing becomes a trip until you approve it."
        icon={<IconCalendar aria-hidden="true" className="h-5 w-5" />}
        integration={google}
        loading={loading}
        configured={capabilities.googleCalendar.configured}
        detail={capabilities.googleCalendar.automaticSyncEnabled
          ? "Automatic calendar refresh is available."
          : capabilities.googleCalendar.connectionEnabled
            ? "Initial import is available. Automatic refresh starts after the operations service is enabled."
            : "Google Calendar OAuth and encryption must be configured by an administrator."}
        action={capabilities.googleCalendar.connectionEnabled
          ? (
              <Button
                variant="brand"
                className="w-full sm:w-auto"
                onClick={() => connect("google_calendar")}
                disabled={loading || busy !== null || google?.status === "disconnecting" || !scope}
              >
                {google?.status === "connected" ? "Reconnect" : "Connect Google"}
              </Button>
            )
          : <Button className="w-full sm:w-auto" disabled>Setup required</Button>}
        secondaryAction={google?.status === "connected"
          ? (
              <Button variant="ghost" onClick={() => void disconnect("google_calendar")} disabled={busy !== null}>
                {busy === "google_calendar" ? "Disconnecting…" : "Disconnect"}
              </Button>
            )
          : null}
      />
    </section>
  );
}

function IntegrationCard({
  title,
  eyebrow,
  description,
  icon,
  integration,
  loading,
  configured,
  detail,
  action,
  secondaryAction,
}: {
  title: string;
  eyebrow: string;
  description: string;
  icon: ReactNode;
  integration: OwnerIntegration | undefined;
  loading: boolean;
  configured: boolean;
  detail: string;
  action: ReactNode;
  secondaryAction: ReactNode;
}) {
  const connected = integration?.status === "connected";
  const syncLabel = lastSyncLabel(integration?.lastSyncAt ?? null);
  const badge = loading
    ? { label: "Checking", tone: "neutral" as const }
    : integration
      ? { label: statusLabel(integration.status), tone: statusTone(integration.status) }
      : configured
        ? { label: "Ready to connect", tone: "brand" as const }
        : { label: "Setup required", tone: "neutral" as const };

  return (
    <Card className="overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3.5">
          <span className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
            connected ? "bg-good/10 text-good" : "bg-brand/10 text-brand",
          )}>
            {connected ? <IconCheck aria-hidden="true" className="h-5 w-5" /> : icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">{eyebrow}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-[-0.01em] text-ink">{title}</h2>
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p>
          </div>
        </div>

        <div className="mt-4 rounded-md bg-surface px-3.5 py-3">
          <div className="flex items-start gap-2.5">
            <span className={cn(
              "mt-1 h-2 w-2 shrink-0 rounded-full",
              connected ? "bg-good" : configured ? "bg-brand" : "bg-muted/50",
            )} />
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-ink-soft">
                {integration?.accountLabel ? `Connected as ${integration.accountLabel}` : detail}
              </p>
              {integration?.accountLabel ? <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p> : null}
              {syncLabel ? <p className="mt-1 text-xs text-muted">Last synced {syncLabel}</p> : null}
              {integration?.lastErrorCode ? <p className="mt-1 text-xs text-warn">Connection needs review.</p> : null}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          {action}
          {secondaryAction}
        </div>
      </div>
    </Card>
  );
}
