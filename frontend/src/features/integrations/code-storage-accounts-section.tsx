"use client";

import { useState } from "react";
import { Schema } from "effect";
import {
  CodeStorageAccountsResponseSchema,
  type CodeStorageAccountEntry,
} from "@shared/agent/code-storage-account-contract";
import {
  Alert,
  Button,
  FormField,
  Input,
  Textarea,
  UiModal,
  UiModalBody,
  UiModalHeader,
} from "@/ui";
import { Eye, EyeOff, KeyRound, X } from "@/ui/icon-registry";
import { requestJson } from "./google-account-model";

const ACCOUNT_URL = "/api/agent/accounts/code-storage";
const decodeAccounts = Schema.decodeUnknownSync(CodeStorageAccountsResponseSchema);

export function CodeStorageAccountModal({
  accounts = [],
  onClose,
  onChanged,
}: {
  accounts?: readonly CodeStorageAccountEntry[];
  onClose: () => void;
  onChanged: (accounts: readonly CodeStorageAccountEntry[]) => void;
}) {
  const [organization, setOrganization] = useState("");
  const [label, setLabel] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson(ACCOUNT_URL, decodeAccounts, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization,
          label: label.trim() || undefined,
          privateKey,
        }),
      });
      setPrivateKey("");
      onChanged(result.accounts);
      onClose();
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  const valid = organization.trim().length > 0 && privateKey.trim().length > 0;

  return (
    <UiModal isOpen onClose={busy ? () => undefined : onClose} maxWidth="max-w-lg">
      <UiModalHeader
        title="Connect Code.Storage"
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-(--ui-info)/30 bg-(--ui-info)/10">
            <KeyRound className="h-4 w-4 text-(--ui-info)" />
          </span>
        }
        onClose={onClose}
        showCloseButton={!busy}
        closeIcon={<X className="h-4 w-4" />}
      />
      <UiModalBody className="space-y-4 pb-5">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {accounts.length ? (
          <div className="rounded-md border border-(--ui-separator)">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center gap-3 border-b border-(--ui-separator) px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[length:var(--fs-sm)] text-(--ui-fg)">
                    {account.label}
                  </div>
                  <div className="truncate font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
                    {account.organization}
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
        <FormField
          label="Organization"
          description="The lowercase organization from your-org.code.storage."
        >
          <Input
            value={organization}
            onChange={(event) => setOrganization(event.target.value.toLowerCase().trim())}
            placeholder="your-org"
            autoComplete="off"
          />
        </FormField>
        <FormField label="Label" description="Optional name for distinguishing several accounts.">
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Work account"
            autoComplete="off"
          />
        </FormField>
        <FormField
          label="Private key"
          description="Paste the PKCS8 P-256 PEM generated for this organization."
        >
          <div className="relative">
            <Textarea
              value={privateKey}
              onChange={(event) => setPrivateKey(event.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----"
              autoComplete="off"
              spellCheck={false}
              className={`min-h-36 pr-10 font-mono ${showKey ? "" : "[-webkit-text-security:disc]"}`}
            />
            <button
              type="button"
              onClick={() => setShowKey((current) => !current)}
              className="absolute right-2 top-2 rounded p-1 text-(--ui-muted) hover:bg-(--ui-hover) hover:text-(--ui-fg)"
              aria-label={showKey ? "Hide private key" : "Show private key"}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </FormField>
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void connect()} loading={busy} disabled={!valid}>
            Connect account
          </Button>
        </div>
      </UiModalBody>
    </UiModal>
  );
}
