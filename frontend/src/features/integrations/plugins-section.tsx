"use client";

import { useMemo, useState } from "react";
import type { PluginRuntimeView } from "@local-studio/agent-runtime/plugin-runtime";
import { Alert, Button, SearchInput, StatusPill, UiModal, UiModalHeader } from "@/ui";
import { Eye, X } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  SettingsButton,
  SettingsGroup,
  SettingsRow,
  SettingsValue,
  type StatusTone,
} from "@/features/settings/settings-ui";

type PluginStatus = { label: string; tone: StatusTone };

function capabilitySummary(plugin: PluginRuntimeView): string {
  return [
    plugin.provides.skills ? "skills" : null,
    plugin.provides.mcpServers
      ? `${plugin.tools.serverCount} MCP ${plugin.tools.serverCount === 1 ? "server" : "servers"}`
      : null,
    plugin.provides.apps ? "account app" : null,
    `v${plugin.version}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function pluginStatus(plugin: PluginRuntimeView): PluginStatus {
  if (plugin.tools.state === "enabled") {
    return {
      label: `Observe · ${plugin.tools.allowedToolCount} ${plugin.tools.allowedToolCount === 1 ? "tool" : "tools"}`,
      tone: "good",
    };
  }
  if (plugin.tools.state === "available") return { label: "Available", tone: "info" };
  if (plugin.tools.state === "disabled") return { label: "Off", tone: "default" };
  if (plugin.tools.state === "invalid") return { label: "Invalid manifest", tone: "danger" };
  if (plugin.tools.state === "configuration_required" || plugin.provides.apps) {
    return { label: "Adapter needed", tone: "warning" };
  }
  return { label: "Skills", tone: "default" };
}

function activationAction(plugin: PluginRuntimeView): "connect" | "disconnect" | null {
  if (plugin.tools.state === "enabled") return "disconnect";
  if (plugin.tools.state === "available" || plugin.tools.state === "disabled") return "connect";
  return null;
}

function PluginRowsSkeleton() {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <div key={index} className="grid animate-pulse gap-3 px-4 py-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="h-3 w-32 rounded bg-(--ui-hover)" />
            <div className="h-2.5 w-56 max-w-full rounded bg-(--ui-hover)/70" />
          </div>
          <div className="flex items-center justify-end gap-3">
            <div className="h-2.5 w-36 rounded bg-(--ui-hover)/70" />
            <div className="h-5 w-20 rounded-full bg-(--ui-hover)" />
          </div>
        </div>
      ))}
    </>
  );
}

function PluginRow({
  plugin,
  busy,
  onConnect,
  onDisconnect,
}: {
  plugin: PluginRuntimeView;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const status = pluginStatus(plugin);
  const action = activationAction(plugin);
  return (
    <SettingsRow
      label={plugin.displayName}
      description={plugin.description || plugin.category}
      value={<SettingsValue dim>{capabilitySummary(plugin)}</SettingsValue>}
      status={<StatusPill tone={status.tone}>{status.label}</StatusPill>}
      actions={
        action ? (
          <SettingsButton onClick={action === "connect" ? onConnect : onDisconnect} disabled={busy}>
            {busy ? "Working" : action === "connect" ? "Connect" : "Disconnect"}
          </SettingsButton>
        ) : undefined
      }
    >
      {plugin.tools.reason ? (
        <div className="text-[length:var(--fs-sm)] text-(--ui-muted)">{plugin.tools.reason}</div>
      ) : null}
    </SettingsRow>
  );
}

export function PluginsSection() {
  const [plugins, setPlugins] = useState<PluginRuntimeView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PluginRuntimeView | null>(null);

  useMountSubscription(() => {
    void fetch("/api/agent/plugins", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          plugins?: PluginRuntimeView[];
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Plugin discovery failed");
        setPlugins(payload.plugins ?? []);
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : "Plugin discovery failed");
      })
      .finally(() => setLoaded(true));
  }, []);

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
    setBusyId(plugin.id);
    setError("");
    try {
      const response = await fetch(`/api/agent/plugins/${encodeURIComponent(plugin.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = (await response.json()) as {
        plugins?: PluginRuntimeView[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Plugin activation failed");
      setPlugins(payload.plugins ?? []);
      setPending(null);
    } catch (activationError) {
      setError(
        activationError instanceof Error ? activationError.message : "Plugin activation failed",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="mb-4 space-y-3 px-4">
        <p className="max-w-3xl text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
          Codex-compatible bundles discovered locally. Skills are available immediately; executable
          tools require explicit permission.
        </p>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search plugins"
          className="max-w-md"
        />
      </div>
      {error ? (
        <div className="mb-4 px-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
      <SettingsGroup
        title="Plugins"
        actions={
          <StatusPill tone={error ? "warning" : loaded ? "good" : "default"}>
            {loaded ? `${visiblePlugins.length} of ${plugins.length}` : "discovering"}
          </StatusPill>
        }
      >
        {!loaded ? (
          <PluginRowsSkeleton />
        ) : visiblePlugins.length ? (
          visiblePlugins.map((plugin) => (
            <PluginRow
              key={plugin.id}
              plugin={plugin}
              busy={busyId === plugin.id}
              onConnect={() => setPending(plugin)}
              onDisconnect={() => void setEnabled(plugin, false)}
            />
          ))
        ) : (
          <div className="px-4 py-8 text-center text-[length:var(--fs-md)] text-(--ui-muted)">
            {plugins.length ? `No plugins match “${query}”.` : "No plugin manifests found."}
          </div>
        )}
      </SettingsGroup>
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
    </>
  );
}
