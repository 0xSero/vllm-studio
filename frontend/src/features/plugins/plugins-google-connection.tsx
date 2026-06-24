"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { effectInterval } from "@/lib/effect-timers";
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

type GoogleStatus = {
  hasCredentials: boolean;
  configuredByApp: boolean;
  connected: boolean;
  email: string;
  scopes: string[];
  accessTokenExpiresAt: number;
};

const getSnapshot = (): number => 0;

export function GoogleConnectionPanel() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvancedClient, setShowAdvancedClient] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/oauth/google", { cache: "no-store" });
      if (!response.ok) return;
      setStatus((await response.json()) as GoogleStatus);
    } catch {
      // Status stays null; the panel shows the "not configured" prompt.
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

  const post = useCallback(async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/oauth/google", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as GoogleStatus & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "Request failed.");
      setStatus(data);
      return true;
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "Request failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

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
    window.open("/api/oauth/google/start", "_blank", "noopener,noreferrer");
    let elapsed = 0;
    const poll = effectInterval(() => {
      elapsed += 1;
      void load().then(() => {
        if (elapsed >= 40) poll.cancel();
      });
    }, 1500);
  }, [load]);

  const connected = status?.connected ?? false;
  const hasCredentials = status?.hasCredentials ?? false;
  const configuredByApp = status?.configuredByApp ?? false;
  const showClientForm = showAdvancedClient && !configuredByApp;

  return (
    <SettingsGroup
      title="Google account"
      description="Connect Google once. OAuth-capable MCP servers use the refreshable token automatically; no plugin env or key fields are needed."
      actions={
        connected ? (
          <StatusPill tone="good" variant="badge">
            <Check className="mr-1 h-3 w-3" />
            connected{status?.email ? ` · ${status.email}` : ""}
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
          Google OAuth is not configured for this app. Set the app-level Google OAuth client, or use
          the advanced local fallback below.
        </SettingsNotice>
      ) : null}

      {showClientForm ? (
        <>
          <SettingsRow
            label="Client ID"
            control={
              <SettingsInput
                value={clientId}
                onChange={setClientId}
                placeholder="xxxxxxxx.apps.googleusercontent.com"
              />
            }
          />
          <SettingsRow
            label="Client secret"
            control={
              <SettingsInput
                value={clientSecret}
                onChange={setClientSecret}
                type="password"
                placeholder={hasCredentials ? "•••••••• (saved — enter to replace)" : "GOCSPX-..."}
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
          {connected ? "Reconnect Google" : "Connect Google"}
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
