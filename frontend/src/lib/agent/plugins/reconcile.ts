// Left-join the live Codex app-server catalog onto disk-derived asset rows.
// Asset (filesystem) rows own the real resource paths; the catalog overlay
// supplies live install/enable state and OpenAI-identical metadata. Pure
// function, no IO — the catalog has already been fetched (best-effort) by the
// app-server source before it reaches here.

import { pluginConfigKey } from "../plugin-config";
import type { PluginRow } from "./types";

const RESERVED_ASSET_PATH_KEYS = [
  "appConfigPath",
  "appIds",
  "appPath",
  "iconPath",
  "mcpConfigPath",
  "skillPath",
] as const satisfies ReadonlyArray<keyof PluginRow>;

/**
 * Reconcile asset rows with catalog rows. For each asset row we overlay live
 * catalog state (installed/enabled) and backfill descriptive metadata the asset
 * is missing (source, displayName, description, brandColor). Asset-derived paths
 * (path, skillPath, mcpConfigPath, appConfigPath, appPath, iconPath) ALWAYS win.
 * Catalog-only rows (no matching asset) are appended with installed:false and no
 * skill/mcp/app paths, so they remain visible without claiming on-disk assets.
 */
export function reconcile(assetRows: PluginRow[], catalogRows: PluginRow[]): PluginRow[] {
  const catalog = indexByKey(catalogRows);
  const consumed = new Set<string>();

  const merged = assetRows.map((asset) => {
    const key = rowKey(asset);
    const match = catalog.get(key);
    if (!match) return asset;
    consumed.add(key);
    return mergeAssetWithCatalog(asset, match);
  });

  const catalogOnly: PluginRow[] = [];
  for (const [key, row] of catalog) {
    if (consumed.has(key)) continue;
    catalogOnly.push(catalogOnlyRow(row));
  }

  return [...merged, ...catalogOnly];
}

function indexByKey(rows: PluginRow[]): Map<string, PluginRow> {
  const map = new Map<string, PluginRow>();
  for (const row of rows) {
    // First catalog row wins on key collisions; the catalog is already a
    // deduped per-marketplace listing, so collisions are not expected.
    if (!map.has(rowKey(row))) map.set(rowKey(row), row);
  }
  return map;
}

function rowKey(row: PluginRow): string {
  return pluginConfigKey(row.name.toLowerCase(), row.source);
}

function mergeAssetWithCatalog(asset: PluginRow, catalog: PluginRow): PluginRow {
  // Disk presence is ground truth for `installed`: a plugin physically on disk
  // is runnable even when the Codex catalog hasn't flagged it installed (e.g.
  // app-bundled plugins), so `installed` is the OR — the catalog may never
  // downgrade a real on-disk row. `enabled` takes the catalog value (applyPolicy
  // then re-resolves it against config.toml, gated on `installed`). Descriptive
  // fields backfill only where the asset has nothing.
  return {
    ...asset,
    installed: asset.installed || catalog.installed,
    enabled: catalog.enabled,
    ...(asset.source ? {} : catalog.source ? { source: catalog.source } : {}),
    ...(asset.displayName ? {} : catalog.displayName ? { displayName: catalog.displayName } : {}),
    ...(asset.description ? {} : catalog.description ? { description: catalog.description } : {}),
    ...(asset.brandColor ? {} : catalog.brandColor ? { brandColor: catalog.brandColor } : {}),
  };
}

function catalogOnlyRow(row: PluginRow): PluginRow {
  // No on-disk assets back this row: keep its metadata but drop every path that
  // would imply local resources, and mark it not installed.
  const next: PluginRow = { ...row, installed: false };
  for (const key of RESERVED_ASSET_PATH_KEYS) delete next[key];
  return next;
}
