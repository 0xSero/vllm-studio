"use client";

import { useCallback, useMemo, useState } from "react";
import { Schema } from "effect";
import {
  ConnectorSshPathResponseSchema,
  ConnectorTestResponseSchema,
  ConnectorsResponseSchema,
  type ConnectorView,
} from "@local-studio/agent-runtime/connector-contract";
import { ApiErrorResponseSchema } from "@local-studio/agent-runtime/api-contract";
import {
  Button,
  Checkbox,
  FormField,
  Input,
  ModelButton,
  RefreshIconButton,
  SearchInput,
  Spinner,
  StatusPill,
} from "@/ui";
import { Plus, Trash2 } from "@/ui/icon-registry";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
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
  TextCell,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

interface CatalogEntry {
  id: string;
  name: string;
  company: string;
  description: string;
  transport: "stdio";
  command: string;
  args: string[];
  envFields: Array<{ key: string; label: string; placeholder?: string }>;
}

const CATALOG: CatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    company: "GitHub",
    description: "Repos, issues, pull requests, and code search.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envFields: [{ key: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "Personal access token" }],
  },
  {
    id: "x",
    name: "X / Twitter",
    company: "X",
    description: "Read and post with X API credentials.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@enescinar/twitter-mcp"],
    envFields: [
      { key: "API_KEY", label: "X API key" },
      { key: "API_SECRET_KEY", label: "X API secret" },
      { key: "ACCESS_TOKEN", label: "Access token" },
      { key: "ACCESS_TOKEN_SECRET", label: "Access token secret" },
    ],
  },
  {
    id: "computer",
    name: "Remote computer",
    company: "Local Studio",
    description: "Run commands and work with files over SSH on another machine.",
    transport: "stdio",
    command: "node",
    args: ["{{SSH_REMOTE_SERVER}}"],
    envFields: [{ key: "SSH_HOST", label: "SSH host", placeholder: "user@machine" }],
  },
];

function responseError(body: unknown, fallback: string): string {
  try {
    return Schema.decodeUnknownSync(ApiErrorResponseSchema)(body).error;
  } catch {
    return fallback;
  }
}

async function requestJson<T>(
  url: string,
  decode: (input: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body, `HTTP ${response.status}`));
  return decode(body);
}

const connectorCommand = (connector: ConnectorView): string =>
  connector.transport === "stdio"
    ? [connector.command, ...(connector.args ?? [])].filter(Boolean).join(" ")
    : (connector.url ?? "HTTP endpoint not set");

function ConnectorDrawer({
  connector,
  onClose,
  onChanged,
}: {
  connector: ConnectorView;
  onClose: () => void;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [name, setName] = useState(connector.name);
  const [command, setCommand] = useState(connector.command ?? "");
  const [args, setArgs] = useState((connector.args ?? []).join("\n"));
  const [url, setUrl] = useState(connector.url ?? "");
  const [enabled, setEnabled] = useState(connector.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const managed = Boolean(connector.origin);

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { connectors } = await requestJson(
        "/api/agent/connectors",
        Schema.decodeUnknownSync(ConnectorsResponseSchema),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: connector.id,
            name: name.trim() || connector.name,
            transport: connector.transport,
            command: command.trim() || undefined,
            args: args
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean),
            url: url.trim() || undefined,
            env: connector.env,
            cwd: connector.cwd,
            headers: connector.headers,
            allowTools: connector.allowTools,
            enabled,
          }),
        },
      );
      onChanged(connectors);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Connector save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResourceDrawer
      title={connector.name}
      icon={<ResourceLogo identity={connector.id} label={connector.name} />}
      badge={
        <StatusPill tone={connector.enabled ? "good" : "default"}>
          {connector.enabled ? "enabled" : "disabled"}
        </StatusPill>
      }
      status={
        connector.origin
          ? `${connector.origin.kind} · ${connector.origin.id}`
          : `${connector.transport} · connectors.json`
      }
      footer={
        managed ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              Save connector
            </Button>
          </>
        )
      }
      onClose={onClose}
      width={680}
    >
      <ResourceDrawerSection title="Identity">
        <ResourceFact label="Connector ID" value={connector.id} mono />
        <ResourceFact label="Transport" value={connector.transport} mono />
        <ResourceFact
          label="Managed by"
          value={connector.origin ? `${connector.origin.kind} · ${connector.origin.id}` : "You"}
        />
        <ResourceFact
          label="Secrets"
          value={
            connector.secret_keys.length ? connector.secret_keys.join(" · ") : "No stored secrets"
          }
          mono
        />
      </ResourceDrawerSection>
      {managed ? (
        <ResourceDrawerSection title="Launch configuration">
          <ResourceFact label="Command" value={connectorCommand(connector)} mono />
          <ResourceFact
            label="Allowed tools"
            value={connector.allowTools?.join(" · ") || "All declared tools"}
            mono
          />
        </ResourceDrawerSection>
      ) : (
        <div className="space-y-4">
          <FormField label="Name">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </FormField>
          {connector.transport === "stdio" ? (
            <>
              <FormField label="Command">
                <Input
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  className="font-mono"
                />
              </FormField>
              <FormField label="Arguments" description="One argument per line.">
                <textarea
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  rows={7}
                  className="w-full rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) px-3 py-2 font-mono text-[length:var(--fs-sm)] text-(--ui-fg) focus:border-(--ui-accent)/60 focus:outline-none"
                />
              </FormField>
            </>
          ) : (
            <FormField label="URL">
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                className="font-mono"
              />
            </FormField>
          )}
          <Checkbox checked={enabled} onChange={setEnabled} label="Enabled in Workbench" />
        </div>
      )}
      {error ? <p className="mt-4 text-[length:var(--fs-sm)] text-(--ui-danger)">{error}</p> : null}
    </ResourceDrawer>
  );
}

function CatalogDrawer({
  entry,
  onClose,
  onChanged,
}: {
  entry: CatalogEntry;
  onClose: () => void;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      let args = entry.args;
      if (entry.args.includes("{{SSH_REMOTE_SERVER}}")) {
        const { path } = await requestJson(
          "/api/agent/connectors/ssh-server-path",
          Schema.decodeUnknownSync(ConnectorSshPathResponseSchema),
        );
        if (!path) throw new Error("Bundled SSH server not found");
        args = entry.args.map((value) => (value === "{{SSH_REMOTE_SERVER}}" ? path : value));
      }
      const host = fields.SSH_HOST?.trim();
      const id = entry.id === "computer" && host ? `computer-${host.split("@").pop()}` : entry.id;
      const name = entry.id === "computer" && host ? `Computer: ${host}` : entry.name;
      const { connectors } = await requestJson(
        "/api/agent/connectors",
        Schema.decodeUnknownSync(ConnectorsResponseSchema),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: id.toLowerCase().replace(/[^a-z0-9-_]+/g, "-"),
            name,
            transport: entry.transport,
            command: entry.command,
            args,
            env: fields,
            enabled: true,
          }),
        },
      );
      onChanged(connectors);
      onClose();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Connector setup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResourceDrawer
      title={`Connect ${entry.name}`}
      icon={<ResourceLogo identity={entry.id} label={entry.name} company={entry.company} />}
      badge={<StatusPill>catalog</StatusPill>}
      status={`${entry.company} · ${entry.transport}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} onClick={() => void add()}>
            Connect
          </Button>
        </>
      }
      onClose={onClose}
    >
      <p className="mb-6 text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
        {entry.description}
      </p>
      <ResourceDrawerSection title="Provider">
        <ResourceFact label="Company" value={entry.company} />
        <ResourceFact label="Transport" value={entry.transport} mono />
        <ResourceFact label="Command" value={[entry.command, ...entry.args].join(" ")} mono />
      </ResourceDrawerSection>
      <div className="space-y-4">
        {entry.envFields.map((field) => (
          <FormField key={field.key} label={field.label}>
            <Input
              value={fields[field.key] ?? ""}
              onChange={(event) =>
                setFields((current) => ({ ...current, [field.key]: event.target.value }))
              }
              placeholder={field.placeholder}
              type={/token|secret|key/i.test(field.key) ? "password" : "text"}
              className="font-mono"
            />
          </FormField>
        ))}
      </div>
      {error ? <p className="mt-4 text-[length:var(--fs-sm)] text-(--ui-danger)">{error}</p> : null}
    </ResourceDrawer>
  );
}

function ConnectorRow({
  connector,
  onOpen,
  onChanged,
}: {
  connector: ConnectorView;
  onOpen: () => void;
  onChanged: (connectors: readonly ConnectorView[]) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const update = async (init: RequestInit) => {
    const { connectors } = await requestJson(
      "/api/agent/connectors",
      Schema.decodeUnknownSync(ConnectorsResponseSchema),
      init,
    );
    onChanged(connectors);
  };

  const toggle = () =>
    update({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...connector, enabled: !connector.enabled }),
    });

  const remove = async () => {
    const { connectors } = await requestJson(
      `/api/agent/connectors?id=${encodeURIComponent(connector.id)}`,
      Schema.decodeUnknownSync(ConnectorsResponseSchema),
      { method: "DELETE" },
    );
    onChanged(connectors);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await requestJson(
        "/api/agent/connectors/test",
        Schema.decodeUnknownSync(ConnectorTestResponseSchema),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: connector.id }),
        },
      );
      setTestResult(result.ok ? `${result.tool_count} tools` : (result.error ?? "failed"));
    } catch (testError) {
      setTestResult(testError instanceof Error ? testError.message : "failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <DataRow onOpen={onOpen} ariaLabel={`Open ${connector.name}`}>
      <IdentityCell
        leading={<ResourceLogo identity={connector.id} label={connector.name} />}
        label={connector.name}
        description={
          connector.origin
            ? `${connector.origin.kind} · ${connector.origin.id}`
            : `${connector.transport} connector`
        }
      />
      <TextCell mono>{connectorCommand(connector)}</TextCell>
      <EndCell>
        <div className="flex items-center justify-end gap-2">
          <StatusText tone={connector.enabled ? "ok" : "dim"}>
            {testResult || (connector.enabled ? "enabled" : "disabled")}
          </StatusText>
          <RowAction
            alwaysVisible
            onClick={() => void test()}
            disabled={testing}
            title="Test this connector"
          >
            {testing ? <Spinner size="xs" /> : "Test"}
          </RowAction>
          <RowAction alwaysVisible onClick={() => void toggle()}>
            {connector.enabled ? "Disable" : "Enable"}
          </RowAction>
          {!connector.origin ? (
            <RowAction
              alwaysVisible
              onClick={() => void remove()}
              tone="danger"
              title="Remove connector"
            >
              <Trash2 className="h-3 w-3" />
            </RowAction>
          ) : null}
        </div>
      </EndCell>
    </DataRow>
  );
}

const CONNECTOR_MIN_WIDTH = "min-w-[42rem]";

export function ConnectorsSection() {
  const [connectors, setConnectors] = useState<readonly ConnectorView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedConnector, setSelectedConnector] = useState<ConnectorView | null>(null);
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogEntry | null>(null);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void requestJson("/api/agent/connectors", Schema.decodeUnknownSync(ConnectorsResponseSchema))
      .then(({ connectors: list }) => setConnectors(list))
      .catch(() => setConnectors([]))
      .finally(() => {
        setLoaded(true);
        setRefreshing(false);
      });
  }, []);

  useMountSubscription(() => {
    refresh();
  }, [refresh]);

  const normalized = query.trim().toLowerCase();
  const visibleConnectors = useMemo(
    () =>
      connectors.filter(
        (connector) =>
          connector.origin?.kind !== "account-adapter" &&
          (!normalized ||
            `${connector.name} ${connector.id} ${connectorCommand(connector)}`
              .toLowerCase()
              .includes(normalized)),
      ),
    [connectors, normalized],
  );
  const visibleCatalog = CATALOG.filter(
    (entry) =>
      !normalized ||
      `${entry.name} ${entry.company} ${entry.description}`.toLowerCase().includes(normalized),
  );

  return (
    <div className="space-y-7">
      <TableSection
        title="Connectors"
        description="MCP servers, accounts, services, and machines available to Workbench."
        actions={
          <div className="flex items-center gap-2">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search connectors"
              className="w-56"
            />
            <StatusText tone={loaded ? "ok" : "dim"}>
              {loaded ? `${visibleConnectors.length} connected` : "discovering"}
            </StatusText>
            <RefreshIconButton
              onClick={refresh}
              loading={refreshing}
              label="Refresh connectors"
            />
          </div>
        }
      >
        {loaded && visibleConnectors.length === 0 ? (
          <TableNotice
            title="No connected MCP servers match this search"
            body="Connect one from the catalog below, or clear the search to see everything already connected."
          />
        ) : (
          <TableFrame minWidthClass={CONNECTOR_MIN_WIDTH}>
            <thead>
              <tr>
                <HeadCell>Connector</HeadCell>
                <HeadCell>Command</HeadCell>
                <HeadCell numeric>State</HeadCell>
              </tr>
            </thead>
            <tbody>
              {visibleConnectors.map((connector) => (
                <ConnectorRow
                  key={connector.id}
                  connector={connector}
                  onOpen={() => setSelectedConnector(connector)}
                  onChanged={setConnectors}
                />
              ))}
            </tbody>
          </TableFrame>
        )}
      </TableSection>

      <TableSection
        title="Catalog"
        description="Known integrations with their provider and launch configuration."
        actions={<StatusText>{`${visibleCatalog.length} integrations`}</StatusText>}
      >
        {visibleCatalog.length === 0 ? (
          <TableNotice
            title="No integration matches this search"
            body="The catalog lists the integrations Local Studio knows how to launch. Clear the search to see them all."
          />
        ) : (
          <TableFrame minWidthClass={CONNECTOR_MIN_WIDTH}>
            <thead>
              <tr>
                <HeadCell>Integration</HeadCell>
                <HeadCell>Launches</HeadCell>
                <HeadCell numeric>State</HeadCell>
              </tr>
            </thead>
            <tbody>
              {visibleCatalog.map((entry) => {
                const installedConnector = connectors.find(
                  (connector) => connector.id === entry.id,
                );
                const installed = Boolean(installedConnector);
                const openEntry = () =>
                  installedConnector
                    ? setSelectedConnector(installedConnector)
                    : setSelectedCatalog(entry);
                return (
                  <DataRow key={entry.id} onOpen={openEntry} ariaLabel={`Open ${entry.name}`}>
                    <IdentityCell
                      leading={
                        <ResourceLogo
                          identity={entry.id}
                          label={entry.name}
                          company={entry.company}
                        />
                      }
                      label={entry.name}
                      description={`${entry.company} · ${entry.description}`}
                    />
                    <TextCell mono>{[entry.command, ...entry.args].join(" ")}</TextCell>
                    <EndCell>
                      <div className="flex items-center justify-end gap-2">
                        <StatusText tone={installed ? "ok" : "dim"}>
                          {installed ? "connected" : "available"}
                        </StatusText>
                        <RowAction
                          onClick={openEntry}
                          title={installed ? `Open ${entry.name}` : `Connect ${entry.name}`}
                        >
                          {installed && entry.id !== "computer" ? (
                            "Open"
                          ) : (
                            <>
                              <Plus className="h-3 w-3" />
                              Connect
                            </>
                          )}
                        </RowAction>
                      </div>
                    </EndCell>
                  </DataRow>
                );
              })}
            </tbody>
          </TableFrame>
        )}
      </TableSection>

      {selectedConnector ? (
        <ConnectorDrawer
          connector={selectedConnector}
          onClose={() => setSelectedConnector(null)}
          onChanged={setConnectors}
        />
      ) : null}
      {selectedCatalog ? (
        <CatalogDrawer
          entry={selectedCatalog}
          onClose={() => setSelectedCatalog(null)}
          onChanged={setConnectors}
        />
      ) : null}
    </div>
  );
}
