import { useCallback, useState, useSyncExternalStore } from "react";
import {
  EmptySafeNotice,
  SettingsButton,
  SettingsGroup,
  SettingsInput,
  SettingsRow,
  SettingsValue,
  StatusPill,
} from "@/ui";
import { getConfigsViewSnapshot } from "./configs-view-snapshot";

type Plugin = {
  id: string;
  name: string;
  source?: string;
  path: string;
  installed: boolean;
  enabled: boolean;
  description?: string;
  appIds?: string[];
  skillPath?: string;
  mcpConfigPath?: string;
  launch?: "standard" | "host-app";
};
type PluginRuntimeCheck = {
  skillConfigured?: boolean;
  mcpConfigured?: boolean;
  appConfigured?: boolean;
  mcpExecutableExists?: boolean;
  runtimeBlockedOutsideCodex?: boolean;
  runtimeCheckRequired?: boolean;
  note?: string;
};
type PluginValidation = {
  browserUseAvailable?: boolean;
  browserUseRuntime?: PluginRuntimeCheck | null;
  computerUseAvailable?: boolean;
  computerUseRuntime?: PluginRuntimeCheck | null;
};
type Marketplace = { name: string; source?: string; sourceType?: string; lastUpdated?: string };
type PluginsPayload = {
  plugins?: Plugin[];
  marketplaces?: Marketplace[];
  validation?: PluginValidation;
};

const BROWSER_TOOL_PLUGINS = ["browser", "chrome"] as const;

function nameIncludes(plugin: Plugin, needle: string): boolean {
  return plugin.name.toLowerCase().includes(needle);
}

export function PluginsSettings() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [marketplaceSource, setMarketplaceSource] = useState("");
  const [validation, setValidation] = useState<PluginValidation | null>(null);
  const [savingPlugin, setSavingPlugin] = useState<string | null>(null);
  const [upgradingMarketplace, setUpgradingMarketplace] = useState<string | null>(null);

  // `browser`/`chrome` are fulfilled by vLLM Studio's own browser tooling, so
  // they get dedicated rows; `computer-use` keeps its MCP runtime check.
  const browser = plugins.find((plugin) => nameIncludes(plugin, "browser")) ?? null;
  const chrome = plugins.find((plugin) => nameIncludes(plugin, "chrome")) ?? null;
  const computerUse = plugins.find((plugin) => nameIncludes(plugin, "computer-use")) ?? null;
  const installedCount = plugins.filter((plugin) => plugin.installed).length;

  const applyPayload = (payload: PluginsPayload) => {
    setPlugins(payload.plugins ?? []);
    setMarketplaces(payload.marketplaces ?? []);
    setValidation(payload.validation ?? null);
  };
  const loadPlugins = () =>
    fetch("/api/agent/plugins?includeDisabled=1", { cache: "no-store" })
      .then((res) => res.json() as Promise<PluginsPayload>)
      .then(applyPayload)
      .catch(() => {
        setPlugins([]);
        setMarketplaces([]);
        setValidation({ browserUseAvailable: false, computerUseAvailable: false });
      });
  const subscribePlugins = useCallback((_notify: () => void) => {
    void loadPlugins();
    return () => {};
  }, []);

  useSyncExternalStore(subscribePlugins, getConfigsViewSnapshot, getConfigsViewSnapshot);

  const postPlugins = (body: unknown, busyKey: { plugin?: string; marketplace?: string }) => {
    if (busyKey.plugin) setSavingPlugin(busyKey.plugin);
    if (busyKey.marketplace) setUpgradingMarketplace(busyKey.marketplace);
    void fetch("/api/agent/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => res.json() as Promise<PluginsPayload>)
      .then(applyPayload)
      .catch(() => void loadPlugins())
      .finally(() => {
        if (busyKey.plugin) setSavingPlugin(null);
        if (busyKey.marketplace) setUpgradingMarketplace(null);
      });
  };
  const setPluginEnabled = (plugin: Plugin, enabled: boolean) =>
    postPlugins({ name: plugin.name, source: plugin.source, enabled }, { plugin: plugin.id });
  const upgradeMarketplace = (marketplace?: Marketplace) =>
    postPlugins(
      { action: "upgrade_marketplace", name: marketplace?.name },
      { marketplace: marketplace?.name ?? "all" },
    );
  const addMarketplace = () => {
    const source = marketplaceSource.trim();
    if (!source) return;
    void fetch("/api/agent/plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add_marketplace", source }),
    })
      .then((res) => res.json() as Promise<PluginsPayload>)
      .then((payload) => {
        applyPayload(payload);
        setMarketplaceSource("");
      })
      .catch(() => void loadPlugins())
      .finally(() => setUpgradingMarketplace(null));
  };

  const registryPlugins = plugins.filter(
    (plugin) =>
      !nameIncludes(plugin, "browser") &&
      !nameIncludes(plugin, "chrome") &&
      !nameIncludes(plugin, "computer-use"),
  );

  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Plugin marketplaces"
        description="Uses Codex marketplace metadata and the Codex CLI upgrade path instead of a vLLM-specific plugin registry."
        actions={
          <SettingsButton onClick={() => upgradeMarketplace()} disabled={upgradingMarketplace === "all"}>
            Upgrade all
          </SettingsButton>
        }
      >
        {marketplaces.length ? (
          marketplaces.map((marketplace) => (
            <SettingsRow
              key={marketplace.name}
              label={marketplace.name}
              description={marketplace.source ?? "No source reported"}
              value={
                <SettingsValue>
                  {marketplace.sourceType ?? "source"} · {marketplace.lastUpdated ?? "never"}
                </SettingsValue>
              }
              actions={
                <SettingsButton
                  onClick={() => upgradeMarketplace(marketplace)}
                  disabled={upgradingMarketplace === marketplace.name}
                >
                  Upgrade
                </SettingsButton>
              }
            />
          ))
        ) : (
          <EmptySafeNotice>No Codex plugin marketplaces found in config.</EmptySafeNotice>
        )}
        <SettingsRow
          label="Add marketplace"
          description="Accepts the same source syntax as Codex: owner/repo[@ref], Git URL, SSH URL, or a local marketplace root."
          control={
            <SettingsInput
              value={marketplaceSource}
              onChange={setMarketplaceSource}
              placeholder="owner/repo[@ref] or /path/to/marketplace"
            />
          }
          actions={
            <SettingsButton
              onClick={addMarketplace}
              disabled={!marketplaceSource.trim() || upgradingMarketplace === "add"}
            >
              Add
            </SettingsButton>
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Browser & desktop control"
        description="@browser and @chrome are routed through vLLM Studio's own browser tooling (navigate, click, type, screenshot); @computer-use drives the local Codex helper over MCP."
        actions={
          <StatusPill tone={browser?.enabled || chrome?.enabled || computerUse?.enabled ? "good" : "default"}>
            {[browser, chrome, computerUse].filter((row) => row?.enabled).length} active
          </StatusPill>
        }
      >
        <SettingsRow
          label="Browser"
          description="@browser drives a web browser for local/dev pages. Fulfilled by vLLM Studio's browser tool."
          value={<SettingsValue>{browserToolText(browser)}</SettingsValue>}
          status={<BrowserToolPill plugin={browser} />}
        />
        <SettingsRow
          label="Chrome"
          description="@chrome targets real Chrome tabs, cookies and profiles. Routed through vLLM Studio's browser tool; the Codex Chrome-extension native-host bridge (which targets Codex, not this app) is not used."
          value={<SettingsValue>{browserToolText(chrome)}</SettingsValue>}
          status={<BrowserToolPill plugin={chrome} />}
        />
        <SettingsRow
          label="Computer-use"
          description="Local Codex computer-use helper (SkyComputerUseClient) wired over MCP for desktop control."
          value={
            <SettingsValue>
              {pluginAvailabilityText(computerUse, validation?.computerUseRuntime)}
            </SettingsValue>
          }
          status={
            <PluginAvailabilityPill
              plugin={computerUse}
              available={validation?.computerUseAvailable}
              runtime={validation?.computerUseRuntime}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Plugin registry"
        description="Every Codex plugin discovered from the local cache, bundled Codex.app set, and the live app-server marketplace. Enabled plugins are selectable in the composer; not-installed ones can be installed from their marketplace."
        actions={
          <StatusPill tone={installedCount ? "good" : "warning"}>
            {installedCount} installed · {plugins.length} total
          </StatusPill>
        }
      >
        {registryPlugins.length ? (
          registryPlugins.slice(0, 60).map((plugin) => (
            <SettingsRow
              key={plugin.path}
              label={plugin.name}
              description={pluginDescription(plugin)}
              value={<SettingsValue mono>{pluginLocation(plugin)}</SettingsValue>}
              status={<PluginCapabilityPill plugin={plugin} />}
              actions={
                plugin.installed ? (
                  <SettingsButton
                    onClick={() => setPluginEnabled(plugin, !plugin.enabled)}
                    disabled={savingPlugin === plugin.id}
                  >
                    {plugin.enabled ? "Disable" : "Enable"}
                  </SettingsButton>
                ) : undefined
              }
            />
          ))
        ) : (
          <EmptySafeNotice>No Codex plugins discovered.</EmptySafeNotice>
        )}
        {registryPlugins.length > 60 ? (
          <SettingsRow
            label="…and more"
            description={`${registryPlugins.length - 60} additional marketplace plugins not shown.`}
          />
        ) : null}
      </SettingsGroup>
    </div>
  );
}

function browserToolText(plugin: { enabled: boolean } | null): string {
  if (!plugin) return "Not discovered";
  if (!plugin.enabled) return "Discovered but disabled in Codex plugin config";
  return "Selectable — routes to vLLM Studio's browser tool";
}

function BrowserToolPill({ plugin }: { plugin: { enabled: boolean } | null }) {
  if (!plugin) return <StatusPill tone="default">not found</StatusPill>;
  if (!plugin.enabled) return <StatusPill tone="default">disabled</StatusPill>;
  return <StatusPill tone="good">browser tool</StatusPill>;
}

function PluginCapabilityPill({
  plugin,
}: {
  plugin: {
    installed: boolean;
    enabled: boolean;
    launch?: "standard" | "host-app";
    mcpConfigPath?: string;
    skillPath?: string;
  };
}) {
  if (!plugin.installed) return <StatusPill tone="default">available</StatusPill>;
  const tone = plugin.enabled ? "good" : "default";
  if (plugin.launch === "host-app" || plugin.mcpConfigPath) {
    return <StatusPill tone={plugin.enabled ? "info" : "default"}>mcp</StatusPill>;
  }
  if (plugin.skillPath) return <StatusPill tone={tone}>skill</StatusPill>;
  return <StatusPill tone={tone}>{plugin.enabled ? "enabled" : "installed"}</StatusPill>;
}

function pluginAvailabilityText(
  plugin: { enabled: boolean } | null,
  runtime?: {
    mcpConfigured?: boolean;
    mcpExecutableExists?: boolean;
    runtimeBlockedOutsideCodex?: boolean;
    runtimeCheckRequired?: boolean;
    note?: string;
  } | null,
): string {
  if (!plugin) return "Not discovered";
  if (!plugin.enabled) return "Discovered but disabled in Codex plugin config";
  if (runtime?.mcpConfigured && runtime.mcpExecutableExists === false) {
    return "Selectable, but its MCP command is missing";
  }
  if (runtime?.runtimeBlockedOutsideCodex) return runtime.note ?? "Runtime blocked outside Codex";
  return runtime?.note ?? "Available and selectable in the composer";
}

function PluginAvailabilityPill({
  plugin,
  available,
  runtime,
}: {
  plugin: { enabled: boolean } | null;
  available?: boolean;
  runtime?: {
    mcpConfigured?: boolean;
    mcpExecutableExists?: boolean;
    runtimeBlockedOutsideCodex?: boolean;
    runtimeCheckRequired?: boolean;
  } | null;
}) {
  if (!plugin) return <StatusPill tone="warning">missing</StatusPill>;
  if (!plugin.enabled || !available) return <StatusPill tone="default">disabled</StatusPill>;
  if (runtime?.mcpConfigured && runtime.mcpExecutableExists === false) {
    return <StatusPill tone="warning">mcp missing</StatusPill>;
  }
  if (runtime?.runtimeBlockedOutsideCodex) return <StatusPill tone="warning">blocked</StatusPill>;
  if (runtime?.runtimeCheckRequired) return <StatusPill tone="info">runtime check</StatusPill>;
  if (runtime?.mcpConfigured) return <StatusPill tone="info">mcp wired</StatusPill>;
  return <StatusPill tone="good">selectable</StatusPill>;
}

function pluginDescription(plugin: { appIds?: string[]; description?: string; path: string }): string {
  const summary = plugin.description?.replace(/\s+/g, " ").trim();
  const short = summary && summary.length > 150 ? `${summary.slice(0, 147)}…` : summary;
  const connectors = plugin.appIds?.length ? `Connectors: ${plugin.appIds.join(", ")}` : "";
  return [short, connectors].filter(Boolean).join(" · ") || "Codex plugin bundle";
}

function pluginLocation(plugin: { enabled: boolean; source?: string; path: string }): string {
  return `${plugin.enabled ? "enabled" : "disabled"} · ${plugin.source ?? "local"} · ${plugin.path}`;
}
