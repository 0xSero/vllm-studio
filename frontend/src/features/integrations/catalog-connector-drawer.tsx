"use client";

import { useMemo, useState } from "react";
import { Schema } from "effect";
import {
  ConnectorTestResponseSchema,
  ConnectorsResponseSchema,
  type ConnectorView,
} from "@shared/agent/connector-contract";
import { Alert, Button, Checkbox, FormField, Input } from "@/ui";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import { jsonBody, requestAgentJson } from "./agent-json";
import { renderCatalogCommand, type CatalogEntry } from "./connector-catalog";

const MASK = "••••••••";

const splitLines = (value: string): string[] =>
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);

const initialArguments = (entry: CatalogEntry, connector: ConnectorView | null): string => {
  const args = connector?.args ?? entry.args ?? [];
  if (entry.requiredConfiguration.includes("repository")) {
    const marker = args.indexOf("--repository");
    return marker >= 0 ? (args[marker + 1] ?? "") : "";
  }
  return args.join("\n");
};

export function CatalogConnectorDrawer({
  entry,
  connector,
  connectors = connector ? [connector] : [],
  accountMode = false,
  onClose,
  onChanged,
}: {
  entry: CatalogEntry;
  connector: ConnectorView | null;
  connectors?: readonly ConnectorView[];
  accountMode?: boolean;
  onClose: () => void;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [argumentsValue, setArgumentsValue] = useState(() =>
    initialArguments(entry, accountMode ? null : connector),
  );
  const [accountLabel, setAccountLabel] = useState("");
  const [environment, setEnvironment] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      entry.envFields.map((field) => [
        field.key,
        accountMode ? "" : (connector?.env?.[field.key] ?? ""),
      ]),
    ),
  );
  const [enabled, setEnabled] = useState(
    accountMode || connector?.enabled || entry.requiredConfiguration.includes("oauth"),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const missingConfiguration = useMemo(() => {
    if (entry.requiredConfiguration.includes("roots") && splitLines(argumentsValue).length === 0) {
      return "Add at least one allowed root.";
    }
    if (entry.requiredConfiguration.includes("repository") && !argumentsValue.trim()) {
      return "Choose a repository path.";
    }
    const missingEnvironment = entry.envFields.find((field) => !environment[field.key]?.trim());
    return missingEnvironment ? `${missingEnvironment.label} is required.` : "";
  }, [argumentsValue, entry.envFields, entry.requiredConfiguration, environment]);

  const save = async () => {
    if (!entry.installable || entry.transport === "builtin" || missingConfiguration) return;
    setSaving(true);
    setError("");
    try {
      const args = entry.requiredConfiguration.includes("repository")
        ? ["--repository", argumentsValue.trim()]
        : splitLines(argumentsValue);
      const connectorId = accountMode ? `${entry.id}--${Date.now().toString(36)}` : entry.id;
      const result = await requestAgentJson(
        "/api/agent/connectors",
        Schema.decodeUnknownSync(ConnectorsResponseSchema),
        jsonBody({
          id: connectorId,
          name: accountMode
            ? `${entry.name} · ${accountLabel.trim() || `Account ${connectors.length + 1}`}`
            : entry.name,
          transport: entry.transport,
          protocolEra: entry.protocolEra,
          runtime: entry.runtime,
          command: entry.command,
          args,
          url: entry.url,
          env: environment,
          envSecret: Object.fromEntries(entry.envFields.map((field) => [field.key, field.secret])),
          enabled,
        }),
      );
      onChanged(result.connectors);
      if (entry.requiredConfiguration.includes("oauth")) {
        const tested = await requestAgentJson(
          "/api/agent/connectors/test",
          Schema.decodeUnknownSync(ConnectorTestResponseSchema),
          jsonBody({ id: connectorId }),
        );
        if (!tested.ok) throw new Error(tested.error || "Provider sign-in failed");
      }
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "MCP configuration failed");
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async (id: string) => {
    setSaving(true);
    setError("");
    try {
      const result = await requestAgentJson(
        `/api/agent/connectors?id=${encodeURIComponent(id)}`,
        Schema.decodeUnknownSync(ConnectorsResponseSchema),
        { method: "DELETE" },
      );
      onChanged(result.connectors);
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Disconnect failed");
    } finally {
      setSaving(false);
    }
  };

  const runtime = entry.runtime
    ? `${entry.runtime.package}@${entry.runtime.version}`
    : entry.transport;

  return (
    <ResourceDrawer
      title={entry.name}
      icon={<ResourceLogo identity={entry.id} label={entry.name} company={entry.company} />}
      status={entry.company}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {entry.installable && entry.transport !== "builtin" ? (
            <Button
              loading={saving}
              disabled={Boolean(missingConfiguration)}
              onClick={() => void save()}
            >
              {accountMode
                ? "Add account"
                : connector
                  ? "Save changes"
                  : entry.requiredConfiguration.includes("oauth")
                    ? "Connect account"
                    : "Add MCP"}
            </Button>
          ) : null}
        </>
      }
    >
      {accountMode && connectors.length ? (
        <ResourceDrawerSection title="Accounts">
          {connectors.map((connected) => (
            <ResourceFact
              key={connected.id}
              label={connected.name.replace(`${entry.name} · `, "")}
              value={
                <span className="flex items-center justify-between gap-3">
                  <span>{connected.enabled ? "Available" : "Disabled"}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={saving}
                    onClick={() => void disconnect(connected.id)}
                  >
                    Disconnect
                  </Button>
                </span>
              }
            />
          ))}
        </ResourceDrawerSection>
      ) : null}

      <ResourceDrawerSection title="Tools">
        <ResourceFact label="Access" value={entry.description} />
      </ResourceDrawerSection>

      {entry.unavailableReason ? <Alert variant="warning">{entry.unavailableReason}</Alert> : null}
      {entry.transport === "builtin" ? (
        <Alert variant="info">
          This capability ships inside Local Studio and is always available.
        </Alert>
      ) : null}

      {!accountMode ? (
        <ResourceDrawerSection title="Delivery">
          <ResourceFact label="Runtime" value={runtime} mono />
          <ResourceFact label="Launch" value={renderCatalogCommand(entry)} mono />
          <ResourceFact label="Protocol" value={entry.protocolEra} mono />
          <ResourceFact
            label="Access"
            value={entry.filesystemAccess ? "Explicit filesystem access" : "No filesystem access"}
          />
        </ResourceDrawerSection>
      ) : null}

      {entry.requiredConfiguration.includes("roots") ? (
        <FormField
          label="Allowed roots"
          description="One absolute directory per line. The server cannot access paths outside these roots."
        >
          <textarea
            value={argumentsValue}
            onChange={(event) => setArgumentsValue(event.target.value)}
            placeholder="/absolute/path/to/project"
            className="min-h-28 w-full rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) px-3 py-2 font-mono text-[length:var(--fs-sm)] text-(--ui-fg) focus:border-(--ui-accent)/60 focus:outline-none"
          />
        </FormField>
      ) : null}

      {entry.requiredConfiguration.includes("repository") ? (
        <FormField
          label="Repository"
          description="Absolute path to the repository this MCP may inspect and modify."
        >
          <Input
            value={argumentsValue}
            onChange={(event) => setArgumentsValue(event.target.value)}
            placeholder="/absolute/path/to/repository"
            className="font-mono"
          />
        </FormField>
      ) : null}

      {accountMode ? (
        <FormField label="Account label">
          <Input
            value={accountLabel}
            onChange={(event) => setAccountLabel(event.target.value)}
            placeholder={`Account ${connectors.length + 1}`}
          />
        </FormField>
      ) : null}

      {entry.envFields.map((field) => (
        <FormField
          key={field.key}
          label={field.label}
          description={accountMode ? undefined : field.key}
        >
          <Input
            value={environment[field.key] ?? ""}
            onChange={(event) =>
              setEnvironment((current) => ({ ...current, [field.key]: event.target.value }))
            }
            placeholder={field.placeholder}
            type={field.secret && environment[field.key] !== MASK ? "password" : "text"}
            className="font-mono"
          />
        </FormField>
      ))}

      {entry.installable && entry.transport !== "builtin" && !accountMode ? (
        <div className="mt-6">
          <Checkbox
            checked={enabled}
            onChange={setEnabled}
            label="Enabled — offer these tools to the selected model"
          />
        </div>
      ) : null}

      {missingConfiguration ? (
        <p className="mt-4 text-[length:var(--fs-sm)] text-(--warn)">{missingConfiguration}</p>
      ) : null}
      {error ? <p className="mt-4 text-[length:var(--fs-sm)] text-(--ui-danger)">{error}</p> : null}
    </ResourceDrawer>
  );
}
