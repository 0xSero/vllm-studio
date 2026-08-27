"use client";

import { Schema } from "effect";
import { useCallback, useState } from "react";
import {
  MessagingAccessResponseSchema,
  type MessagingAccessResponse,
} from "@shared/agent/messaging-access-contract";
import { Alert, Button, Input } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { StatusText, TableSection } from "@/features/recipes/recipes-content/catalog-table-shell";
import { requestJson } from "./google-account-model";

const decodeAccess = Schema.decodeUnknownSync(MessagingAccessResponseSchema);
const emptyAccess: MessagingAccessResponse = { pending: [], allowed: [] };

export function MessagingAccessSection() {
  const [access, setAccess] = useState<MessagingAccessResponse>(emptyAccess);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    void requestJson("/api/agent/messaging/access", decodeAccess, { cache: "no-store" })
      .then((response) => {
        setAccess(response);
        setError("");
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Messaging access failed"),
      );
  }, []);

  useMountSubscription(() => {
    refresh();
    const interval = window.setInterval(refresh, 3_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const approve = async (pairingId: string) => {
    setBusy(pairingId);
    setError("");
    try {
      const response = await requestJson("/api/agent/messaging/access", decodeAccess, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pairingId, code: codes[pairingId]?.trim() ?? "" }),
      });
      setAccess(response);
      setCodes((current) => ({ ...current, [pairingId]: "" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Approval failed");
    } finally {
      setBusy("");
    }
  };

  const revoke = async (provider: string, accountId: string, externalUserId: string) => {
    const key = `${provider}:${accountId}:${externalUserId}`;
    setBusy(key);
    setError("");
    try {
      const query = new URLSearchParams({ provider, accountId, externalUserId });
      const response = await requestJson(
        `/api/agent/messaging/access?${query.toString()}`,
        decodeAccess,
        { method: "DELETE" },
      );
      setAccess(response);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Revoke failed");
    } finally {
      setBusy("");
    }
  };

  return (
    <TableSection
      title="Messaging access"
      description="Direct messages are denied until you approve the one-hour pairing code locally."
      actions={<StatusText tone="dim">{access.allowed.length} allowed</StatusText>}
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      <div className="space-y-2">
        {access.pending.map((pairing) => (
          <div
            key={pairing.id}
            className="flex min-h-12 items-center gap-3 border-b border-(--ui-separator) px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[length:var(--fs-sm)]">
                {pairing.label || pairing.externalUserId}
              </div>
              <div className="text-[length:var(--fs-xs)] text-(--ui-muted)">
                {pairing.provider} · expires {pairing.expiresAt}
              </div>
            </div>
            <Input
              value={codes[pairing.id] ?? ""}
              onChange={(event) =>
                setCodes((current) => ({ ...current, [pairing.id]: event.target.value }))
              }
              placeholder="Pairing code"
              className="w-36 font-mono"
            />
            <Button
              size="sm"
              loading={busy === pairing.id}
              disabled={!codes[pairing.id]?.trim()}
              onClick={() => void approve(pairing.id)}
            >
              Approve
            </Button>
          </div>
        ))}
        {access.allowed.map((entry) => {
          const key = `${entry.provider}:${entry.accountId}:${entry.externalUserId}`;
          return (
            <div
              key={key}
              className="flex min-h-12 items-center gap-3 border-b border-(--ui-separator) px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[length:var(--fs-sm)]">
                  {entry.label || entry.externalUserId}
                </div>
                <div className="text-[length:var(--fs-xs)] text-(--ui-muted)">
                  {entry.provider} · approved {entry.approvedAt}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={busy === key}
                onClick={() => void revoke(entry.provider, entry.accountId, entry.externalUserId)}
              >
                Revoke
              </Button>
            </div>
          );
        })}
        {access.pending.length === 0 && access.allowed.length === 0 ? (
          <div className="px-3 py-5 text-[length:var(--fs-sm)] text-(--ui-muted)">
            No pending or approved messaging users.
          </div>
        ) : null}
      </div>
    </TableSection>
  );
}
