// Shared plugin types for the Codex plugin module. Pure types only — keep this
// file free of runtime imports so sources, policy, reconcile, and registry can
// all depend on it without creating import cycles (plugin-discovery.ts also
// re-exports PluginRow from here for back-compat).

export type PluginRow = {
  id: string;
  name: string;
  displayName?: string;
  version?: string;
  path: string;
  installed: boolean;
  enabled: boolean;
  description?: string;
  shortDescription?: string;
  source?: string;
  category?: string;
  capabilities?: string[];
  defaultPrompts?: string[];
  brandColor?: string;
  iconPath?: string;
  skillPath?: string;
  mcpConfigPath?: string;
  appConfigPath?: string;
  appIds?: string[];
  appPath?: string;
  instructions?: string;
  /**
   * How this plugin's runtime is launched. "standard" plugins are skill/MCP
   * only; "host-app" plugins need a bundled helper binary (e.g. computer-use's
   * SkyComputerUseClient) and are launch-constrained outside the Codex host.
   */
  launch?: "standard" | "host-app";
};

/**
 * Context handed to every plugin source. Asset sources read disk; the catalog
 * source uses `pluginEnabled` and `marketplaces` to reconcile live Codex state.
 * `cwds` is optional per-project scan roots; `maxDepth` bounds the dir walk.
 */
export type DiscoveryCtx = {
  home: string;
  dataDir: string;
  codexConfigPath: string;
  cwds?: string[];
  maxDepth: number;
  pluginEnabled: Map<string, boolean>;
  marketplaces: Array<{ name: string; source: string }>;
};

/**
 * A plugin source contributes rows to discovery. `kind: "assets"` sources read
 * the filesystem and own real paths (skillPath/mcpConfigPath/appPath).
 * `kind: "catalog"` sources overlay live enable/install state and must degrade
 * gracefully — `available()` is cheap/non-blocking and `list()` is best-effort.
 */
export interface PluginSource {
  id: string;
  kind: "assets" | "catalog";
  available?(ctx: DiscoveryCtx): boolean | Promise<boolean>;
  list(ctx: DiscoveryCtx): PluginRow[] | Promise<PluginRow[]>;
}
