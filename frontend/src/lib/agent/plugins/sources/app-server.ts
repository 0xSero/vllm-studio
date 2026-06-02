// Optional Codex app-server "catalog" overlay (kind: "catalog").
//
// This source provides the OpenAI-identical plugin catalog — the same
// marketplaces + enable/install state the Codex desktop app shows. It is a pure
// OVERLAY: reconcile.ts left-joins this onto the disk asset rows by
// name@marketplace, and the disk sources own all real paths (skill/mcp/app).
// Because it is non-essential, it MUST be bulletproof and non-blocking: every
// path is timeout-bounded and try/catch-guarded, and ANY failure yields [] so
// the plugins list always works disk-only.
//
// APPROACH — TEXT PARSE (deliberate):
// The Codex app-server exposes the live catalog over a custom length-prefixed
// IPC envelope protocol on ~/.codex/app-server-control/app-server-control.sock
// (4-byte LE frame length + a routed Request/Response envelope with
// source_client_id/target_client_id, an `initialize` handshake to obtain a
// client id, then a routed `plugin/list` request). That router protocol is
// non-trivial to reproduce correctly in TS and brittle to get wrong, so instead
// we spawn the very same binary's stable, human-readable command:
//   /Applications/Codex.app/Contents/Resources/codex plugin list
// (there is no --json flag) and parse its marketplace-grouped table. The output
// is the identical catalog the app-server would return — grouped by
// `Marketplace `<name>`` blocks with PLUGIN / STATUS / VERSION / PATH columns
// and statuses "installed, enabled" | "installed" | "not installed". Each
// `<plugin>@<marketplace>` row maps to a catalog PluginRow (name, source =
// marketplace, installed, enabled, version, and the disk path it reports). We
// do NOT attach skill/mcp/app paths or interface metadata here — those come
// from the disk asset sources during reconcile.
//
// The raw JSON-RPC handshake reference lives in the cloned client at
// /tmp/litter-explore (search plugin/list, PluginListResponse, PluginSummary,
// the Envelope/initialize handshake) if a future iteration wants the live wire.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { DiscoveryCtx, PluginRow, PluginSource } from "../types";

// Bundled Codex binary on macOS. Overridable for non-default installs/tests.
const DEFAULT_CODEX_BIN = "/Applications/Codex.app/Contents/Resources/codex";

// Control socket the desktop app-server listens on. Its mere existence is our
// cheap signal that a live Codex app-server is (or recently was) running.
function controlSocketPath(home: string): string {
  return path.join(home, ".codex", "app-server-control", "app-server-control.sock");
}

function codexBinPath(): string {
  const override = process.env.VLLM_STUDIO_CODEX_BIN?.trim();
  return override && override.length > 0 ? override : DEFAULT_CODEX_BIN;
}

// Hard ceiling on the `codex plugin list` spawn. Catalog is best-effort, so we
// would rather return [] than ever stall discovery.
const LIST_TIMEOUT_MS = 4000;

// Short in-process TTL memo so repeated discovery calls in the same session do
// not re-spawn the CLI. Safe to use the runtime clock here (product code).
const LIST_CACHE_TTL_MS = 15_000;
const AVAILABLE_CACHE_TTL_MS = 5000;

type CacheEntry<T> = { at: number; value: T };

let listCache: CacheEntry<PluginRow[]> | null = null;
let availableCache: CacheEntry<boolean> | null = null;

function freshCache<T>(entry: CacheEntry<T> | null, ttlMs: number): CacheEntry<T> | null {
  if (!entry) return null;
  return Date.now() - entry.at <= ttlMs ? entry : null;
}

/**
 * Cheap, non-blocking availability probe — NEVER spawns. The catalog is
 * reachable when the Codex binary exists AND either the control socket is
 * present OR the caller explicitly opted into spawning a fresh app-server.
 * Memoized briefly so the dir-stat/exists checks are not repeated per call.
 */
function isAvailable(ctx: DiscoveryCtx): boolean {
  const cached = freshCache(availableCache, AVAILABLE_CACHE_TTL_MS);
  if (cached) return cached.value;

  let value = false;
  try {
    const binExists = existsSync(codexBinPath());
    const socketExists = existsSync(controlSocketPath(ctx.home || homedir()));
    const spawnOptIn = process.env.VLLM_STUDIO_CODEX_APP_SERVER === "spawn";
    value = binExists && (socketExists || spawnOptIn);
  } catch {
    value = false;
  }

  availableCache = { at: Date.now(), value };
  return value;
}

/**
 * Best-effort catalog fetch. Wraps everything in try/catch and a hard timeout;
 * any failure (missing binary, non-zero exit, parse error, timeout) returns [].
 */
async function listCatalog(ctx: DiscoveryCtx): Promise<PluginRow[]> {
  const cached = freshCache(listCache, LIST_CACHE_TTL_MS);
  if (cached) return cached.value;

  let rows: PluginRow[] = [];
  try {
    if (isAvailable(ctx)) {
      const text = await runCodexPluginList();
      rows = parsePluginListText(text);
    }
  } catch {
    rows = [];
  }

  listCache = { at: Date.now(), value: rows };
  return rows;
}

// Spawn `codex plugin list` and resolve its stdout. Resolves with "" on any
// error / non-zero exit / timeout (the caller treats "" as an empty catalog).
function runCodexPluginList(): Promise<string> {
  return new Promise<string>((resolve) => {
    let settled = false;
    const done = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let child: ReturnType<typeof spawn> | null = null;
    const timer = setTimeout(() => {
      try {
        child?.kill("SIGTERM");
      } catch {
        // best-effort
      }
      done("");
    }, LIST_TIMEOUT_MS);

    try {
      child = spawn(codexBinPath(), ["plugin", "list"], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      done("");
      return;
    }

    let stdout = "";
    const limit = 200_000;
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(0, limit);
    });
    child.on("error", () => done(""));
    child.on("exit", (code) => done(code === 0 ? stdout : ""));
  });
}

// ── Text-parse fallback ────────────────────────────────────────────────────

// Catalog rows carry installed/enabled/source/version/path only; rich metadata
// (displayName, category, brandColor, skill/mcp/app paths) is reconciled from
// the disk asset sources. Statuses observed: "installed, enabled",
// "installed", "not installed". A row is "enabled" only when its status names
// "enabled"; "installed" when it names "installed".
type ParsedStatus = { installed: boolean; enabled: boolean };

function parseStatus(raw: string): ParsedStatus {
  const text = raw.toLowerCase();
  const installed = text.includes("installed") && !text.includes("not installed");
  const enabled = installed && text.includes("enabled");
  return { installed, enabled };
}

/**
 * Parse `codex plugin list` text into catalog PluginRows.
 *
 * The output is a sequence of marketplace blocks. We key off the
 * `<name>@<marketplace>` token in the PLUGIN column (which doubles as the
 * dedupe/reconcile key), then read the trailing STATUS / VERSION / PATH by
 * collapsing the column whitespace. We tolerate the variable column widths the
 * CLI uses (the `personal` marketplace compresses them), so we DO NOT rely on
 * fixed offsets — only on the leading `name@marketplace` token plus the known
 * status keywords.
 */
function parsePluginListText(text: string): PluginRow[] {
  const rows: PluginRow[] = [];
  const seen = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("Marketplace ")) continue;

    const match = /^(\S+?)@(\S+?)\s{2,}(.+)$/.exec(line);
    if (!match) continue;
    const name = match[1].trim();
    const source = match[2].trim();
    if (!name || !source) continue;

    const rest = match[3].trim();
    const status = parseStatus(rest);
    const { version, diskPath } = parseVersionAndPath(rest);

    const dedupeKey = `${name.toLowerCase()}@${source}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    rows.push({
      id: diskPath ?? dedupeKey,
      name,
      path: diskPath ?? "",
      installed: status.installed,
      enabled: status.enabled,
      source,
      ...(version ? { version } : {}),
    });
  }

  return rows;
}

// From the post-PLUGIN remainder ("installed, enabled  0.1.0  /abs/path" or
// "not installed                 /abs/path"), pull the trailing absolute path
// (the only field guaranteed to start with "/" on macOS) and the version token
// between the status and the path, if present.
function parseVersionAndPath(rest: string): { version?: string; diskPath?: string } {
  const pathMatch = /\s(\/\S.*)$/.exec(rest);
  const diskPath = pathMatch ? pathMatch[1].trim() : undefined;

  const head = diskPath ? rest.slice(0, rest.length - pathMatch![1].length) : rest;
  // Strip the status words; whatever standalone token remains is the version.
  const remainder = head
    .replace(/installed/gi, " ")
    .replace(/enabled/gi, " ")
    .replace(/disabled/gi, " ")
    .replace(/not/gi, " ")
    .replace(/,/g, " ")
    .trim();
  const version = remainder.split(/\s+/).filter(Boolean)[0];

  return { version: version || undefined, diskPath };
}

export const appServerSource: PluginSource = {
  id: "app-server",
  kind: "catalog",
  available: (ctx) => isAvailable(ctx),
  list: (ctx) => listCatalog(ctx),
};
