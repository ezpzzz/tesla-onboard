"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOwnerTenant } from "@/components/owner/OwnerTenantProvider";
import { Badge, Button, Card } from "@/components/ui";
import { connectHref } from "@/lib/owner/use-owner-tesla-connect";
import {
  disconnectOwnerIntegration,
  fetchOwnerIntegrations,
  type OwnerIntegration,
} from "@/lib/owner/integration-repository";
import { vehicleWorkspaceScope } from "@/lib/owner/vehicle-repository";
import type { IntegrationProvider } from "@/lib/owner/access-types";

const COPY: Record<IntegrationProvider, { title: string; description: string }> = {
  tesla: {
    title: "Tesla Fleet API",
    description: "Imports vehicles, receives operational stats, and creates or revokes trip-bound driver access.",
  },
  google_calendar: {
    title: "Google Calendar",
    description: "Reads upcoming calendar events into a review queue. Events never become trips automatically.",
  },
};

function statusTone(status: OwnerIntegration["status"]): "good" | "warn" | "neutral" {
  return status === "connected" ? "good" : status === "disconnected" ? "neutral" : "warn";
}

export function OwnerIntegrations() {
  const { workspace } = useOwnerTenant();
  const scope = useMemo(
    () => vehicleWorkspaceScope(workspace?.tenantRef),
    [workspace?.tenantRef],
  );
  const [integrations, setIntegrations] = useState<OwnerIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<IntegrationProvider | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setIntegrations([]);
    setMessage(null);
    if (!scope) {
      setIntegrations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await fetchOwnerIntegrations(scope);
      if (version === requestVersion.current) setIntegrations(next);
    } catch (error) {
      if (version === requestVersion.current) {
        setMessage(error instanceof Error ? error.message : "Integrations could not be loaded.");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("google_calendar_error");
    if (error) setMessage(`Google Calendar connection failed: ${error.replaceAll("_", " ")}.`);
    if (params.get("google_calendar_connected") === "1") {
      setMessage("Google Calendar connected. Review imported events on Trips.");
      void load();
    }
    if (error || params.has("google_calendar_connected")) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
  }, [load]);

  function connect(provider: IntegrationProvider) {
    if (!workspace || !scope) return;
    if (provider === "tesla") {
      window.location.href = connectHref({
        workspaceId: scope.workspaceId,
        shopSlug: scope.shopSlug,
        returnPath: "/owner/settings",
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
        ? "Tesla disconnect queued. Telemetry is removed from every VIN before the encrypted credential is destroyed."
        : `${COPY[provider].title} disconnected and its stored credential was destroyed.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The integration could not be disconnected.");
    } finally {
      setBusy(null);
    }
  }

  if (!workspace || !scope) return null;
  return (
    <section className="space-y-3" aria-labelledby="integrations-title">
      <div>
        <h2 id="integrations-title" className="text-base font-semibold text-ink">Integrations</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Credentials are encrypted per workspace and never exposed to the browser after OAuth.
        </p>
      </div>
      {message ? <div role="status" className="rounded-md border border-line bg-white p-3 text-sm text-ink-soft">{message}</div> : null}
      {(["tesla", "google_calendar"] as const).map((provider) => {
        const integration = integrations.find((item) => item.provider === provider);
        const connected = integration?.status === "connected";
        const disconnecting = integration?.status === "disconnecting";
        return (
          <Card key={provider} className="p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-ink">{COPY[provider].title}</h3>
                  <Badge tone={statusTone(integration?.status ?? "disconnected")}>
                    {loading ? "Loading" : (integration?.status ?? "disconnected").replaceAll("_", " ")}
                  </Badge>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted">{COPY[provider].description}</p>
                {integration?.accountLabel ? (
                  <p className="mt-1 truncate text-xs text-muted">Connected as {integration.accountLabel}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" onClick={() => connect(provider)} disabled={loading || busy !== null || disconnecting}>
                  {connected ? "Reconnect" : disconnecting ? "Cleaning up…" : "Connect"}
                </Button>
                {connected ? (
                  <Button variant="ghost" onClick={() => void disconnect(provider)} disabled={busy !== null}>
                    {busy === provider ? "Disconnecting…" : "Disconnect"}
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>
        );
      })}
    </section>
  );
}
