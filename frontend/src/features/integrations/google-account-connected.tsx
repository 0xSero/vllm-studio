"use client";

import { Alert, Button, StatusPill } from "@/ui";

export function ConnectedGoogleAccount({
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
