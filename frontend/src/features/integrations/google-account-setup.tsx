"use client";

import type { GoogleAccountView } from "@local-studio/agent-runtime/google-account-contract";
import { Alert, Button, FormField, Input } from "@/ui";
import { ExternalLink } from "@/ui/icon-registry";
import { openExternal } from "./google-account-model";

export function GoogleAccountSetup({
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
