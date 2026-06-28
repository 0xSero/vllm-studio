"use client";

import { useState } from "react";
import { OAUTH_PROVIDERS, type OAuthProvider } from "@/features/agent/oauth/oauth-providers";
import { ExternalLink, KeyRound, LogOut, ShieldCheck } from "@/ui/icon-registry";
import {
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsNotice,
  SettingsRow,
  StatusPill,
} from "@/ui";

export type OAuthStatusView = {
  providerId: string;
  displayName: string;
  hasCredentials: boolean;
  configuredByApp: boolean;
  connected: boolean;
  email: string;
};

export type OAuthClientDraft = {
  clientId: string;
  clientSecret: string;
};

export type OAuthClientDrafts = Record<string, OAuthClientDraft>;

export function OAuthConnectionsPanel({
  statuses,
  drafts,
  busyId,
  onDraftChange,
  onSaveClient,
  onConnect,
  onStartGcloud,
  onDisconnect,
}: {
  statuses: OAuthStatusView[];
  drafts: OAuthClientDrafts;
  busyId: string | null;
  onDraftChange: (providerId: string, draft: OAuthClientDraft) => void;
  onSaveClient: (providerId: string) => void;
  onConnect: (providerId: string) => void;
  onStartGcloud: (providerId: string) => void;
  onDisconnect: (providerId: string) => void;
}) {
  const [manualProviderId, setManualProviderId] = useState<string | null>(null);
  const statusMap = new Map(statuses.map((status) => [status.providerId, status]));
  return (
    <SettingsGroup
      title="Accounts"
      description="Connect accounts once. Local Studio installs the managed MCP tools and refreshes provider tokens locally."
    >
      {OAUTH_PROVIDERS.map((provider) => {
        const status = statusMap.get(provider.id);
        return (
          <OAuthProviderRow
            key={provider.id}
            provider={provider}
            status={status}
            draft={drafts[provider.id] ?? { clientId: "", clientSecret: "" }}
            busyId={busyId}
            manualOpen={manualProviderId === provider.id}
            onManualToggle={() =>
              setManualProviderId((current) => (current === provider.id ? null : provider.id))
            }
            onDraftChange={onDraftChange}
            onSaveClient={onSaveClient}
            onConnect={onConnect}
            onStartGcloud={onStartGcloud}
            onDisconnect={onDisconnect}
          />
        );
      })}
    </SettingsGroup>
  );
}

function OAuthProviderRow({
  provider,
  status,
  draft,
  busyId,
  manualOpen,
  onManualToggle,
  onDraftChange,
  onSaveClient,
  onConnect,
  onStartGcloud,
  onDisconnect,
}: {
  provider: OAuthProvider;
  status: OAuthStatusView | undefined;
  draft: OAuthClientDraft;
  busyId: string | null;
  manualOpen: boolean;
  onManualToggle: () => void;
  onDraftChange: (providerId: string, draft: OAuthClientDraft) => void;
  onSaveClient: (providerId: string) => void;
  onConnect: (providerId: string) => void;
  onStartGcloud: (providerId: string) => void;
  onDisconnect: (providerId: string) => void;
}) {
  const saving = busyId === oauthBusyId(provider.id, "save");
  const connecting = busyId === oauthBusyId(provider.id, "connect");
  const disconnecting = busyId === oauthBusyId(provider.id, "disconnect");
  const gcloudStarting = busyId === oauthBusyId(provider.id, "gcloud");
  const canSave = Boolean(draft.clientId.trim() && draft.clientSecret.trim());

  return (
    <SettingsRow
      variant="resource"
      label={connectionLabel(provider.id, provider.displayName)}
      description={connectionDescription(provider.id, status)}
      status={<OAuthStatusPill status={status} />}
      actions={
        <OAuthProviderActions
          provider={provider}
          status={status}
          connecting={connecting}
          disconnecting={disconnecting}
          gcloudStarting={gcloudStarting}
          onManualToggle={onManualToggle}
          onConnect={onConnect}
          onStartGcloud={onStartGcloud}
          onDisconnect={onDisconnect}
        />
      }
    >
      <OAuthProviderDetails
        provider={provider}
        status={status}
        draft={draft}
        saving={saving}
        canSave={canSave}
        manualOpen={manualOpen}
        onDraftChange={onDraftChange}
        onSaveClient={onSaveClient}
      />
    </SettingsRow>
  );
}

function OAuthProviderActions({
  provider,
  status,
  connecting,
  disconnecting,
  gcloudStarting,
  onManualToggle,
  onConnect,
  onStartGcloud,
  onDisconnect,
}: {
  provider: OAuthProvider;
  status: OAuthStatusView | undefined;
  connecting: boolean;
  disconnecting: boolean;
  gcloudStarting: boolean;
  onManualToggle: () => void;
  onConnect: (providerId: string) => void;
  onStartGcloud: (providerId: string) => void;
  onDisconnect: (providerId: string) => void;
}) {
  return (
    <>
      <SettingsButton
        onClick={() => onConnect(provider.id)}
        disabled={connecting}
        title={`Open ${provider.displayName} login`}
        tone={status?.connected ? "default" : "primary"}
      >
        <ExternalLink className="h-3 w-3" />
        {status?.connected ? "Reconnect" : connecting ? "Opening" : "Connect"}
      </SettingsButton>
      {provider.id === "google" && !status?.connected ? (
        <SettingsButton
          onClick={() => onStartGcloud(provider.id)}
          disabled={gcloudStarting}
          title="Open Google login with gcloud"
        >
          {gcloudStarting ? "Opening gcloud" : "Use gcloud"}
        </SettingsButton>
      ) : null}
      {!status?.configuredByApp ? (
        <SettingsButton
          onClick={onManualToggle}
          title={`${provider.displayName} OAuth client setup`}
        >
          <KeyRound className="h-3 w-3" />
          Setup
        </SettingsButton>
      ) : null}
      {status?.connected ? (
        <SettingsButton
          tone="danger"
          onClick={() => onDisconnect(provider.id)}
          disabled={disconnecting}
        >
          <LogOut className="h-3 w-3" />
          Disconnect
        </SettingsButton>
      ) : null}
    </>
  );
}

function OAuthProviderDetails({
  provider,
  status,
  draft,
  saving,
  canSave,
  manualOpen,
  onDraftChange,
  onSaveClient,
}: {
  provider: OAuthProvider;
  status: OAuthStatusView | undefined;
  draft: OAuthClientDraft;
  saving: boolean;
  canSave: boolean;
  manualOpen: boolean;
  onDraftChange: (providerId: string, draft: OAuthClientDraft) => void;
  onSaveClient: (providerId: string) => void;
}) {
  return (
    <>
      {status?.connected ? (
        <div className="flex flex-wrap items-center gap-2 text-[length:var(--fs-sm)] text-(--ui-muted)">
          <ShieldCheck className="h-3.5 w-3.5 text-(--ui-success)" />
          <span className="font-mono">{status.email || "connected"}</span>
        </div>
      ) : null}
      {status?.configuredByApp ? (
        <SettingsNotice tone="good">
          Sign-in is ready. Connect opens the provider consent screen and returns here.
        </SettingsNotice>
      ) : null}
      {manualOpen ? (
        <OAuthManualClientForm
          provider={provider}
          status={status}
          draft={draft}
          saving={saving}
          canSave={canSave}
          onDraftChange={onDraftChange}
          onSaveClient={onSaveClient}
        />
      ) : null}
    </>
  );
}

function OAuthManualClientForm({
  provider,
  status,
  draft,
  saving,
  canSave,
  onDraftChange,
  onSaveClient,
}: {
  provider: OAuthProvider;
  status: OAuthStatusView | undefined;
  draft: OAuthClientDraft;
  saving: boolean;
  canSave: boolean;
  onDraftChange: (providerId: string, draft: OAuthClientDraft) => void;
  onSaveClient: (providerId: string) => void;
}) {
  return (
    <div className="space-y-2 pt-1">
      {!status?.configuredByApp && !status?.hasCredentials ? (
        <SettingsNotice tone="warning">
          This build does not include a managed OAuth client for {provider.displayName}. Save one
          here or ship this app with provider clients configured.
        </SettingsNotice>
      ) : null}
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
        <SettingsInput
          value={draft.clientId}
          onChange={(clientId) => onDraftChange(provider.id, { ...draft, clientId })}
          placeholder={`${provider.displayName} OAuth client ID`}
          aria-label={`${provider.displayName} OAuth client ID`}
        />
        <SettingsInput
          type="password"
          value={draft.clientSecret}
          onChange={(clientSecret) => onDraftChange(provider.id, { ...draft, clientSecret })}
          placeholder={`${provider.displayName} OAuth client secret`}
          aria-label={`${provider.displayName} OAuth client secret`}
        />
        <SettingsButton
          tone="primary"
          onClick={() => onSaveClient(provider.id)}
          disabled={!canSave || saving}
        >
          {saving ? "Saving" : status?.hasCredentials ? "Update client" : "Save client"}
        </SettingsButton>
      </div>
    </div>
  );
}

export function oauthBusyId(
  providerId: string,
  action: "connect" | "disconnect" | "gcloud" | "save",
) {
  return `oauth:${providerId}:${action}`;
}

function OAuthStatusPill({ status }: { status: OAuthStatusView | undefined }) {
  if (status?.connected) {
    return <StatusPill tone="good">connected</StatusPill>;
  }
  if (status?.hasCredentials) {
    return <StatusPill tone="info">ready</StatusPill>;
  }
  return <StatusPill tone="warning">setup needed</StatusPill>;
}

function connectionLabel(providerId: string, displayName: string): string {
  if (providerId === "google") return "Google Workspace";
  return displayName;
}

function connectionDescription(providerId: string, status: OAuthStatusView | undefined): string {
  if (status?.connected) return "Ready for managed MCP tools.";
  if (providerId === "google") return "Connect Gmail and Calendar tools with one Google sign-in.";
  if (providerId === "github")
    return "Connect repository, issue, pull request, and code search tools.";
  if (providerId === "huggingface")
    return "Connect Hub model, dataset, Space, paper, and inference tools.";
  return "Connect this provider's managed MCP tools.";
}
