"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Effect, Fiber, Schema } from "effect";
import {
  GoogleAccountResponseSchema,
  GoogleAuthorizationResponseSchema,
  type GoogleAccountView,
} from "@local-studio/agent-runtime/google-account-contract";
import type { GoogleWorkspacePluginId } from "@local-studio/agent-runtime/google-workspace-binding";
import { Alert, Button, FormField, Input, Spinner, StatusPill, UiModal, UiModalHeader } from "@/ui";
import { ExternalLink, KeyRound, X } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

const GoogleCancellationResponseSchema = Schema.Struct({ cancelled: Schema.Literal(true) });

function responseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = Reflect.get(body, "error");
  return typeof error === "string" ? error : fallback;
}

async function requestJson<T>(
  url: string,
  decode: (input: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body, `Request failed (${response.status})`));
  return decode(body);
}

async function openExternal(url: string): Promise<void> {
  const bridge = window.localStudioDesktop?.openExternal;
  if (bridge && (await bridge(url))) return;
  if (!window.open(url, "_blank", "noopener,noreferrer")) {
    throw new Error("Local Studio could not open the Google sign-in page");
  }
}

function GoogleAccountLoadState({ error, onRetry }: { error: string; onRetry: () => void }) {
  if (error) {
    return (
      <Alert variant="error">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </Alert>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-24 items-center justify-center gap-2 text-sm text-(--ui-muted)"
    >
      <Spinner size="sm" />
      Loading Google account
    </div>
  );
}

function ConnectedGoogleAccount({
  email,
  displayName,
  confirming,
  busy,
  onConfirm,
  onKeep,
  onDisconnect,
  onClose,
}: {
  email: string | null;
  displayName: string;
  confirming: boolean;
  busy: boolean;
  onConfirm: () => void;
  onKeep: () => void;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-between rounded-lg border border-(--ui-border) px-4 py-3"
      >
        <div>
          <div className="text-sm font-medium text-(--ui-fg)">{email}</div>
          <div className="mt-1 text-xs text-(--ui-muted)">Read-only · {displayName}</div>
        </div>
        <StatusPill tone="good">Connected</StatusPill>
      </div>
      {confirming ? (
        <>
          <Alert variant="warning">
            Revoking access removes every Google OAuth scope granted to this Cloud project and
            disconnects both Gmail and Calendar. A dedicated project keeps other Google clients
            isolated.
          </Alert>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onKeep} disabled={busy}>
              Keep connected
            </Button>
            <Button variant="danger" onClick={onDisconnect} loading={busy}>
              Revoke access
            </Button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <Button variant="danger" onClick={onConfirm}>
            Disconnect Google
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      )}
    </div>
  );
}

function GoogleAccountSetup({
  account,
  editing,
  clientId,
  clientSecret,
  sharedClientWarning,
  awaiting,
  busy,
  onClientId,
  onClientSecret,
  onEdit,
  onClose,
  onCancelSignIn,
  onConnect,
}: {
  account: GoogleAccountView;
  editing: boolean;
  clientId: string;
  clientSecret: string;
  sharedClientWarning: string | null;
  awaiting: boolean;
  busy: boolean;
  onClientId: (value: string) => void;
  onClientSecret: (value: string) => void;
  onEdit: () => void;
  onClose: () => void;
  onCancelSignIn: () => void;
  onConnect: () => void;
}) {
  const needsClient = !account.configured || editing;
  return (
    <div className="space-y-4">
      {needsClient ? (
        <>
          <FormField
            label="OAuth client ID"
            required
            description="Use a Google Desktop OAuth client with the Workspace MCP APIs enabled."
          >
            <Input
              value={clientId}
              onChange={(event) => onClientId(event.target.value)}
              placeholder="…apps.googleusercontent.com"
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
          <FormField label="OAuth client secret" description="Optional for some desktop clients.">
            <Input
              type="password"
              value={clientSecret}
              onChange={(event) => onClientSecret(event.target.value)}
              placeholder={account.hasClientSecret ? "Stored securely" : "Client secret"}
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
          {sharedClientWarning ? <Alert variant="warning">{sharedClientWarning}</Alert> : null}
        </>
      ) : (
        <div className="flex items-center justify-between rounded-lg border border-(--ui-border) px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-(--ui-fg)">OAuth client ready</div>
            <div className="mt-1 truncate text-xs text-(--ui-muted)">{account.clientId}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Change
          </Button>
        </div>
      )}
      {awaiting ? (
        <Alert variant="success">
          Finish consent in your browser. Local Studio is checking for the connection.
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            icon={<ExternalLink className="h-4 w-4" />}
            onClick={() =>
              void openExternal(
                "https://developers.google.com/workspace/guides/configure-mcp-servers",
              )
            }
          >
            Setup guide
          </Button>
          <Button
            variant="ghost"
            icon={<ExternalLink className="h-4 w-4" />}
            onClick={() => void openExternal("https://console.cloud.google.com/auth/clients")}
          >
            Google Cloud
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={awaiting ? onCancelSignIn : onClose}
            loading={awaiting && busy}
            disabled={busy && !awaiting}
          >
            {awaiting ? "Cancel sign-in" : "Cancel"}
          </Button>
          <Button
            onClick={onConnect}
            loading={busy && !awaiting}
            disabled={awaiting || (needsClient && !clientId.trim())}
          >
            {awaiting
              ? "Waiting for Google"
              : sharedClientWarning
                ? "Revoke & replace"
                : "Continue with Google"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function sharedClientWarning(
  accountId: GoogleWorkspacePluginId,
  account: GoogleAccountView | null,
  editing: boolean,
  clientId: string,
): string | null {
  const otherAccountId = accountId === "gmail" ? "google-calendar" : "gmail";
  if (!editing || !account?.connections[otherAccountId].connected) return null;
  if (clientId.trim() === account.clientId) return null;
  const otherDisplayName = accountId === "gmail" ? "Google Calendar" : "Gmail";
  return `Replacing this client revokes the current Cloud project's Google access and disconnects ${otherDisplayName} before starting again.`;
}

export function GoogleAccountModal({
  accountId,
  displayName,
  onClose,
  onChanged,
}: {
  accountId: GoogleWorkspacePluginId;
  displayName: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [account, setAccount] = useState<GoogleAccountView | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [editing, setEditing] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lifecycle] = useState(() => ({
    active: false,
    cancelAuthorizationRequest: async (): Promise<void> => undefined,
  }));

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const result = await requestJson<{ account: GoogleAccountView }>(
        "/api/agent/accounts/google",
        Schema.decodeUnknownSync(GoogleAccountResponseSchema),
        { cache: "no-store" },
      );
      setAccount(result.account);
      setError("");
      setClientId((current) => current || result.account.clientId || "");
      if (!result.account.configured) setEditing(true);
      const connected = result.account.connections[accountId].connected;
      if (connected) {
        lifecycle.active = false;
        setAwaiting(false);
        onChanged();
      }
      return connected;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Google account failed");
      return false;
    }
  }, [accountId, lifecycle, onChanged]);

  useMountSubscription(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const cancelAuthorizationRequest = useCallback(async (): Promise<void> => {
    await requestJson(
      "/api/agent/accounts/google/authorize",
      Schema.decodeUnknownSync(GoogleCancellationResponseSchema),
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: accountId }),
        keepalive: true,
      },
    );
  }, [accountId]);

  const cancelAuthorization = useCallback(async (): Promise<void> => {
    await cancelAuthorizationRequest();
    lifecycle.active = false;
    setAwaiting(false);
  }, [cancelAuthorizationRequest, lifecycle]);

  lifecycle.cancelAuthorizationRequest = cancelAuthorizationRequest;

  useMountSubscription(
    () => () => {
      if (lifecycle.active) void lifecycle.cancelAuthorizationRequest();
    },
    [],
  );

  useMountSubscription(() => {
    if (!awaiting) return;
    const fiber = Effect.runFork(
      Effect.gen(function* () {
        for (let attempt = 0; attempt < 90; attempt += 1) {
          yield* Effect.sleep(1_000);
          if (yield* Effect.promise(refresh)) return;
        }
        yield* Effect.promise(() => cancelAuthorization().catch(() => undefined));
        setAwaiting(false);
        setError("Google sign-in timed out. Start again when you are ready.");
      }),
    );
    return () => void Effect.runPromise(Fiber.interrupt(fiber));
  }, [awaiting, cancelAuthorization, refresh]);

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      if (!account?.configured || editing) {
        const saved = await requestJson<{ account: GoogleAccountView }>(
          "/api/agent/accounts/google",
          Schema.decodeUnknownSync(GoogleAccountResponseSchema),
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clientId, clientSecret }),
          },
        );
        setAccount(saved.account);
        onChanged();
        setEditing(false);
        setClientSecret("");
      }
      lifecycle.active = true;
      const result = await requestJson<{ authorizationUrl: string }>(
        "/api/agent/accounts/google/authorize",
        Schema.decodeUnknownSync(GoogleAuthorizationResponseSchema),
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account: accountId }),
        },
      );
      await openExternal(result.authorizationUrl);
      setAwaiting(true);
    } catch (connectError) {
      if (lifecycle.active) await cancelAuthorization().catch(() => undefined);
      setError(connectError instanceof Error ? connectError.message : "Google sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<{ account: GoogleAccountView }>(
        "/api/agent/accounts/google",
        Schema.decodeUnknownSync(GoogleAccountResponseSchema),
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ account: accountId }),
        },
      );
      setAccount(result.account);
      setConfirmingDisconnect(false);
      onChanged();
    } catch (disconnectError) {
      await refresh();
      setError(disconnectError instanceof Error ? disconnectError.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  };

  const cancelSignIn = async () => {
    setBusy(true);
    setError("");
    try {
      await cancelAuthorization();
      onClose();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Cancellation failed");
    } finally {
      setBusy(false);
    }
  };

  const connection = account?.connections[accountId];
  const warning = sharedClientWarning(accountId, account, editing, clientId);
  const dismiss = () => {
    if (!busy && !awaiting) onClose();
  };
  let content: ReactNode;
  if (!account) {
    content = <GoogleAccountLoadState error={error} onRetry={() => void refresh()} />;
  } else if (connection?.connected && !editing) {
    content = (
      <ConnectedGoogleAccount
        email={connection.email}
        displayName={displayName}
        confirming={confirmingDisconnect}
        busy={busy}
        onConfirm={() => setConfirmingDisconnect(true)}
        onKeep={() => setConfirmingDisconnect(false)}
        onDisconnect={() => void disconnect()}
        onClose={onClose}
      />
    );
  } else {
    content = (
      <GoogleAccountSetup
        account={account}
        editing={editing}
        clientId={clientId}
        clientSecret={clientSecret}
        sharedClientWarning={warning}
        awaiting={awaiting}
        busy={busy}
        onClientId={setClientId}
        onClientSecret={setClientSecret}
        onEdit={() => setEditing(true)}
        onClose={onClose}
        onCancelSignIn={() => void cancelSignIn()}
        onConnect={() => void connect()}
      />
    );
  }
  return (
    <UiModal isOpen onClose={dismiss} maxWidth="max-w-lg">
      <UiModalHeader
        title={connection?.connected ? displayName : `Connect ${displayName}`}
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-(--ui-info)/30 bg-(--ui-info)/10">
            <KeyRound className="h-4 w-4 text-(--ui-info)" />
          </span>
        }
        onClose={dismiss}
        showCloseButton={!awaiting}
        closeIcon={<X className="h-4 w-4" />}
      />
      <div className="space-y-5 px-6 py-5">
        <Alert variant="info">
          Google&apos;s first-party Workspace MCP is in developer preview. Add a Desktop OAuth
          client once; Local Studio encrypts it with the desktop keychain and exposes only declared
          read-only tools.
        </Alert>
        {content}
        {error && account ? <Alert variant="error">{error}</Alert> : null}
      </div>
    </UiModal>
  );
}
