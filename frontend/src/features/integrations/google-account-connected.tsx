"use client";

import type { GoogleAccountEntryView } from "@shared/agent/google-account-contract";
import type { GoogleWorkspacePluginId } from "@shared/agent/google-workspace-binding";
import { Alert, Button, StatusPill } from "@/ui";

function DisconnectRow({
  email,
  busy,
  confirming,
  onConfirm,
  onKeep,
  onDisconnect,
}: {
  email: string;
  busy: boolean;
  confirming: boolean;
  onConfirm: () => void;
  onKeep: () => void;
  onDisconnect: () => void;
}) {
  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={onConfirm} disabled={busy}>
        Disconnect
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={onKeep} disabled={busy}>
        Keep
      </Button>
      <Button variant="danger" size="sm" onClick={onDisconnect} loading={busy}>
        Confirm {email}
      </Button>
    </div>
  );
}

export function ConnectedGoogleAccounts({
  service,
  accounts,
  confirmingKey,
  busy,
  onConfirm,
  onKeep,
  onDisconnect,
}: {
  service: GoogleWorkspacePluginId;
  accounts: GoogleAccountEntryView[];
  confirmingKey: string | null;
  busy: boolean;
  onConfirm: (key: string) => void;
  onKeep: () => void;
  onDisconnect: (key: string) => void;
}) {
  if (!accounts.length) {
    return <Alert variant="info">No accounts connected.</Alert>;
  }
  return (
    <div className="space-y-2" role="list">
      {accounts.map((entry) => (
        <div
          key={entry.key}
          role="listitem"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-(--ui-border) px-4 py-3"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-(--ui-fg)">{entry.email}</div>
            <div className="mt-1 text-xs text-(--ui-muted)">
              Read-only · {entry.connections[service].scopes.length} scopes
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill tone="good">Connected</StatusPill>
            <DisconnectRow
              email={entry.email}
              busy={busy}
              confirming={confirmingKey === entry.key}
              onConfirm={() => onConfirm(entry.key)}
              onKeep={onKeep}
              onDisconnect={() => onDisconnect(entry.key)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
