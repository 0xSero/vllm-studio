// Plugin source registry + discovery orchestration. This is the single place
// that wires the asset sources (disk = source of truth) and the catalog source
// (live Codex app-server overlay) together. `discoverPluginsSync` is the
// disk-only, fully-synchronous back-compat replacement for the old
// `discoverPlugins`; `discoverPluginsAsync` adds the best-effort catalog
// overlay and reconciliation. Neither ever throws on a missing/unreachable
// source — the plugins list always works disk-only.

import { homedir } from "node:os";
import { resolveDataDir } from "@/lib/data-dir";
import { defaultCodexConfigPath } from "../plugin-config";
import {
  collectPluginRows,
  dedupePluginRows,
  includesDefaultPluginRoot,
  knownLocalPluginRows,
  readCodexConfig,
  sortPluginRows,
} from "./internal";
import { applyPolicy } from "./policy";
import { reconcile } from "./reconcile";
import { appServerSource } from "./sources/app-server";
import { bundledSource } from "./sources/bundled";
import { localHelpersSource } from "./sources/local-helpers";
import { marketplaceCacheSource } from "./sources/marketplace-cache";
import type { DiscoveryCtx, PluginRow, PluginSource } from "./types";

const DEFAULT_MAX_DEPTH = 8;

// Asset sources run first (they own real paths); the catalog source overlays
// live enable/install state last. Order also seeds dedupe preference.
export const SOURCES: PluginSource[] = [
  marketplaceCacheSource,
  bundledSource,
  localHelpersSource,
  appServerSource,
];

/**
 * Disk-only, synchronous discovery. Drop-in replacement for the legacy
 * `discoverPlugins(roots?, options?)` — same signature and return shape. When
 * explicit `roots` are passed (e.g. `loadPluginInstructions`), it walks exactly
 * those roots; otherwise it runs every registered `kind: "assets"` source.
 */
export function discoverPluginsSync(
  roots?: string[],
  options: { configPath?: string; maxDepth?: number } = {},
): PluginRow[] {
  const ctx = buildDiscoveryCtx({
    codexConfigPath: options.configPath,
    maxDepth: options.maxDepth,
    cwds: roots,
  });
  const rows = roots ? scanRoots(roots, ctx) : runAssetSources(ctx);
  return finalizeRows(rows, ctx);
}

/**
 * Hybrid discovery: disk asset rows plus a best-effort catalog overlay. Runs
 * the asset sources synchronously, then queries each `kind: "catalog"` source
 * guarded by `available()` + try/catch (degrades to disk-only on any failure),
 * reconciles catalog metadata onto the asset rows, and applies policy/sort.
 * Never throws.
 */
export async function discoverPluginsAsync(
  partial?: Partial<DiscoveryCtx>,
): Promise<PluginRow[]> {
  const ctx = buildDiscoveryCtx(partial);
  const assetRows = ctx.cwds ? scanRoots(ctx.cwds, ctx) : runAssetSources(ctx);
  const catalogRows = await collectCatalogRows(ctx);
  const merged = catalogRows.length ? reconcile(assetRows, catalogRows) : assetRows;
  return finalizeRows(merged, ctx);
}

function runAssetSources(ctx: DiscoveryCtx): PluginRow[] {
  const rows: PluginRow[] = [];
  for (const source of SOURCES) {
    if (source.kind !== "assets") continue;
    rows.push(...(source.list(ctx) as PluginRow[]));
  }
  return rows;
}

async function collectCatalogRows(ctx: DiscoveryCtx): Promise<PluginRow[]> {
  const rows: PluginRow[] = [];
  for (const source of SOURCES) {
    if (source.kind !== "catalog") continue;
    try {
      if (source.available && !(await source.available(ctx))) continue;
      rows.push(...(await source.list(ctx)));
    } catch {
      // Catalog overlay is best-effort; disk rows already carry the assets.
    }
  }
  return rows;
}

// Legacy direct walk: scan exactly the supplied roots, then add the local
// computer-use helper rows when a default plugin root is present. Mirrors the
// old `discoverPluginRows` so `loadPluginInstructions([resolved], maxDepth:1)`
// keeps resolving a single plugin directory.
function scanRoots(roots: string[], ctx: DiscoveryCtx): PluginRow[] {
  const codexConfig = { marketplaces: ctx.marketplaces, pluginEnabled: ctx.pluginEnabled };
  const rows: PluginRow[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    collectPluginRows(root, 0, { codexConfig, maxDepth: ctx.maxDepth, rows, seen });
  }
  if (includesDefaultPluginRoot(roots)) rows.push(...knownLocalPluginRows());
  return rows;
}

// Shared tail for every discovery path: dedupe → policy (default show-all,
// resolves `enabled` from ctx.pluginEnabled) → sort. Replaces the old
// `sortPluginRows(dedupePluginRows(rows).filter(!isOpenAiPluginRow))` — the
// blunt openai- filter is gone; visibility is now policy.ts's job.
function finalizeRows(rows: PluginRow[], ctx: DiscoveryCtx): PluginRow[] {
  return sortPluginRows(applyPolicy(dedupePluginRows(rows), ctx));
}

function buildDiscoveryCtx(partial?: Partial<DiscoveryCtx>): DiscoveryCtx {
  const home = partial?.home ?? homedir();
  const dataDir = partial?.dataDir ?? resolveDataDir();
  const codexConfigPath = partial?.codexConfigPath ?? defaultCodexConfigPath();
  const config = readCodexConfig(codexConfigPath);
  return {
    home,
    dataDir,
    codexConfigPath,
    ...(partial?.cwds ? { cwds: partial.cwds } : {}),
    maxDepth: partial?.maxDepth ?? DEFAULT_MAX_DEPTH,
    pluginEnabled: partial?.pluginEnabled ?? config.pluginEnabled,
    marketplaces: partial?.marketplaces ?? config.marketplaces,
  };
}
