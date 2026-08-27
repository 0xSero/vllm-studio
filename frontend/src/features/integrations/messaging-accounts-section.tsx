"use client";

import { Schema } from "effect";
import { useState } from "react";
import {
  MessagingAccountsResponseSchema,
  type MessagingAccount,
  type MessagingProvider,
} from "@shared/agent/messaging-account-contract";
import { Alert, Button, FormField, Input } from "@/ui";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
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
  const displayName = provider === "telegram" ? "Telegram" : "Discord";

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
    <ResourceDrawer
      title={displayName}
      icon={<ResourceLogo identity={provider} label={displayName} />}
      status={connected.length ? `${connected.length} connected` : "Not connected"}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button loading={busy} disabled={!valid} onClick={() => void connect()}>
            Add account
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <ResourceDrawerSection title="Tools">
          <div className="py-2.5 text-[length:var(--fs-sm)] text-(--ui-fg)">
            Receive direct messages and deliver final responses
          </div>
        </ResourceDrawerSection>
        {connected.length ? (
          <ResourceDrawerSection title="Accounts">
            {connected.map((account) => (
              <ResourceFact
                key={account.id}
                label={account.label}
                value={
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono">{account.subject}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void disconnect(account.id)}
                    >
                      Disconnect
                    </Button>
                  </span>
                }
              />
            ))}
          </ResourceDrawerSection>
        ) : null}
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
      </div>
    </ResourceDrawer>
  );
}
