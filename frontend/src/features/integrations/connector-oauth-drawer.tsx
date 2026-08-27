"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import {
  OAuthAuthorizeResponseSchema,
  OAuthStatusResponseSchema,
  type OAuthConnectorAuthDefinition,
  type OAuthStatusResponse,
} from "@shared/agent/oauth-connector-contract";
import { ConnectorsResponseSchema, type ConnectorView } from "@shared/agent/connector-contract";
import { Alert, Button, FormField, Input, Spinner, StatusPill } from "@/ui";
import { ExternalLink } from "@/ui/icon-registry";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import { StatusText } from "@/features/recipes/recipes-content/catalog-table-shell";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { jsonBody, requestAgentJson } from "./agent-json";
import { openExternal } from "./google-account-model";
import type { CatalogEntry } from "./connector-catalog";

/**
 * The Connect surface for an OAuth-capable catalog connector.
 *
 * There is no token field here, deliberately and permanently: the runtime owns
 * the grant. What this drawer does is narrate the flow — Connect, type the
 * shown code on the provider's site (device flow) or finish consent in the
 * opened tab (PKCE), watch the status flip to connected. The one text input
 * that can appear is the provider's PUBLIC client id, asked for once when the
 * provider ships no baked-in client, with a deep link that pre-fills the
 * provider's registration form so getting one is a click.
 */

const decodeStatus = Schema.decodeUnknownSync(OAuthStatusResponseSchema);
const decodeAuthorize = Schema.decodeUnknownSync(OAuthAuthorizeResponseSchema);
const decodeConnectors = Schema.decodeUnknownSync(ConnectorsResponseSchema);

const statusUrl = (connectorId: string) =>
  `/api/agent/oauth/status?connectorId=${encodeURIComponent(connectorId)}`;

const hostOf = (uri: string) => uri.replace(/^https?:\/\//, "");

function DeviceCodePanel({
  userCode,
  verificationUri,
}: {
  userCode: string;
  verificationUri: string;
}) {
  return (
    <div className="rounded-[var(--rad-lg)] border border-(--ui-border) bg-(--ui-surface) px-4 py-3">
      <div className="text-[length:var(--fs-xs)] uppercase tracking-wider text-(--dim)/70">
        Enter this code at {hostOf(verificationUri)}
      </div>
      <div className="mt-2 select-all font-mono text-2xl tracking-[0.2em] text-(--fg)">
        {userCode}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void openExternal(verificationUri)}>
          <ExternalLink className="h-3.5 w-3.5" />
          Open {hostOf(verificationUri)}
        </Button>
        <span className="inline-flex items-center gap-1.5 text-[length:var(--fs-sm)] text-(--dim)">
          <Spinner size="xs" />
          Waiting for approval
        </span>
      </div>
    </div>
  );
}

function FlowProgress({
  waiting,
  pending,
}: {
  waiting: boolean;
  pending: { userCode: string; verificationUri: string } | null;
}) {
  if (pending) {
    return (
      <div className="mb-6">
        <DeviceCodePanel userCode={pending.userCode} verificationUri={pending.verificationUri} />
      </div>
    );
  }
  if (!waiting) return null;
  return (
    <Alert variant="info" className="mb-6">
      Finish the sign-in in your browser. Local Studio is checking for the connection.
    </Alert>
  );
}

function ClientSetup({
  auth,
  company,
  clientDraft,
  onClientDraft,
}: {
  auth: OAuthConnectorAuthDefinition;
  company: string;
  clientDraft: string;
  onClientDraft: (next: string) => void;
}) {
  return (
    <div className="mb-6 space-y-3">
      <FormField label={`${company} OAuth client ID`} description={auth.setupHint}>
        <Input
          value={clientDraft}
          onChange={(event) => onClientDraft(event.target.value)}
          placeholder="Iv1. or Ov23li…"
          className="font-mono"
        />
      </FormField>
      <Button size="sm" variant="secondary" onClick={() => void openExternal(auth.createClientUrl)}>
        <ExternalLink className="h-3.5 w-3.5" />
        Create OAuth app
      </Button>
    </div>
  );
}

function GrantFacts({
  entry,
  status,
}: {
  entry: CatalogEntry;
  status: OAuthStatusResponse | null;
}) {
  const tools =
    entry.id === "github"
      ? [
          "Read and write repository content",
          "Review pull requests and post inline comments",
          "Create and manage issues and pull requests",
          "Inspect and run GitHub Actions workflows",
          "Manage projects, releases, packages, gists, and notifications",
        ]
      : [entry.description];
  return (
    <>
      <ResourceDrawerSection title="Tools">
        {tools.map((tool) => (
          <div key={tool} className="py-2.5 text-[length:var(--fs-sm)] text-(--ui-fg)">
            {tool}
          </div>
        ))}
      </ResourceDrawerSection>
      <ResourceDrawerSection title="Permissions">
        <ResourceFact
          label="Scopes"
          value={
            (status?.scopes.length ? status.scopes : (entry.auth?.scopes ?? [])).join(" · ") || "—"
          }
        />
      </ResourceDrawerSection>
    </>
  );
}

function FooterActions({
  entryName,
  waiting,
  connected,
  busy,
  connectDisabled,
  onClose,
  onCancel,
  onConnect,
}: {
  entryName: string;
  waiting: boolean;
  connected: boolean;
  busy: boolean;
  connectDisabled: boolean;
  onClose: () => void;
  onCancel: () => void;
  onConnect: () => void;
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Close
      </Button>
      {waiting ? (
        <Button variant="secondary" loading={busy} onClick={onCancel}>
          Cancel sign-in
        </Button>
      ) : (
        <Button loading={busy} disabled={connectDisabled} onClick={onConnect}>
          {connected ? "Add another account" : `Connect ${entryName}`}
        </Button>
      )}
    </>
  );
}

/** Status reads plus the poll that watches a flow finish on the provider's site. */
function useOAuthStatus(
  connectorId: string,
  waiting: boolean,
  onSettled: (status: OAuthStatusResponse) => void,
) {
  const [status, setStatus] = useState<OAuthStatusResponse | null>(null);
  const [error, setError] = useState("");

  const refreshStatus = useCallback(async (): Promise<OAuthStatusResponse | null> => {
    try {
      const next = await requestAgentJson(statusUrl(connectorId), decodeStatus);
      setStatus(next);
      return next;
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "OAuth status failed");
      return null;
    }
  }, [connectorId]);

  useMountSubscription(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useMountSubscription(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void refreshStatus().then((next) => {
        if (next && (next.connected || next.error)) onSettled(next);
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [waiting, refreshStatus, onSettled]);

  return { status, setStatus, error, setError, refreshStatus };
}

type ActionContext = {
  entryId: string;
  getConfigured: () => boolean;
  getEditingClient: () => boolean;
  getSeededDraft: () => string;
  setStatus: (next: OAuthStatusResponse) => void;
  setEditingClient: (next: boolean) => void;
  setError: (message: string) => void;
  setWaiting: (next: boolean) => void;
  setBusy: (next: boolean) => void;
  refreshStatus: () => Promise<OAuthStatusResponse | null>;
  refreshConnectors: () => Promise<void>;
};

const failureMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

async function saveClientAction(context: ActionContext): Promise<boolean> {
  const trimmed = context.getSeededDraft().trim();
  if (!trimmed) return false;
  const next = await requestAgentJson("/api/agent/oauth/client", decodeStatus, {
    ...jsonBody({ connectorId: context.entryId, clientId: trimmed }),
    method: "PUT",
  });
  context.setStatus(next);
  context.setEditingClient(false);
  return true;
}

async function connectAction(context: ActionContext): Promise<void> {
  context.setBusy(true);
  context.setError("");
  try {
    if (!context.getConfigured() || context.getEditingClient()) {
      if (!(await saveClientAction(context))) {
        context.setError("Paste the OAuth client ID first.");
        return;
      }
    }
    const begun = await requestAgentJson(
      "/api/agent/oauth/authorize",
      decodeAuthorize,
      jsonBody({ connectorId: context.entryId }),
    );
    if (begun.flow === "pkce") await openExternal(begun.authorizeUrl);
    context.setWaiting(true);
    await context.refreshStatus();
  } catch (connectError) {
    context.setError(failureMessage(connectError, "Connect failed"));
  } finally {
    context.setBusy(false);
  }
}

async function cancelConnectAction(context: ActionContext): Promise<void> {
  context.setBusy(true);
  try {
    await requestAgentJson(
      `/api/agent/oauth/authorize?connectorId=${encodeURIComponent(context.entryId)}`,
      () => true,
      { method: "DELETE" },
    );
  } catch {
    // Cancelling a flow that already ended is a success, not a failure.
  } finally {
    context.setWaiting(false);
    context.setBusy(false);
    void context.refreshStatus();
  }
}

async function disconnectAction(context: ActionContext, account: string): Promise<void> {
  context.setBusy(true);
  context.setError("");
  try {
    const next = await requestAgentJson(
      `/api/agent/oauth?connectorId=${encodeURIComponent(context.entryId)}&account=${encodeURIComponent(account)}`,
      decodeStatus,
      { method: "DELETE" },
    );
    context.setStatus(next);
    await context.refreshConnectors();
  } catch (disconnectError) {
    context.setError(failureMessage(disconnectError, "Disconnect failed"));
  } finally {
    context.setBusy(false);
  }
}

export function ConnectorOAuthDrawer({
  entry,
  connectors,
  onClose,
  onChanged,
}: {
  entry: CatalogEntry;
  connectors: readonly ConnectorView[];
  onClose: () => void;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [clientDraft, setClientDraft] = useState("");
  const [editingClient, setEditingClient] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshConnectors = useCallback(async () => {
    const { connectors } = await requestAgentJson("/api/agent/connectors", decodeConnectors);
    onChanged(connectors);
  }, [onChanged]);

  const onFlowSettled = useCallback(
    (settled: OAuthStatusResponse) => {
      setWaiting(false);
      if (settled.connected) void refreshConnectors();
      else if (settled.error) setError(settled.error);
    },
    [refreshConnectors],
  );

  const { status, setStatus, error, setError, refreshStatus } = useOAuthStatus(
    entry.id,
    waiting,
    onFlowSettled,
  );

  const seededDraft = clientDraft || status?.clientId || "";
  const context: ActionContext = {
    entryId: entry.id,
    getConfigured: () => Boolean(status?.configured),
    getEditingClient: () => editingClient,
    getSeededDraft: () => seededDraft,
    setStatus,
    setEditingClient,
    setError,
    setWaiting,
    setBusy,
    refreshStatus,
    refreshConnectors,
  };

  const connected = Boolean(status?.connected);
  const needsClient = Boolean(status) && !status?.configured;
  const canEditClient = Boolean(entry.auth?.clientIdEnv);
  const showClientSetup = Boolean(canEditClient && status && (needsClient || editingClient));

  return (
    <ResourceDrawer
      title={entry.name}
      icon={<ResourceLogo identity={entry.id} label={entry.name} company={entry.company} />}
      badge={
        <StatusPill tone={connected ? "good" : "default"}>
          {connected ? "connected" : "not connected"}
        </StatusPill>
      }
      status={connected ? `${status?.accounts?.length ?? 1} connected` : entry.company}
      footer={
        <FooterActions
          entryName={entry.name}
          waiting={waiting}
          connected={connected}
          busy={busy}
          connectDisabled={!status || (needsClient && !seededDraft.trim())}
          onClose={onClose}
          onCancel={() => void cancelConnectAction(context)}
          onConnect={() => void connectAction(context)}
        />
      }
      onClose={onClose}
      width={620}
    >
      <DrawerBody
        entry={entry}
        connectors={connectors}
        status={status}
        error={error}
        waiting={waiting}
        connected={connected}
        showClientSetup={showClientSetup}
        canEditClient={canEditClient}
        seededDraft={seededDraft}
        editingClient={editingClient}
        onClientDraft={setClientDraft}
        onEditClient={() => setEditingClient(true)}
        onDisconnect={(account) => void disconnectAction(context, account)}
      />
    </ResourceDrawer>
  );
}

function DrawerBody({
  entry,
  connectors,
  status,
  error,
  waiting,
  connected,
  showClientSetup,
  canEditClient,
  seededDraft,
  editingClient,
  onClientDraft,
  onEditClient,
  onDisconnect,
}: {
  entry: CatalogEntry;
  connectors: readonly ConnectorView[];
  status: OAuthStatusResponse | null;
  error: string;
  waiting: boolean;
  connected: boolean;
  showClientSetup: boolean;
  canEditClient: boolean;
  seededDraft: string;
  editingClient: boolean;
  onClientDraft: (next: string) => void;
  onEditClient: () => void;
  onDisconnect: (account: string) => void;
}) {
  return (
    <>
      {!status && !error ? (
        <div className="mb-6 flex items-center gap-2 text-(--dim)">
          <Spinner size="xs" />
          <span className="text-[length:var(--fs-sm)]">Reading connection state</span>
        </div>
      ) : null}

      {showClientSetup && entry.auth ? (
        <ClientSetup
          auth={entry.auth}
          company={entry.company}
          clientDraft={seededDraft}
          onClientDraft={onClientDraft}
        />
      ) : null}

      <FlowProgress waiting={waiting} pending={waiting ? (status?.pending ?? null) : null} />

      {status?.accounts?.length ? (
        <ResourceDrawerSection title="Accounts">
          {status.accounts.map((account) => {
            const enabled = connectors.some(
              (connector) => connector.auth?.account === account.id && connector.enabled,
            );
            return (
              <ResourceFact
                key={account.id}
                label={account.label}
                value={
                  <span className="flex items-center justify-between gap-3">
                    <StatusText tone={enabled ? "ok" : "dim"}>
                      {enabled ? "Available" : "Connected"}
                    </StatusText>
                    <Button size="sm" variant="secondary" onClick={() => onDisconnect(account.id)}>
                      Disconnect
                    </Button>
                  </span>
                }
              />
            );
          })}
        </ResourceDrawerSection>
      ) : null}

      <GrantFacts entry={entry} status={status} />

      {canEditClient && status?.configured && !editingClient && !connected && !waiting ? (
        <button
          type="button"
          onClick={onEditClient}
          className="mt-4 text-[length:var(--fs-sm)] text-(--link) hover:underline"
        >
          Change the OAuth client ID
        </button>
      ) : null}

      {error ? (
        <div className="mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
    </>
  );
}
