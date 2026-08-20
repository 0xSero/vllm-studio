"use client";

import type { GoogleAccountView } from "@local-studio/agent-runtime/google-account-contract";
import { Alert, Button, FormField, Input } from "@/ui";
import { ExternalLink } from "@/ui/icon-registry";
import { openExternal } from "./google-account-model";

/**
 * Local Studio ships no Google OAuth client, and deliberately so: a client id
 * embedded in a desktop app is extractable, and every install would then share
 * one Cloud project's quota and verification state. The credential below is the
 * user's own, and until it exists the account cannot sign in at all.
 */
export function GoogleAccountSetup({
  account,
  editing,
  clientId,
  clientSecret,
  replacementWarning,
  onClientId,
  onClientSecret,
  onEdit,
}: {
  account: GoogleAccountView;
  editing: boolean;
  clientId: string;
  clientSecret: string;
  replacementWarning: string | null;
  onClientId: (value: string) => void;
  onClientSecret: (value: string) => void;
  onEdit: () => void;
}) {
  if (account.configured && !editing) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-(--ui-border) px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-(--ui-fg)">OAuth client ready</div>
          <div className="mt-1 truncate text-xs text-(--ui-muted)">{account.clientId}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Alert variant="warning">
        Local Studio ships no Google client. Create a <strong>Desktop app</strong> OAuth client in
        your own Google Cloud project, enable the Gmail API, and add yourself as a test user. No
        redirect URI has to be registered — desktop clients accept a loopback port. While the
        consent screen is in testing, Google expires refresh tokens after about a week, so expect to
        sign in again; publishing is not a shortcut, because Gmail read access is a restricted scope
        subject to review. Confirm current policy in the console.
      </Alert>
      <FormField
        label="OAuth client ID"
        required
        description="From Google Cloud → Credentials → OAuth client ID → Application type: Desktop app."
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
      {replacementWarning ? <Alert variant="warning">{replacementWarning}</Alert> : null}
      <div className="flex flex-wrap gap-1">
        <Button
          variant="ghost"
          icon={<ExternalLink className="h-4 w-4" />}
          onClick={() => void openExternal("https://console.cloud.google.com/auth/clients")}
        >
          Google Cloud
        </Button>
        <Button
          variant="ghost"
          icon={<ExternalLink className="h-4 w-4" />}
          onClick={() =>
            void openExternal("https://developers.google.com/gmail/api/quickstart/nodejs")
          }
        >
          Setup guide
        </Button>
      </div>
    </div>
  );
}
