"use client";

import { Schema } from "effect";
import { useState } from "react";
import {
  MessagingAccountsResponseSchema,
  type MessagingAccount,
  type MessagingProvider,
} from "@shared/agent/messaging-account-contract";
import { Alert, Button, FormField, Input, UiModal, UiModalBody, UiModalHeader } from "@/ui";
import { MessageSquare, X } from "@/ui/icon-registry";
import { requestJson } from "./google-account-model";

const decodeAccounts = Schema.decodeUnknownSync(MessagingAccountsResponseSchema);
const accountUrl = "/api/agent/accounts/messaging";

export function MessagingAccountModal({
  provider,
  accounts,
  onClose,
  onChanged,
}: {
  provider: MessagingProvider;
  accounts: readonly MessagingAccount[];
  onClose: () => void;
  onChanged: (accounts: readonly MessagingAccount[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connected = accounts.filter((account) => account.provider === provider);
  const valid =
    token.trim().length > 0 &&
    (provider === "telegram" || (applicationId.trim().length > 0 && publicKey.trim().length > 0));

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await requestJson(accountUrl, decodeAccounts, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider,
          label: label.trim() || undefined,
          token,
          ...(provider === "discord"
            ? { applicationId: applicationId.trim(), publicKey: publicKey.trim() }
            : {}),
        }),
      });
      setToken("");
      onChanged(response.accounts);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (accountId: string) => {
    setBusy(true);
    setError("");
    try {
      const response = await requestJson(
        `${accountUrl}?accountId=${encodeURIComponent(accountId)}`,
        decodeAccounts,
        { method: "DELETE" },
      );
      onChanged(response.accounts);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <UiModal isOpen onClose={busy ? () => undefined : onClose} maxWidth="max-w-lg">
      <UiModalHeader
        title={`Connect ${provider === "telegram" ? "Telegram" : "Discord"}`}
        icon={<MessageSquare className="h-4 w-4 text-(--ui-info)" />}
        onClose={onClose}
        showCloseButton={!busy}
        closeIcon={<X className="h-4 w-4" />}
      />
      <UiModalBody className="space-y-4 pb-5">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {connected.map((account) => (
          <div
            key={account.id}
            className="flex items-center gap-3 rounded-md border border-(--ui-separator) px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[length:var(--fs-sm)]">{account.label}</div>
              <div className="truncate font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
                {account.subject}
              </div>
              {account.provider === "discord" ? (
                <div className="truncate font-mono text-[length:var(--fs-xs)] text-(--ui-muted)">
                  Interaction path: /api/agent/messaging/discord/{account.id}
                </div>
              ) : null}
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
        <FormField label="Label">
          <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        </FormField>
        {provider === "discord" ? (
          <>
            <FormField label="Application ID" required>
              <Input
                value={applicationId}
                onChange={(event) => setApplicationId(event.target.value)}
                className="font-mono"
              />
            </FormField>
            <FormField label="Interaction public key" required>
              <Input
                value={publicKey}
                onChange={(event) => setPublicKey(event.target.value)}
                className="font-mono"
              />
            </FormField>
          </>
        ) : null}
        <FormField label="Bot token" required>
          <Input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            type="password"
            className="font-mono"
          />
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
