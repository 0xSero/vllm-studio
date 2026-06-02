import { homedir } from "node:os";
import path from "node:path";
import {
  type CodexConfig,
  type PluginDiscoveryState,
  collectPluginRows,
} from "../internal";
import type { DiscoveryCtx, PluginRow, PluginSource } from "../types";

/**
 * Asset source for marketplace plugins. Reproduces today's curated discovery
 * for ALL marketplaces (openai-curated, openai-bundled, personal, …) by walking
 * each marketplace `source` dir plus the shared `~/.codex/plugins` cache tree.
 *
 * It reuses the SHARED dir-walk + manifest/row helpers from `../internal`
 * (`collectPluginRows` → `hasPluginMarker` → `pluginRowFromDirectory` →
 * `marketplaceFromPath`), so behavior matches the old `discoverPlugins` EXCEPT
 * the blunt `openai-` filter, which `applyPolicy` now owns downstream.
 *
 * Fully synchronous — this is the workhorse asset source.
 */
export const marketplaceCacheSource: PluginSource = {
  id: "marketplace-cache",
  kind: "assets",
  list(ctx: DiscoveryCtx): PluginRow[] {
    const codexConfig: CodexConfig = {
      marketplaces: ctx.marketplaces,
      pluginEnabled: ctx.pluginEnabled,
    };
    const state: PluginDiscoveryState = {
      codexConfig,
      maxDepth: ctx.maxDepth,
      rows: [],
      seen: new Set<string>(),
    };
    // Single shared `seen` set across roots so overlapping trees (e.g. a
    // marketplace `source` that also nests under ~/.codex/plugins) walk once.
    for (const root of marketplaceRoots(ctx)) collectPluginRows(root, 0, state);
    return state.rows;
  },
};

/**
 * Scan roots for marketplace plugins: every marketplace `source` (and its
 * conventional `<source>/plugins` subdir) plus `<home>/.codex/plugins`, whose
 * `cache/<marketplace>/<plugin>/<hash>` tree the recursive walk descends into.
 * Mirrors the old `defaultPluginRoots()` expansion; deduped by resolved path.
 */
function marketplaceRoots(ctx: DiscoveryCtx): string[] {
  const home = ctx.home || homedir();
  return uniquePaths([
    ...ctx.marketplaces.flatMap((marketplace) => [
      marketplace.source,
      path.join(marketplace.source, "plugins"),
    ]),
    path.join(home, ".codex", "plugins"),
  ]);
}

function uniquePaths(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  return values.filter((value): value is string => {
    if (!value || seen.has(path.resolve(value))) return false;
    seen.add(path.resolve(value));
    return true;
  });
}
