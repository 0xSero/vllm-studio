"use client";

import { useState } from "react";
import { Schema } from "effect";
import {
  CodeStorageAccountsResponseSchema,
  type CodeStorageAccountEntry,
} from "@shared/agent/code-storage-account-contract";
import { Alert, Button, FormField, Input, Textarea } from "@/ui";
import { Eye, EyeOff } from "@/ui/icon-registry";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
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
    <ResourceDrawer
      title="Code.Storage"
      icon={<ResourceLogo identity="code-storage" label="Code.Storage" />}
      status={accounts.length ? `${accounts.length} connected` : "Not connected"}
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button onClick={() => void connect()} loading={busy} disabled={!valid}>
            Add account
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert variant="error">{error}</Alert> : null}
        <ResourceDrawerSection title="Tools">
          {[
            "Read and write repositories",
            "Create commits and update refs",
            "Push changes and hand work to remote agents",
          ].map((tool) => (
            <div key={tool} className="py-2.5 text-[length:var(--fs-sm)] text-(--ui-fg)">
              {tool}
            </div>
          ))}
        </ResourceDrawerSection>
        {accounts.length ? (
          <ResourceDrawerSection title="Accounts">
            {accounts.map((account) => (
              <ResourceFact
                key={account.id}
                label={account.label}
                value={
                  <span className="flex items-center justify-between gap-3">
                    <span>{account.organization}</span>
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
      </div>
    </ResourceDrawer>
  );
}
