"use client";

import { Schema } from "effect";
import { useCallback, useMemo, useState } from "react";
import {
  CodeStorageAccountsResponseSchema,
  type CodeStorageAccountEntry,
} from "@shared/agent/code-storage-account-contract";
import {
  GoogleAccountResponseSchema,
  type GoogleAccountView,
} from "@shared/agent/google-account-contract";
import {
  GOOGLE_WORKSPACE_BINDINGS,
  GOOGLE_WORKSPACE_PLUGIN_IDS,
  type GoogleWorkspacePluginId,
} from "@shared/agent/google-workspace-binding";
import {
  SandboxAccountsResponseSchema,
  type SandboxAccountEntry,
  type SandboxProvider,
} from "@shared/agent/sandbox-account-contract";
import {
  MessagingAccountsResponseSchema,
  type MessagingAccount,
  type MessagingProvider,
} from "@shared/agent/messaging-account-contract";
import { Alert } from "@/ui";
import { ResourceLogo } from "@/ui/resource-logo";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  DataRow,
  EndCell,
  HeadCell,
  IdentityCell,
  RowAction,
  StatusText,
  TableFrame,
  TableNotice,
  TableSection,
  TableSkeleton,
  TextCell,
  type StatusTone,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import { CodeStorageAccountModal } from "./code-storage-accounts-section";
import { GoogleAccountModal } from "./google-account-modal";
import { connectedGoogleAccounts, requestJson } from "./google-account-model";
import { SandboxAccountModal } from "./sandboxes-section";
import { MessagingAccountModal } from "./messaging-accounts-section";
import { MessagingAccessSection } from "./messaging-access-section";

const COLUMNS = ["Account", "Access", "State"] as const;
const decodeGoogle = Schema.decodeUnknownSync(GoogleAccountResponseSchema);
const decodeCodeStorage = Schema.decodeUnknownSync(CodeStorageAccountsResponseSchema);
const decodeSandboxes = Schema.decodeUnknownSync(SandboxAccountsResponseSchema);
const decodeMessaging = Schema.decodeUnknownSync(MessagingAccountsResponseSchema);
type AccountProviderId =
  | GoogleWorkspacePluginId
  | "code-storage"
  | SandboxProvider
  | MessagingProvider;
type ProviderRow = {
  id: AccountProviderId;
  label: string;
  company: string;
  summary: string;
  access: string;
  status: string;
  tone: StatusTone;
  action: string;
};

export function AccountsSection({ searchQuery = "" }: { searchQuery?: string } = {}) {
  const [google, setGoogle] = useState<GoogleAccountView | null>(null);
  const [repositories, setRepositories] = useState<readonly CodeStorageAccountEntry[]>([]);
  const [sandboxes, setSandboxes] = useState<readonly SandboxAccountEntry[]>([]);
  const [messaging, setMessaging] = useState<readonly MessagingAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [openProvider, setOpenProvider] = useState<AccountProviderId | null>(null);

  const refresh = useCallback(() => {
    void Promise.all([
      requestJson("/api/agent/accounts/google", decodeGoogle, { cache: "no-store" }),
      requestJson("/api/agent/accounts/code-storage", decodeCodeStorage, { cache: "no-store" }),
      requestJson("/api/agent/accounts/sandboxes", decodeSandboxes, { cache: "no-store" }),
      requestJson("/api/agent/accounts/messaging", decodeMessaging, { cache: "no-store" }),
    ])
      .then(([googleResult, repositoryResult, sandboxResult, messagingResult]) => {
        setGoogle(googleResult.account);
        setRepositories(repositoryResult.accounts);
        setSandboxes(sandboxResult.accounts);
        setMessaging(messagingResult.accounts);
        setError("");
      })
      .catch((loadError: unknown) =>
        setError(loadError instanceof Error ? loadError.message : "Accounts failed"),
      )
      .finally(() => setLoaded(true));
  }, []);

  useMountSubscription(() => {
    refresh();
    const interval = window.setInterval(refresh, 3_000);
    return () => window.clearInterval(interval);
  }, [refresh]);
  const rows = useMemo<ProviderRow[]>(() => {
    const googleRows = GOOGLE_WORKSPACE_PLUGIN_IDS.map((id): ProviderRow => {
      const binding = GOOGLE_WORKSPACE_BINDINGS[id];
      const accounts = connectedGoogleAccounts(google, id);
      return {
        id,
        label: binding.name,
        company: "Google",
        summary: accounts.length
          ? accounts.map((account) => account.email).join(", ")
          : "Google Workspace",
        access: `${binding.observeTools.length} read-only tools`,
        status: !google?.configured
          ? "Setup needed"
          : accounts.length
            ? `${accounts.length} signed in`
            : "Signed out",
        tone: !google?.configured ? "warn" : accounts.length ? "ok" : "dim",
        action: !google?.configured ? "Set up" : accounts.length ? "Manage" : "Sign in",
      };
    });
    const repositoryCount = repositories.length;
    const repositoryRow: ProviderRow = {
      id: "code-storage",
      label: "Code.Storage",
      company: "The Pierre Computer Company",
      summary: repositoryCount
        ? repositories.map((account) => account.label).join(", ")
        : "Repository provider",
      access: "Scoped repository access",
      status: repositoryCount ? `${repositoryCount} connected` : "Not connected",
      tone: repositoryCount ? "ok" : "dim",
      action: repositoryCount ? "Manage" : "Connect",
    };
    const sandboxRows = (["daytona"] as const).map((id): ProviderRow => {
      const accounts = sandboxes.filter((account) => account.provider === id);
      const label = "Daytona";
      return {
        id,
        label,
        company: "Daytona Platforms",
        summary: accounts.length
          ? accounts.map((account) => account.label).join(", ")
          : "Sandbox provider",
        access: "Isolated project workers",
        status: accounts.length ? `${accounts.length} connected` : "Not connected",
        tone: accounts.length ? "ok" : "dim",
        action: accounts.length ? "Manage" : "Connect",
      };
    });
    const messagingRows = (["telegram", "discord"] as const).map((id): ProviderRow => {
      const accounts = messaging.filter((account) => account.provider === id);
      const label = id === "telegram" ? "Telegram" : "Discord";
      return {
        id,
        label,
        company: label,
        summary: accounts.length
          ? accounts.map((account) => account.label).join(", ")
          : `${label} bot`,
        access: "Approved direct messages · Chat only",
        status: accounts.length ? `${accounts.length} connected` : "Not connected",
        tone: accounts.length ? "ok" : "dim",
        action: accounts.length ? "Manage" : "Connect",
      };
    });
    return [...googleRows, repositoryRow, ...sandboxRows, ...messagingRows];
  }, [google, messaging, repositories, sandboxes]);
  const visibleRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return query
      ? rows.filter((row) =>
          `${row.label} ${row.company} ${row.summary} ${row.access}`.toLowerCase().includes(query),
        )
      : rows;
  }, [rows, searchQuery]);

  return (
    <>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <TableSection
        title="Accounts"
        description="Services Local Studio can sign into. Each provider can hold several accounts."
        actions={
          <div className="flex items-center gap-2">
            <StatusText tone={error ? "warn" : loaded ? "ok" : "dim"}>
              {loaded ? `${rows.length} providers` : "loading"}
            </StatusText>
          </div>
        }
      >
        {!loaded ? (
          <TableSkeleton columns={COLUMNS} rows={5} minWidthClass="min-w-[34rem]" />
        ) : visibleRows.length === 0 ? (
          <TableNotice
            title="No account matches this search"
            body="Search by provider or service."
          />
        ) : (
          <TableFrame minWidthClass="min-w-[34rem]">
            <thead>
              <tr>
                {COLUMNS.map((column, index) => (
                  <HeadCell key={column} numeric={index === COLUMNS.length - 1}>
                    {column}
                  </HeadCell>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <DataRow
                  key={row.id}
                  onOpen={() => setOpenProvider(row.id)}
                  ariaLabel={`Open ${row.label}`}
                >
                  <IdentityCell
                    leading={
                      <ResourceLogo identity={row.id} label={row.label} company={row.company} />
                    }
                    label={row.label}
                    description={row.summary}
                  />
                  <TextCell>{row.access}</TextCell>
                  <EndCell>
                    <div className="flex items-center justify-end gap-2">
                      <StatusText tone={row.tone}>{row.status}</StatusText>
                      <RowAction
                        alwaysVisible
                        onClick={() => setOpenProvider(row.id)}
                        title={`${row.action} ${row.label}`}
                      >
                        {row.action}
                      </RowAction>
                    </div>
                  </EndCell>
                </DataRow>
              ))}
            </tbody>
          </TableFrame>
        )}
      </TableSection>
      <MessagingAccessSection />
      {openProvider &&
      GOOGLE_WORKSPACE_PLUGIN_IDS.includes(openProvider as GoogleWorkspacePluginId) ? (
        <GoogleAccountModal
          accountId={openProvider as GoogleWorkspacePluginId}
          displayName={GOOGLE_WORKSPACE_BINDINGS[openProvider as GoogleWorkspacePluginId].name}
          onClose={() => setOpenProvider(null)}
          onChanged={refresh}
        />
      ) : null}
      {openProvider === "code-storage" ? (
        <CodeStorageAccountModal
          accounts={repositories}
          onClose={() => setOpenProvider(null)}
          onChanged={setRepositories}
        />
      ) : null}
      {openProvider === "daytona" ? (
        <SandboxAccountModal
          accounts={sandboxes}
          onClose={() => setOpenProvider(null)}
          onChanged={setSandboxes}
        />
      ) : null}
      {openProvider === "telegram" || openProvider === "discord" ? (
        <MessagingAccountModal
          provider={openProvider}
          accounts={messaging}
          onClose={() => setOpenProvider(null)}
          onChanged={setMessaging}
        />
      ) : null}
    </>
  );
}
