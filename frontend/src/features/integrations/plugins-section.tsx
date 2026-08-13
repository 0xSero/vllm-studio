"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Schema } from "effect";
import {
  PluginRuntimeResponseSchema,
  type PluginRuntimeView,
} from "@local-studio/agent-runtime/plugin-runtime-contract";
import { ApiErrorResponseSchema } from "@local-studio/agent-runtime/api-contract";
import { Alert, Button, ModelButton, SearchInput, UiModal, UiModalHeader } from "@/ui";
import { Eye, X } from "@/ui/icon-registry";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import { ResourceLogo } from "@/ui/resource-logo";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { StatusTone } from "@/features/settings/settings-ui";
import { ModelStatus } from "@/features/recipes/recipes-content/model-page";
import { GoogleAccountModal } from "./google-account-modal";

type PluginStatus = { label: string; tone: StatusTone };

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

function PluginCatalogState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-44 items-center justify-center px-6 py-12 text-center text-[length:var(--fs-md)] text-(--ui-muted)">
      {children}
    </div>
  );
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
        <ModelButton
          onClick={onAccount}
          disabled={busy}
          aria-label={`Manage ${plugin.displayName}`}
        >
          Manage
        </ModelButton>
      ) : null}
      {action ? (
        <ModelButton
          onClick={handleAction}
          disabled={busy}
          aria-label={`${actionLabel} ${plugin.displayName}`}
        >
          {busy ? "Working" : actionLabel}
        </ModelButton>
      ) : null}
    </>
  );
}

function PluginCard({
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
    <article
      role="button"
      tabIndex={0}
      aria-label={`Open ${plugin.displayName} details`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
          return;
        }
        event.preventDefault();
        onOpen();
      }}
      className="group flex min-h-36 min-w-0 cursor-pointer flex-col rounded-[10px] border border-(--ui-border) bg-(--ui-surface) p-3 transition-[transform,background-color,border-color] hover:bg-(--ui-hover)/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--ui-info)/45 active:scale-[0.995]"
    >
      <div className="flex min-w-0 items-start gap-3">
        <ResourceLogo
          identity={plugin.id}
          label={plugin.displayName}
          company={plugin.source}
          brandColor={plugin.brandColor}
          size="md"
        />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[length:var(--fs-md)] font-medium text-(--ui-fg)">
            {plugin.displayName}
          </h4>
          <p className="mt-1 line-clamp-2 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
            {plugin.description || plugin.category}
          </p>
        </div>
      </div>
      <div className="mt-auto flex min-w-0 items-end justify-between gap-2 border-t border-(--ui-separator)/70 pt-2.5">
        <div className="min-w-0">
          <ModelStatus tone={status.tone}>{status.label}</ModelStatus>
          <div
            className="mt-1 truncate text-[length:var(--fs-xs)] text-(--ui-muted)"
            title={`${plugin.source} · ${capabilitySummary(plugin)}`}
          >
            {plugin.source} · {capabilitySummary(plugin)}
          </div>
        </div>
        {action || plugin.account?.connected ? (
          <div
            className="flex shrink-0 items-center gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            <PluginRowActions
              plugin={plugin}
              action={action}
              busy={busy}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onAccount={onAccount}
            />
          </div>
        ) : null}
      </div>
    </article>
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
      badge={<ModelStatus tone={status.tone}>{status.label}</ModelStatus>}
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
      <section className="@container min-w-0">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[length:var(--fs-md)] font-medium text-(--ui-fg)">Plugins</h3>
            <p className="mt-0.5 max-w-[38rem] text-[length:var(--fs-sm)] text-(--ui-muted)">
              Capability bundles from Local Studio and Codex, with their company, tools, accounts,
              and skills.
            </p>
          </div>
          <ModelStatus tone={error ? "warning" : loaded ? "good" : "default"}>
            {loaded ? `${visiblePlugins.length} of ${plugins.length}` : "Discovering"}
          </ModelStatus>
        </div>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search plugins"
          className="mb-4 w-full max-w-[30rem]"
        />
        {error && plugins.length ? (
          <div className="mb-4 flex justify-center">
            <Alert variant="error" className="w-full max-w-lg">
              {error}
            </Alert>
          </div>
        ) : null}
        {!loaded ? (
          <PluginCatalogState>Discovering plugins…</PluginCatalogState>
        ) : error && !plugins.length ? (
          <PluginCatalogState>
            <Alert variant="error" className="w-full max-w-lg text-left">
              {error}
            </Alert>
          </PluginCatalogState>
        ) : visiblePlugins.length ? (
          <div className="grid grid-cols-1 gap-3 @min-[581px]:grid-cols-2">
            {visiblePlugins.map((plugin) => (
              <PluginCard
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
          </div>
        ) : (
          <PluginCatalogState>
            {plugins.length ? `No plugins match “${query}”.` : "No plugin manifests found."}
          </PluginCatalogState>
        )}
      </section>
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
        <div className="space-y-5 px-6 py-5">
          <Alert variant="info">
            Observe mode starts this plugin locally and exposes only tools it declares read-only.
            Desktop actions stay blocked until Local Studio has an action-time approval prompt.
          </Alert>
          <p className="text-sm leading-6 text-(--ui-muted)">
            The bundle remains in its installed location. Disconnecting stops exposing its tools to
            Workbench sessions.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setPending(null)} disabled={Boolean(busyId)}>
              Cancel
            </Button>
            <Button
              onClick={() => pending && void setEnabled(pending, true)}
              disabled={!pending || Boolean(busyId)}
              loading={Boolean(busyId)}
            >
              Connect in observe mode
            </Button>
          </div>
        </div>
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
