"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Schema } from "effect";
import {
  PluginRuntimeResponseSchema,
  type PluginRuntimeView,
} from "@local-studio/agent-runtime/plugin-runtime-contract";
import { ApiErrorResponseSchema } from "@local-studio/agent-runtime/api-contract";
import {
  Alert,
  Button,
  ModelButton,
  SearchInput,
  StatusPill,
  type UiTone,
  UiModal,
  UiModalBody,
  UiModalFooter,
  UiModalHeader,
} from "@/ui";
import { Eye, X } from "@/ui/icon-registry";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { SettingsButton, SettingsGroup } from "@/features/settings/settings-ui";
import {
  DataRow,
  EndCell,
  HeadCell,
  IdentityCell,
  RowAction,
  StatusText,
  statusToneFor,
  TableFrame,
  TableNotice,
  TableSection,
  TableSkeleton,
  TextCell,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import { GoogleAccountModal } from "./google-account-modal";

type PluginStatus = { label: string; tone: UiTone };

function responseError(body: unknown, fallback: string): string {
  try {
    return Schema.decodeUnknownSync(ApiErrorResponseSchema)(body).error;
  } catch {
    return fallback;
  }
}

async function pluginResponse(response: Response, fallback: string) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body, fallback));
  return Schema.decodeUnknownSync(PluginRuntimeResponseSchema)(body);
}

function capabilitySummary(plugin: PluginRuntimeView): string {
  return [
    plugin.provides.skills ? "skills" : null,
    plugin.provides.mcpServers || plugin.account
      ? `${plugin.tools.serverCount} ${plugin.account ? "remote " : ""}MCP ${plugin.tools.serverCount === 1 ? "server" : "servers"}`
      : null,
    plugin.provides.apps ? "account app" : null,
    `v${plugin.version}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function pluginStatus(plugin: PluginRuntimeView): PluginStatus {
  if (plugin.account && !plugin.account.configured) return { label: "Setup", tone: "warning" };
  if (plugin.account && !plugin.account.connected) return { label: "Sign in", tone: "warning" };
  if (plugin.tools.state === "enabled") {
    return {
      label: `Observe · ${plugin.tools.allowedToolCount} ${plugin.tools.allowedToolCount === 1 ? "tool" : "tools"}`,
      tone: "good",
    };
  }
  if (plugin.tools.state === "available") return { label: "Available", tone: "info" };
  if (plugin.tools.state === "disabled") return { label: "Off", tone: "default" };
  if (plugin.tools.state === "invalid") return { label: "Unavailable", tone: "danger" };
  if (plugin.tools.state === "configuration_required" || plugin.provides.apps) {
    return { label: "Adapter needed", tone: "warning" };
  }
  return { label: "Skills", tone: "default" };
}

function activationAction(plugin: PluginRuntimeView): "account" | "connect" | "disconnect" | null {
  if (plugin.account && !plugin.account.connected) return "account";
  if (plugin.account) {
    return plugin.tools.state === "available" || plugin.tools.state === "disabled"
      ? "connect"
      : null;
  }
  if (plugin.tools.state === "enabled") return "disconnect";
  if (plugin.tools.state === "available" || plugin.tools.state === "disabled") return "connect";
  return null;
}

type PluginRowAction = ReturnType<typeof activationAction>;

function pluginActionLabel(plugin: PluginRuntimeView, action: PluginRowAction): string {
  if (action === "account") return plugin.account?.configured ? "Sign in" : "Set up";
  if (action === "connect") return "Connect";
  return "Disconnect";
}

function PluginRowActions({
  plugin,
  action,
  busy,
  onConnect,
  onDisconnect,
  onAccount,
}: {
  plugin: PluginRuntimeView;
  action: PluginRowAction;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onAccount: () => void;
}) {
  const actionLabel = action ? pluginActionLabel(plugin, action) : "";
  const handleAction =
    action === "account" ? onAccount : action === "connect" ? onConnect : onDisconnect;
  return (
    <>
      {plugin.account?.connected ? (
        <RowAction onClick={onAccount} disabled={busy} title={`Manage ${plugin.displayName}`}>
          Manage
        </RowAction>
      ) : null}
      {action ? (
        <RowAction
          onClick={handleAction}
          disabled={busy}
          tone={action === "disconnect" ? "danger" : "accent"}
          title={`${actionLabel} ${plugin.displayName}`}
        >
          {busy ? "Working" : actionLabel}
        </RowAction>
      ) : null}
    </>
  );
}

const PLUGIN_COLUMNS = ["Plugin", "Capabilities", "State"] as const;
const PLUGIN_MIN_WIDTH = "min-w-[40rem]";

function PluginRow({
  plugin,
  busy,
  onOpen,
  onConnect,
  onDisconnect,
  onAccount,
}: {
  plugin: PluginRuntimeView;
  busy: boolean;
  onOpen: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onAccount: () => void;
}) {
  const status = pluginStatus(plugin);
  const action = activationAction(plugin);
  return (
    <DataRow onOpen={onOpen} ariaLabel={`Open ${plugin.displayName}`}>
      <IdentityCell
        leading={
          <ResourceLogo
            identity={plugin.id}
            label={plugin.displayName}
            company={plugin.source}
            brandColor={plugin.brandColor}
          />
        }
        label={plugin.displayName}
        description={plugin.account?.email || plugin.description || plugin.category}
      />
      <TextCell sub={plugin.tools.reason || undefined}>
        {`${plugin.source} · ${capabilitySummary(plugin)}`}
      </TextCell>
      <EndCell>
        <div className="flex items-center justify-end gap-2">
          <StatusText tone={statusToneFor(status.tone)}>{status.label}</StatusText>
          {action || plugin.account?.connected ? (
            <PluginRowActions
              plugin={plugin}
              action={action}
              busy={busy}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onAccount={onAccount}
            />
          ) : null}
        </div>
      </EndCell>
    </DataRow>
  );
}

function PluginDrawer({
  plugin,
  busy,
  onClose,
  onConnect,
  onDisconnect,
  onAccount,
}: {
  plugin: PluginRuntimeView;
  busy: boolean;
  onClose: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onAccount: () => void;
}) {
  const status = pluginStatus(plugin);
  const action = activationAction(plugin);
  const capabilities = [
    ...plugin.capabilities,
    plugin.provides.skills ? "Skills" : null,
    plugin.provides.mcpServers ? "MCP tools" : null,
    plugin.provides.apps ? "App integration" : null,
  ].filter((value): value is string => Boolean(value));
  return (
    <ResourceDrawer
      title={plugin.displayName}
      icon={
        <ResourceLogo
          identity={plugin.id}
          label={plugin.displayName}
          company={plugin.source}
          brandColor={plugin.brandColor}
        />
      }
      badge={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
      status={`${plugin.source} · ${plugin.category} · v${plugin.version}`}
      footer={
        action || plugin.account?.connected ? (
          <PluginRowActions
            plugin={plugin}
            action={action}
            busy={busy}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onAccount={onAccount}
          />
        ) : null
      }
      onClose={onClose}
    >
      <p className="mb-6 text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
        {plugin.description || "No plugin description was provided."}
      </p>
      <ResourceDrawerSection title="Identity">
        <ResourceFact label="Company or source" value={plugin.source} />
        <ResourceFact label="Category" value={plugin.category} />
        <ResourceFact label="Plugin ID" value={plugin.id} mono />
        <ResourceFact label="Version" value={plugin.version} mono />
      </ResourceDrawerSection>
      <ResourceDrawerSection title="Capabilities">
        <ResourceFact label="Provides" value={capabilities.join(" · ") || "Skill bundle"} />
        <ResourceFact label="Tool servers" value={String(plugin.tools.serverCount)} mono />
        <ResourceFact label="Allowed tools" value={String(plugin.tools.allowedToolCount)} mono />
        <ResourceFact label="Mode" value={plugin.tools.mode ?? "not connected"} mono />
      </ResourceDrawerSection>
      {plugin.account ? (
        <ResourceDrawerSection title="Account">
          <ResourceFact label="Provider" value={plugin.account.provider} />
          <ResourceFact
            label="Connection"
            value={plugin.account.connected ? "Connected" : "Not connected"}
          />
          {plugin.account.email ? (
            <ResourceFact label="Account" value={plugin.account.email} />
          ) : null}
        </ResourceDrawerSection>
      ) : null}
    </ResourceDrawer>
  );
}

export function PluginsSection() {
  const [plugins, setPlugins] = useState<readonly PluginRuntimeView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PluginRuntimeView | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginRuntimeView | null>(null);
  const [accountPlugin, setAccountPlugin] = useState<PluginRuntimeView | null>(null);
  const requestGeneration = useRef(0);

  const loadPlugins = useCallback(() => {
    const generation = ++requestGeneration.current;
    return fetch("/api/agent/plugins", { cache: "no-store" })
      .then(async (response) => {
        const payload = await pluginResponse(response, "Plugin discovery failed");
        if (generation !== requestGeneration.current) return;
        setPlugins(payload.plugins);
        setError("");
      })
      .catch((loadError: unknown) => {
        if (generation !== requestGeneration.current) return;
        setError(loadError instanceof Error ? loadError.message : "Plugin discovery failed");
      })
      .finally(() => {
        if (generation === requestGeneration.current) setLoaded(true);
      });
  }, []);

  useMountSubscription(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const handleAccountChanged = useCallback(() => {
    void loadPlugins();
  }, [loadPlugins]);

  const visiblePlugins = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return plugins;
    return plugins.filter((plugin) =>
      `${plugin.displayName} ${plugin.description} ${plugin.category} ${capabilitySummary(plugin)}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [plugins, query]);

  const setEnabled = async (plugin: PluginRuntimeView, enabled: boolean) => {
    const generation = ++requestGeneration.current;
    setBusyId(plugin.id);
    setError("");
    try {
      const response = await fetch(`/api/agent/plugins/${encodeURIComponent(plugin.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await pluginResponse(response, "Plugin activation failed");
      if (generation !== requestGeneration.current) return;
      setPlugins(payload.plugins);
      setPending(null);
    } catch (activationError) {
      if (generation !== requestGeneration.current) return;
      setError(
        activationError instanceof Error ? activationError.message : "Plugin activation failed",
      );
    } finally {
      setBusyId((current) => (current === plugin.id ? null : current));
    }
  };

  return (
    <>
      {error ? (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
      <TableSection
        title="Plugins"
        description="Capability bundles from Local Studio and Codex, with their company, tools, accounts, and skills."
        actions={
          <div className="flex items-center gap-2">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search plugins"
              className="w-56"
            />
            <StatusText tone={error ? "warn" : loaded ? "ok" : "dim"}>
              {loaded ? `${visiblePlugins.length} of ${plugins.length}` : "discovering"}
            </StatusText>
          </div>
        }
      >
        {!loaded ? (
          <TableSkeleton columns={PLUGIN_COLUMNS} rows={3} minWidthClass={PLUGIN_MIN_WIDTH} />
        ) : visiblePlugins.length === 0 ? (
          <TableNotice
            title={plugins.length ? `No plugin matches “${query}”` : "No plugins found"}
            body="Plugins are discovered from the manifests Local Studio and Codex install on this machine. Install one, or clear the search."
          />
        ) : (
          <TableFrame minWidthClass={PLUGIN_MIN_WIDTH}>
            <thead>
              <tr>
                {PLUGIN_COLUMNS.map((column, index) => (
                  <HeadCell key={column} numeric={index === PLUGIN_COLUMNS.length - 1}>
                    {column}
                  </HeadCell>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiblePlugins.map((plugin) => (
                <PluginRow
                  key={plugin.id}
                  plugin={plugin}
                  busy={busyId === plugin.id}
                  onOpen={() => setSelectedPlugin(plugin)}
                  onConnect={() => {
                    setSelectedPlugin(null);
                    setPending(plugin);
                  }}
                  onDisconnect={() => {
                    setSelectedPlugin(null);
                    void setEnabled(plugin, false);
                  }}
                  onAccount={() => {
                    setSelectedPlugin(null);
                    setAccountPlugin(plugin);
                  }}
                />
              ))}
            </tbody>
          </TableFrame>
        )}
      </TableSection>
      {selectedPlugin ? (
        <PluginDrawer
          plugin={selectedPlugin}
          busy={busyId === selectedPlugin.id}
          onClose={() => setSelectedPlugin(null)}
          onConnect={() => {
            setSelectedPlugin(null);
            setPending(selectedPlugin);
          }}
          onDisconnect={() => {
            setSelectedPlugin(null);
            void setEnabled(selectedPlugin, false);
          }}
          onAccount={() => {
            setSelectedPlugin(null);
            setAccountPlugin(selectedPlugin);
          }}
        />
      ) : null}
      <UiModal
        isOpen={pending !== null}
        onClose={() => !busyId && setPending(null)}
        maxWidth="max-w-md"
      >
        <UiModalHeader
          title={`Connect ${pending?.displayName ?? "plugin"}?`}
          icon={
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-(--ui-info)/30 bg-(--ui-info)/10">
              <Eye className="h-4 w-4 text-(--ui-info)" />
            </span>
          }
          onClose={() => !busyId && setPending(null)}
          closeIcon={<X className="h-4 w-4" />}
        />
        <UiModalBody className="space-y-4">
          <Alert variant="info">
            Observe mode starts this plugin locally and exposes only tools it declares read-only.
            Desktop actions stay blocked until Local Studio has an action-time approval prompt.
          </Alert>
          <p className="text-[length:var(--fs-base)] leading-relaxed text-(--ui-muted)">
            The bundle remains in its installed location. Disconnecting stops exposing its tools to
            Workbench sessions.
          </p>
        </UiModalBody>
        <UiModalFooter>
          <Button variant="ghost" onClick={() => setPending(null)} disabled={Boolean(busyId)}>
            Cancel
          </Button>
          <Button
            onClick={() => pending && void setEnabled(pending, true)}
            disabled={!pending || Boolean(busyId)}
            loading={Boolean(busyId)}
          >
            Connect in observe mode
          </Button>
        </UiModalFooter>
      </UiModal>
      {accountPlugin?.account?.provider === "google" ? (
        <GoogleAccountModal
          accountId={accountPlugin.account.id}
          displayName={accountPlugin.displayName}
          onClose={() => setAccountPlugin(null)}
          onChanged={handleAccountChanged}
        />
      ) : null}
    </>
  );
}
