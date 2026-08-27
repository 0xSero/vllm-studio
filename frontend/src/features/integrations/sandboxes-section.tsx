"use client";

import { Schema } from "effect";
import { useState } from "react";
import {
  SandboxAccountsResponseSchema,
  type SandboxAccountEntry,
} from "@shared/agent/sandbox-account-contract";
import { Alert, Button, FormField, Input, UiModal, UiModalBody, UiModalHeader } from "@/ui";
import { Boxes, Eye, EyeOff, X } from "@/ui/icon-registry";
import { requestJson } from "./google-account-model";

const ACCOUNT_URL = "/api/agent/accounts/sandboxes";
const decodeAccounts = Schema.decodeUnknownSync(SandboxAccountsResponseSchema);
export function SandboxAccountModal({
  accounts = [],
  onClose,
  onChanged,
}: {
  accounts?: readonly SandboxAccountEntry[];
  onClose: () => void;
  onChanged: (accounts: readonly SandboxAccountEntry[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("https://app.daytona.io/api");
  const [showSecrets, setShowSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connected = accounts.filter((account) => account.provider === "daytona");
  const valid = apiKey.trim().length > 0 && endpoint.trim().length > 0;

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson(ACCOUNT_URL, decodeAccounts, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "daytona",
          label: label.trim() || undefined,
          apiKey,
          endpoint: endpoint.trim(),
        }),
      });
      setApiKey("");
      onChanged(result.accounts);
      onClose();
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (accountId: string) => {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson(
        `${ACCOUNT_URL}?accountId=${encodeURIComponent(accountId)}`,
        decodeAccounts,
        { method: "DELETE" },
      );
      onChanged(result.accounts);
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <UiModal isOpen onClose={busy ? () => undefined : onClose} maxWidth="max-w-lg">
      <UiModalHeader
        title="Connect Daytona"
        icon={<Boxes className="h-4 w-4 text-(--ui-info)" />}
        onClose={onClose}
        showCloseButton={!busy}
        closeIcon={<X className="h-4 w-4" />}
      />
      <UiModalBody className="space-y-4 pb-5">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {connected.length ? (
          <div className="rounded-md border border-(--ui-separator)">
            {connected.map((account) => (
              <div
                key={account.id}
                className="flex items-center gap-3 border-b border-(--ui-separator) px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[length:var(--fs-sm)] text-(--ui-fg)">
                    {account.label}
                  </div>
                  <div className="truncate font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
                    {account.endpoint}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void disconnect(account.id)}
                >
                  Disconnect
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <FormField label="Label" description="Optional name for distinguishing several accounts.">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Work account"
            autoComplete="off"
          />
        </FormField>
        <FormField label="API endpoint">
          <Input
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            autoComplete="off"
            className="font-mono"
          />
        </FormField>
        <FormField label="API key">
          <div className="relative">
            <Input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type={showSecrets ? "text" : "password"}
              autoComplete="off"
              className="pr-10 font-mono"
            />
            <SecretVisibility visible={showSecrets} onToggle={() => setShowSecrets(!showSecrets)} />
          </div>
        </FormField>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!valid} onClick={() => void connect()}>
            Connect account
          </Button>
        </div>
      </UiModalBody>
    </UiModal>
  );
}
function SecretVisibility({ visible, onToggle }: { visible: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-(--ui-muted) hover:text-(--ui-fg)"
      aria-label={visible ? "Hide credential" : "Show credential"}
    >
      {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}
