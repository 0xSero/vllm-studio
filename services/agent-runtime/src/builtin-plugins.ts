import { stat } from "node:fs/promises";
import { hasEnabledConnectorsSync } from "./connectors-service";
import { hasGithubCliSync } from "./github-cli";
import { hasObsidianVaultSync } from "./obsidian-vault";
import type { PluginRow } from "./plugin-contract";
import { resolveBundledResource } from "./plugin-resources";

type Gate = () => boolean | null;
type Builtin = [id: string, file: string, loads: Gate, note: string];
const always = (): boolean => true;
const perSession = (): null => null;
const BUILTINS: Builtin[] = [
  [
    "local-studio-timeouts",
    "local-studio-timeouts.ts",
    always,
    "Always loaded — enforces the session time limits.",
  ],
  [
    "local-studio-agent-policy",
    "local-studio-agent-policy.ts",
    always,
    "Always loaded — applies Local Studio's agent policy.",
  ],
  ["subagents", "subagents.ts", always, "Always loaded — lets the agent spawn subagent sessions."],
  [
    "automations",
    "automations.ts",
    always,
    "Always loaded — lets the agent manage scheduled automations.",
  ],
  ["cua", "cua.ts", perSession, "Loads per session, when the Browser tool is on."],
  [
    "chrome",
    "chrome.ts",
    perSession,
    "Loads per session, when the browser backend is your own Chrome.",
  ],
  ["github", "github.ts", hasGithubCliSync, "Loads when the gh CLI is installed."],
  ["obsidian", "obsidian.ts", hasObsidianVaultSync, "Loads when Obsidian has registered a vault."],
  [
    "connectors",
    "connectors.ts",
    hasEnabledConnectorsSync,
    "Loads when at least one connector is enabled.",
  ],
];

export async function listBuiltinPlugins(): Promise<PluginRow[]> {
  const rows = await Promise.all(
    BUILTINS.map(async ([id, file, loads, note]) => {
      const target = resolveBundledResource("pi-extensions", file);
      if (!target) return null;
      const info = await stat(target).catch(() => null);
      return info
        ? {
            id,
            file,
            path: target,
            enabled: loads() !== false,
            bytes: info.size,
            updated_at: info.mtime.toISOString(),
            read_only: true,
            builtin: true,
            note,
          }
        : null;
    }),
  );
  return rows.flatMap((row) => (row ? [row] : []));
}
