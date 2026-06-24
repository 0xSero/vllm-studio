"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { effectInterval } from "@/lib/effect-timers";
import { getOAuthProvider } from "@/features/agent/oauth/oauth-providers";
import { Check, CircleAlert } from "@/ui/icon-registry";
import {
  SettingsActions,
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsNotice,
  SettingsRow,
} from "@/ui/settings";
import { StatusPill } from "@/ui/status";

type OAuthStatus = {
  providerId: string;
  displayName: string;
  hasCredentials: boolean;
  configuredByApp: boolean;
  connected: boolean;
  email: string;
  scopes: string[];
  accessTokenExpiresAt: number;
};

const getSnapshot = (): number => 0;

export function ConnectionsPanel() {
  const [statuses, setStatuses] = useState<OAuthStatus[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/oauth", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { providers?: OAuthStatus[] };
      setStatuses(data.providers ?? []);
    } catch {
      // Leave statuses as-is; each card shows its "not configured" prompt.
    }
  }, []);

  const subscribe = useCallback(
    (_notify: () => void) => {
      void load();
      return () => {};
    },
    [load],
  );

  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (statuses.length === 0) return null;

  return (
    <div className="space-y-5">
      {statuses.map((status) => (
        <ProviderConnectionCard key={status.providerId} status={status} onReload={load} />
      ))}
    </div>
  );
}

function ProviderConnectionCard({
  status,
  onReload,
}: {
  status: OAuthStatus;
  onReload: () => Promise<void>;
}) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvancedClient, setShowAdvancedClient] = useState(false);

  const providerId = status.providerId;
  const description = getOAuthProvider(providerId)?.description ?? "";

  const post = useCallback(
    async (body: unknown) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(`/api/oauth/${providerId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
        await onReload();
        return true;
      } catch (postError) {
        setError(postError instanceof Error ? postError.message : "Request failed.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onReload, providerId],
  );

  const saveClient = useCallback(() => {
    void post({
      action: "save_client",
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
    }).then((ok) => {
      if (ok) setClientSecret("");
    });
  }, [clientId, clientSecret, post]);

  const disconnect = useCallback(() => {
    void post({ action: "disconnect" });
  }, [post]);

  const connect = useCallback(() => {
    window.open(`/api/oauth/${providerId}/start`, "_blank", "noopener,noreferrer");
    let elapsed = 0;
    const poll = effectInterval(() => {
      elapsed += 1;
      void onReload().then(() => {
        if (elapsed >= 40) poll.cancel();
      });
    }, 1500);
  }, [onReload, providerId]);

  const { connected, hasCredentials, configuredByApp } = status;
  const showClientForm = showAdvancedClient && !configuredByApp;

  return (
    <SettingsGroup
      title={`${status.displayName} account`}
      description={description}
      actions={
        connected ? (
          <StatusPill tone="good" variant="badge">
            <Check className="mr-1 h-3 w-3" />
            connected{status.email ? ` · ${status.email}` : ""}
          </StatusPill>
        ) : (
          <StatusPill tone="warning" variant="badge">
            <CircleAlert className="mr-1 h-3 w-3" />
            not connected
          </StatusPill>
        )
      }
    >
      {error ? (
        <SettingsNotice tone="danger" className="mb-3">
          {error}
        </SettingsNotice>
      ) : null}

      {!hasCredentials ? (
        <SettingsNotice tone="warning" className="mb-3">
          {status.displayName} OAuth is not configured for this app. Set the app-level OAuth client,
          or use the advanced local fallback below.
        </SettingsNotice>
      ) : null}

      {showClientForm ? (
        <>
          <SettingsRow
            label="Client ID"
            control={
              <SettingsInput value={clientId} onChange={setClientId} placeholder="Client ID" />
            }
          />
          <SettingsRow
            label="Client secret"
            control={
              <SettingsInput
                value={clientSecret}
                onChange={setClientSecret}
                type="password"
                placeholder={
                  hasCredentials ? "•••••••• (saved — enter to replace)" : "Client secret"
                }
              />
            }
          />
        </>
      ) : null}
      <SettingsActions>
        {!configuredByApp ? (
          showClientForm ? (
            <SettingsButton
              onClick={saveClient}
              disabled={busy || !clientId.trim() || !clientSecret.trim()}
            >
              Save fallback OAuth client
            </SettingsButton>
          ) : (
            <SettingsButton onClick={() => setShowAdvancedClient(true)} disabled={busy}>
              Advanced: local OAuth client
            </SettingsButton>
          )
        ) : null}
        <SettingsButton tone="primary" onClick={connect} disabled={busy || !hasCredentials}>
          {connected ? `Reconnect ${status.displayName}` : `Connect ${status.displayName}`}
        </SettingsButton>
        {connected ? (
          <SettingsButton tone="danger" onClick={disconnect} disabled={busy}>
            Disconnect
          </SettingsButton>
        ) : null}
      </SettingsActions>
    </SettingsGroup>
  );
}
