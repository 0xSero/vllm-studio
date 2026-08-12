"use client";

import { useCallback, useState } from "react";
import { Schema } from "effect";
import {
  PluginRuntimeResponseSchema,
  type PluginRuntimeView,
} from "@local-studio/agent-runtime/plugin-runtime-contract";
import { Alert, Button, UiModal, UiModalHeader } from "@/ui";
import { Eye, X } from "lucide-react";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import {
  ResourceActions,
  ResourceList,
  ResourceRowsSkeleton,
  type ResourceAction,
} from "@/features/resources/resource-list";
import { ResourceLogo } from "@/ui/resource-logo";
import { useAsyncResource } from "@/hooks/use-async-resource";
import type { StatusTone } from "@/features/settings/settings-ui";
import { ModelStatus } from "@/features/recipes/recipes-content/model-page";
import { requestJson } from "@/lib/api/request-json";
import { GoogleAccountModal } from "./google-account-modal";
import { ChatterboxVoiceModal } from "./chatterbox-voice-modal";
import { speechStatusLabel, speechStatusTone } from "./chatterbox-voice-model";
import { useSpeechStore, type SpeechSnapshot } from "./chatterbox-voice-store";

type PluginStatus = { label: string; tone: StatusTone };

function capabilitySummary(plugin: PluginRuntimeView): string {
  if (plugin.hostCapability?.capability === "speech") {
    return `local speech · voice cloning · v${plugin.version}`;
  }
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

function pluginStatus(plugin: PluginRuntimeView, speech: SpeechSnapshot): PluginStatus {
  if (plugin.hostCapability?.capability === "speech") {
    if (!speech.available && !speech.loading) return { label: "Unavailable", tone: "danger" };
    if (speech.status) {
      return {
        label: speechStatusLabel(speech.status),
        tone: speechStatusTone(speech.status),
      };
    }
    if (speech.loading) return { label: "Checking", tone: "default" };
    return { label: speech.error ? "Unavailable" : "Configure", tone: "warning" };
  }
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
  if (plugin.hostCapability) return null;
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

function pluginActions({
  plugin,
  action,
  busy,
  hostActionLabel,
  onConnect,
  onDisconnect,
  onAccount,
  onHostCapability,
}: {
  plugin: PluginRuntimeView;
  action: PluginRowAction;
  busy: boolean;
  hostActionLabel: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onAccount: () => void;
  onHostCapability: () => void;
}): ResourceAction[] {
  const actionLabel = action ? pluginActionLabel(plugin, action) : "";
  const actions: Array<ResourceAction | null> = [
    plugin.hostCapability
      ? {
          key: "host",
          label: hostActionLabel,
          onClick: onHostCapability,
          disabled: busy,
          "aria-label": `${hostActionLabel} ${plugin.displayName}`,
        }
      : null,
    plugin.account?.connected
      ? {
          key: "account",
          label: "Manage",
          onClick: onAccount,
          disabled: busy,
          "aria-label": `Manage ${plugin.displayName}`,
        }
      : null,
    action
      ? {
          key: action,
          label: busy ? "Working" : actionLabel,
          onClick:
            action === "account" ? onAccount : action === "connect" ? onConnect : onDisconnect,
          disabled: busy,
          "aria-label": `${actionLabel} ${plugin.displayName}`,
        }
      : null,
  ];
  return actions.filter((item): item is ResourceAction => item !== null);
}

function PluginDrawer({
  plugin,
  speech,
  actions,
  onClose,
}: {
  plugin: PluginRuntimeView;
  speech: SpeechSnapshot;
  actions: readonly ResourceAction[];
  onClose: () => void;
}) {
  const status = pluginStatus(plugin, speech);
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
      footer={actions.length ? <ResourceActions actions={actions} /> : null}
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
  const speech = useSpeechStore();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PluginRuntimeView | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginRuntimeView | null>(null);
  const [accountPlugin, setAccountPlugin] = useState<PluginRuntimeView | null>(null);
  const [speechPlugin, setSpeechPlugin] = useState<PluginRuntimeView | null>(null);
  const loadPlugins = useCallback(
    async () =>
      (
        await requestJson(
          "/api/agent/plugins",
          Schema.decodeUnknownSync(PluginRuntimeResponseSchema),
          { cache: "no-store" },
          "Plugin discovery failed",
        )
      ).plugins,
    [],
  );
  const {
    data: plugins,
    setData: setPlugins,
    loaded,
    error,
    setError,
    refresh,
    invalidate,
  } = useAsyncResource(loadPlugins, [] as readonly PluginRuntimeView[], "Plugin discovery failed");

  const handleAccountChanged = useCallback(() => {
    void refresh();
  }, [refresh]);

  const setEnabled = async (plugin: PluginRuntimeView, enabled: boolean) => {
    invalidate();
    setBusyId(plugin.id);
    setError("");
    try {
      const payload = await requestJson(
        `/api/agent/plugins/${encodeURIComponent(plugin.id)}`,
        Schema.decodeUnknownSync(PluginRuntimeResponseSchema),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
        "Plugin activation failed",
      );
      setPlugins(payload.plugins);
      setPending(null);
    } catch (activationError) {
      setError(
        activationError instanceof Error ? activationError.message : "Plugin activation failed",
      );
    } finally {
      setBusyId((current) => (current === plugin.id ? null : current));
    }
  };

  const actionsFor = (plugin: PluginRuntimeView) => {
    const closeAnd = (next: () => void) => () => {
      setSelectedPlugin(null);
      next();
    };
    return pluginActions({
      plugin,
      action: activationAction(plugin),
      busy: busyId === plugin.id,
      hostActionLabel: speech.status?.install.phase === "ready" ? "Manage" : "Configure",
      onConnect: closeAnd(() => setPending(plugin)),
      onDisconnect: closeAnd(() => void setEnabled(plugin, false)),
      onAccount: closeAnd(() => setAccountPlugin(plugin)),
      onHostCapability: closeAnd(() => setSpeechPlugin(plugin)),
    });
  };

  return (
    <>
      {error ? (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
      <ResourceList
        title="Plugins"
        description="Capability bundles from Local Studio and Codex, with their company, tools, accounts, and skills."
        items={plugins}
        loaded={loaded}
        searchLabel="Search plugins"
        searchDescription="Name, company, category, capability, or version."
        searchPlaceholder="Search plugins"
        searchableText={(plugin) =>
          `${plugin.displayName} ${plugin.description} ${plugin.category} ${capabilitySummary(plugin)}`
        }
        summaryTone={() => (error ? "warning" : loaded ? "good" : "default")}
        loading={<ResourceRowsSkeleton />}
        empty={(query, total) =>
          total ? `No plugins match “${query}”.` : "No plugin manifests found."
        }
        row={(plugin) => {
          const status = pluginStatus(plugin, speech);
          const actions = actionsFor(plugin);
          return {
            key: plugin.id,
            label: plugin.displayName,
            company: plugin.source,
            brandColor: plugin.brandColor,
            description: plugin.description || plugin.category,
            value: `${plugin.source} · ${capabilitySummary(plugin)}`,
            status: status.label,
            statusTone: status.tone,
            actions: actions.length ? <ResourceActions actions={actions} /> : undefined,
            children:
              plugin.tools.reason || plugin.account?.email ? (
                <>
                  {plugin.tools.reason ? (
                    <div className="text-[length:var(--fs-sm)] text-(--ui-muted)">
                      {plugin.tools.reason}
                    </div>
                  ) : null}
                  {plugin.account?.email ? (
                    <div className="text-[length:var(--fs-sm)] text-(--ui-muted)">
                      {plugin.account.email}
                    </div>
                  ) : null}
                </>
              ) : undefined,
            onOpen: () => setSelectedPlugin(plugin),
          };
        }}
      />
      {selectedPlugin ? (
        <PluginDrawer
          plugin={selectedPlugin}
          speech={speech}
          actions={actionsFor(selectedPlugin)}
          onClose={() => setSelectedPlugin(null)}
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
      {speechPlugin?.hostCapability?.capability === "speech" ? (
        <ChatterboxVoiceModal key={speech.controllerKey} onClose={() => setSpeechPlugin(null)} />
      ) : null}
    </>
  );
}
