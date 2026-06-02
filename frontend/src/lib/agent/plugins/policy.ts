// Per-source plugin policy. Replaces the old blunt `isOpenAiPluginRow` filter
// from plugin-discovery.ts with a data-driven pass that, by DEFAULT, shows
// EVERY plugin — including the openai-* sources (curated, bundled,
// primary-runtime) and the local computer-use helper. The only other job here
// is to (idempotently) resolve each row's `enabled` flag from the live Codex
// config so disk rows and catalog rows agree on enable state.
//
// Keep this file pure and tiny: no fs/network, no side effects.

import { pluginConfigKey } from "../plugin-config";
import type { DiscoveryCtx, PluginRow } from "./types";

/**
 * Sources to hide outright, by `row.source` (lowercased). This is the single
 * hide-hook: adding `"some-source"` here removes every row from that source in
 * one line. Intentionally EMPTY — the default is to show everything, matching
 * OpenAI's own setup where all installed plugins are listed.
 */
const HIDDEN_SOURCES: ReadonlySet<string> = new Set<string>();

/**
 * Apply visibility + enable policy to discovered rows.
 *
 * Visibility: drop rows whose source is in {@link HIDDEN_SOURCES} (empty by
 * default, so nothing is hidden). The old `openai-` prefix filter is gone.
 *
 * Enable: re-resolve `enabled` from `ctx.pluginEnabled` keyed by
 * `pluginConfigKey(name, source)`. Mirrors `pluginRowFromDirectory` for installed
 * rows — consult the map when a `source` is present, default to `true` when the
 * source/key is absent (readCodexConfig marks a plugin enabled the moment a
 * `[plugins."X"]` header exists, and false only on explicit `enabled = false`).
 * A not-installed catalog-only row is always `false`. Idempotent: a row already
 * carrying the resolved flag is returned unchanged.
 */
export function applyPolicy(rows: PluginRow[], ctx: DiscoveryCtx): PluginRow[] {
  const result: PluginRow[] = [];
  for (const row of rows) {
    if (isHidden(row)) continue;
    const enabled = resolveEnabled(row, ctx.pluginEnabled);
    result.push(enabled === row.enabled ? row : { ...row, enabled });
  }
  return result;
}

function isHidden(row: PluginRow): boolean {
  const source = row.source?.toLowerCase();
  return source ? HIDDEN_SOURCES.has(source) : false;
}

// A not-installed row is a browse-only marketplace catalog entry with no on-disk
// assets — it is never "enabled", otherwise the full curated marketplace (100s of
// uninstalled plugins) would flood the composer @-picker and active list. For
// installed rows this mirrors plugin-discovery.ts's original shape:
// `(source ? map.get(key) : undefined) ?? true`.
function resolveEnabled(row: PluginRow, pluginEnabled: Map<string, boolean>): boolean {
  if (!row.installed) return false;
  const fromConfig = row.source
    ? pluginEnabled.get(pluginConfigKey(row.name, row.source))
    : undefined;
  return fromConfig ?? true;
}
