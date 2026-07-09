"use client";

import { useState } from "react";
import type { PluginView } from "@local-studio/agent-runtime/plugin-discovery";
import { StatusPill } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  SettingsFactRows,
  SettingsGroup,
  type SettingsFactRow,
} from "@/features/settings/settings-ui";

function pluginCapabilities(plugin: PluginView): string {
  return [
    plugin.provides.skills ? "skills" : null,
    plugin.provides.mcpServers ? "MCP manifest" : null,
    plugin.provides.apps ? "account app" : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
}

function pluginStatus(plugin: PluginView): SettingsFactRow["status"] {
  if (plugin.provides.apps) return { label: "adapter needed", tone: "warning" };
  if (plugin.provides.mcpServers) return { label: "MCP manifest", tone: "info" };
  return { label: "skills ready", tone: "good" };
}

export function PluginsSection() {
  const [plugins, setPlugins] = useState<PluginView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useMountSubscription(() => {
    void fetch("/api/agent/plugins", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as { plugins?: PluginView[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "Plugin discovery failed");
        setPlugins(payload.plugins ?? []);
      })
      .catch((loadError: unknown) => {
        setPlugins([]);
        setError(loadError instanceof Error ? loadError.message : "Plugin discovery failed");
      })
      .finally(() => setLoaded(true));
  }, []);

  const rows: SettingsFactRow[] = error
    ? [
        {
          label: "Plugin discovery",
          description: error,
          value: "Unavailable",
          status: { label: "error", tone: "warning" },
        },
      ]
    : plugins.map((plugin) => ({
        key: plugin.id,
        label: plugin.displayName,
        description: plugin.description || plugin.category,
        value: `${plugin.version} · ${plugin.source}`,
        mono: true,
        status: pluginStatus(plugin),
        children: (
          <div className="text-[length:var(--fs-md)] text-(--dim)/65">
            {pluginCapabilities(plugin)}
          </div>
        ),
      }));

  return (
    <SettingsGroup
      title="Plugins"
      description="Codex-compatible bundles discovered from Local Studio and Codex. Skills are usable now; MCP and account apps remain isolated until their local runtime adapter is configured."
      actions={
        <StatusPill tone={error ? "warning" : loaded ? "good" : "default"}>
          {loaded ? `${plugins.length} plugins` : "discovering"}
        </StatusPill>
      }
    >
      {!loaded ? (
        <div className="px-4 py-3.5 text-[length:var(--fs-md)] text-(--dim)">
          Discovering plugin manifests…
        </div>
      ) : rows.length ? (
        <SettingsFactRows rows={rows} />
      ) : (
        <div className="px-4 py-3.5 text-[length:var(--fs-md)] text-(--dim)">
          No plugin manifests found.
        </div>
      )}
    </SettingsGroup>
  );
}
