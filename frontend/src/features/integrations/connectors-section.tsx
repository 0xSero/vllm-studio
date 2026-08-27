"use client";

import { useCallback, useMemo, useState } from "react";
import { Schema } from "effect";
import { ConnectorsResponseSchema, type ConnectorView } from "@shared/agent/connector-contract";
import { Button, SearchInput, Spinner, StatusPill } from "@/ui";
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
import { jsonBody, requestAgentJson } from "./agent-json";
import {
  hydrateConnectorCatalog,
  renderCatalogCommand,
  renderConnectorCommand,
  type CatalogEntry,
} from "./connector-catalog";
import { CatalogConnectorDrawer } from "./catalog-connector-drawer";
import {
  ConnectorEditorDrawer,
  draftFromCatalog,
  draftFromConnector,
  emptyDraft,
  resolveSshServerPath,
  type ConnectorDraft,
} from "./connector-editor-drawer";
import { ConnectorOAuthDrawer } from "./connector-oauth-drawer";

const CONNECTOR_MIN_WIDTH = "min-w-[42rem]";

const listConnectors = (init?: RequestInit) =>
  requestAgentJson(
    "/api/agent/connectors",
    Schema.decodeUnknownSync(ConnectorsResponseSchema),
    init,
  );

function ManagedConnectorDrawer({
  connector,
  onClose,
}: {
  connector: ConnectorView;
  onClose: () => void;
}) {
  return (
    <ResourceDrawer
      title={connector.name}
      icon={<ResourceLogo identity={connector.id} label={connector.name} />}
      badge={
        <StatusPill tone={connector.enabled ? "good" : "default"}>
          {connector.enabled ? "enabled" : "disabled"}
        </StatusPill>
      }
      status={`${connector.origin?.kind ?? "managed"} · ${connector.origin?.id ?? connector.id}`}
      footer={<Button onClick={onClose}>Done</Button>}
      onClose={onClose}
    >
      <p className="mb-6 text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
        This connector is generated from a signed-in account. Its address and its tool list are
        rewritten from that account every time they are read, so there is nothing here to edit —
        change it by changing the account.
      </p>
      <ResourceDrawerSection title="Identity">
        <ResourceFact label="Connector ID" value={connector.id} mono />
        <ResourceFact label="Transport" value={connector.transport} mono />
        <ResourceFact label="Reaches" value={renderConnectorCommand(connector)} mono />
      </ResourceDrawerSection>
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
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState("");

  const run = (url: string, init: RequestInit, failure: string) => {
    setBusy(true);
    setRowError("");
    void requestAgentJson(url, Schema.decodeUnknownSync(ConnectorsResponseSchema), init)
      .then(({ connectors }) => onChanged(connectors))
      .catch((error: unknown) => setRowError(error instanceof Error ? error.message : failure))
      .finally(() => setBusy(false));
  };

  const toggle = () =>
    run(
      "/api/agent/connectors",
      jsonBody({
        id: connector.id,
        name: connector.name,
        transport: connector.transport,
        command: connector.command,
        args: connector.args,
        cwd: connector.cwd,
        url: connector.url,
        env: connector.env,
        headers: connector.headers,
        enabled: !connector.enabled,
      }),
      "Connector update failed",
    );

  const remove = () =>
    run(
      `/api/agent/connectors?id=${encodeURIComponent(connector.id)}`,
      { method: "DELETE" },
      "Removal failed",
    );

  return (
    <DataRow onOpen={onOpen} ariaLabel={`Open ${connector.name}`}>
      <IdentityCell
        leading={<ResourceLogo identity={connector.id} label={connector.name} />}
        label={connector.name}
        description={
          rowError ||
          (connector.origin
            ? `${connector.origin.kind} · ${connector.origin.id}`
            : `${connector.transport} · ${connector.id}`)
        }
      />
      <TextCell mono title={renderConnectorCommand(connector)}>
        {renderConnectorCommand(connector)}
      </TextCell>
      <EndCell>
        <div className="flex items-center justify-end gap-2">
          <StatusText tone={connector.enabled ? "ok" : "dim"}>
            {connector.enabled ? "enabled" : "disabled"}
          </StatusText>
          {busy ? <Spinner size="xs" /> : null}
          <RowAction
            alwaysVisible
            disabled={busy}
            onClick={toggle}
            title={
              connector.enabled
                ? "Stop offering these tools to the model"
                : "Offer these tools to the model from your next message"
            }
          >
            {connector.enabled ? "Disable" : "Enable"}
          </RowAction>
          {connector.origin ? null : (
            <RowAction
              alwaysVisible
              disabled={busy}
              onClick={remove}
              tone="danger"
              title={`Remove ${connector.name}`}
            >
              <Trash2 className="h-3 w-3" />
            </RowAction>
          )}
        </div>
      </EndCell>
    </DataRow>
  );
}

type Editing = { draft: ConnectorDraft; mode: "create" | "edit"; secretKeys: readonly string[] };

export function ConnectorsSection({ searchQuery }: { searchQuery?: string } = {}) {
  const [connectors, setConnectors] = useState<readonly ConnectorView[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [localQuery, setLocalQuery] = useState("");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [managed, setManaged] = useState<ConnectorView | null>(null);
  const [oauthEntry, setOauthEntry] = useState<CatalogEntry | null>(null);
  const [catalogEntry, setCatalogEntry] = useState<CatalogEntry | null>(null);

  const refresh = useCallback(() => {
    void listConnectors()
      .then(({ connectors: list, catalog: nextCatalog }) => {
        setConnectors(list);
        setCatalog(hydrateConnectorCatalog(nextCatalog.entries));
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, [setConnectors]);

  useMountSubscription(() => {
    refresh();
    const interval = window.setInterval(refresh, 3_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const open = (connector: ConnectorView) => {
    if (connector.origin) {
      setManaged(connector);
      return;
    }
    const oauthCatalog = catalog.find((entry) => entry.auth && entry.id === connector.id);
    if (oauthCatalog) {
      setOauthEntry(oauthCatalog);
      return;
    }
    const managedCatalog = catalog.find(
      (entry) =>
        entry.id === connector.id &&
        (entry.runtime || entry.transport === "http" || entry.unavailableReason),
    );
    if (managedCatalog) {
      setCatalogEntry(managedCatalog);
      return;
    }
    setEditing({
      draft: draftFromConnector(connector),
      mode: "edit",
      secretKeys: connector.secret_keys,
    });
  };

  const openCatalogEntry = (entry: CatalogEntry) => {
    if (entry.auth) {
      setOauthEntry(entry);
      return;
    }
    const installed = connectors.find((connector) => connector.id === entry.id);
    if (installed) {
      open(installed);
      return;
    }
    if (
      entry.transport === "builtin" ||
      entry.runtime ||
      entry.transport === "http" ||
      entry.unavailableReason
    ) {
      setCatalogEntry(entry);
      return;
    }
    void resolveSshServerPath()
      .catch(() => null)
      .then((path) =>
        setEditing({ draft: draftFromCatalog(entry, path), mode: "create", secretKeys: [] }),
      );
  };

  const query = searchQuery ?? localQuery;
  const normalized = query.trim().toLowerCase();
  const visibleConnectors = useMemo(
    () =>
      connectors.filter(
        (connector) =>
          connector.origin?.kind !== "account-adapter" &&
          (!normalized ||
            `${connector.name} ${connector.id} ${renderConnectorCommand(connector)}`
              .toLowerCase()
              .includes(normalized)),
      ),
    [connectors, normalized],
  );
  const visibleCatalog = catalog.filter(
    (entry) =>
      !normalized ||
      `${entry.name} ${entry.company} ${entry.description}`.toLowerCase().includes(normalized),
  );

  return (
    <div className="space-y-7">
      <TableSection
        title="MCP servers"
        description="Programs and endpoints that hand the model extra tools. Each one runs on this machine."
        actions={
          <div className="flex items-center gap-2">
            {searchQuery === undefined ? (
              <SearchInput
                value={query}
                onChange={setLocalQuery}
                placeholder="Search servers"
                className="w-56"
              />
            ) : null}
            <StatusText tone={loaded ? "ok" : "dim"}>
              {loaded ? `${visibleConnectors.length} registered` : "reading"}
            </StatusText>
            <Button
              size="sm"
              onClick={() => setEditing({ draft: emptyDraft(), mode: "create", secretKeys: [] })}
            >
              <Plus className="h-3.5 w-3.5" />
              Add server
            </Button>
          </div>
        }
      >
        {loaded && visibleConnectors.length === 0 ? (
          <div className="flex min-h-20 items-center justify-center text-[length:var(--fs-xs)] text-(--ui-muted)">
            {connectors.length ? "No server matches this search" : "No MCP server"}
          </div>
        ) : (
          <TableFrame minWidthClass={CONNECTOR_MIN_WIDTH}>
            <thead>
              <tr>
                <HeadCell>Server</HeadCell>
                <HeadCell title="Exactly what this row launches or calls">Runs</HeadCell>
                <HeadCell numeric>State</HeadCell>
              </tr>
            </thead>
            <tbody>
              {visibleConnectors.map((connector) => (
                <ConnectorRow
                  key={connector.id}
                  connector={connector}
                  onOpen={() => open(connector)}
                  onChanged={setConnectors}
                />
              ))}
            </tbody>
          </TableFrame>
        )}
      </TableSection>

      <TableSection
        title="Start from a known configuration"
        description="Curated definitions served by the controller. Pinned runtimes download into an isolated Local Studio cache only when first used."
        actions={<StatusText>{`${visibleCatalog.length} configurations`}</StatusText>}
      >
        {visibleCatalog.length === 0 ? (
          <TableNotice
            title="No configuration matches this search"
            body="These are the launch configurations Local Studio ships with. Clear the search to see them all."
          />
        ) : (
          <TableFrame minWidthClass={CONNECTOR_MIN_WIDTH}>
            <thead>
              <tr>
                <HeadCell>Configuration</HeadCell>
                <HeadCell>Runs</HeadCell>
                <HeadCell numeric>State</HeadCell>
              </tr>
            </thead>
            <tbody>
              {visibleCatalog.map((entry) => {
                const installed = connectors.some((connector) => connector.id === entry.id);
                const commandLine = renderCatalogCommand(entry);
                return (
                  <DataRow
                    key={entry.id}
                    onOpen={() => openCatalogEntry(entry)}
                    ariaLabel={`Open ${entry.name}`}
                  >
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
                    <TextCell mono title={commandLine}>
                      {commandLine}
                    </TextCell>
                    <EndCell>
                      <div className="flex items-center justify-end gap-2">
                        <StatusText
                          tone={installed || entry.transport === "builtin" ? "ok" : "dim"}
                        >
                          {installed
                            ? "registered"
                            : entry.transport === "builtin"
                              ? "built in"
                              : entry.installable
                                ? "not added"
                                : "unavailable"}
                        </StatusText>
                        <RowAction
                          alwaysVisible
                          onClick={() => openCatalogEntry(entry)}
                          title={
                            entry.auth
                              ? `Connect ${entry.name} with ${entry.company} sign-in`
                              : installed
                                ? `Open ${entry.name}`
                                : `Review ${entry.name} before adding it`
                          }
                        >
                          {entry.auth ? (
                            installed ? (
                              "Open"
                            ) : (
                              "Connect"
                            )
                          ) : entry.transport === "builtin" || !entry.installable ? (
                            "Details"
                          ) : installed ? (
                            "Open"
                          ) : (
                            <>
                              <Plus className="h-3 w-3" />
                              Review
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

      {editing ? (
        <ConnectorEditorDrawer
          draft={editing.draft}
          mode={editing.mode}
          takenIds={connectors.map((connector) => connector.id)}
          secretKeys={editing.secretKeys}
          onClose={() => setEditing(null)}
          onChanged={setConnectors}
        />
      ) : null}
      {managed ? (
        <ManagedConnectorDrawer connector={managed} onClose={() => setManaged(null)} />
      ) : null}
      {oauthEntry ? (
        <ConnectorOAuthDrawer
          entry={oauthEntry}
          connector={connectors.find((connector) => connector.id === oauthEntry.id) ?? null}
          onClose={() => setOauthEntry(null)}
          onChanged={setConnectors}
        />
      ) : null}
      {catalogEntry ? (
        <CatalogConnectorDrawer
          entry={catalogEntry}
          connector={connectors.find((connector) => connector.id === catalogEntry.id) ?? null}
          onClose={() => setCatalogEntry(null)}
          onChanged={setConnectors}
        />
      ) : null}
    </div>
  );
}
