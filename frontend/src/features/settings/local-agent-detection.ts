/**
 * Locates each supported coding agent's config directory/file under a given
 * home dir, so callers can tell which agents are actually installed before
 * offering to attach a model to them.
 */
import path from "node:path";
import type { LocalAgentId, LocalAgentTarget } from "./local-agent-types";
import { pathExists, readJsonFile, sameBaseUrl } from "./local-agent-config-file-io";
import { isRecord } from "@/lib/guards";

export const piConfigPath = (home: string): string =>
  path.join(home, ".pi", "agent", "models.json");
export const droidConfigPath = (home: string): string =>
  path.join(home, ".factory", "settings.json");
export const hermesConfigPath = (home: string): string => path.join(home, ".hermes", "config.yaml");
export const ompSettingsPath = (home: string): string =>
  path.join(home, ".omp", "agent", "config.yml");

export async function resolveOmpConfigPath(home: string): Promise<string> {
  const yml = path.join(home, ".omp", "agent", "models.yml");
  if (await pathExists(yml)) return yml;
  const json = path.join(home, ".omp", "agent", "models.json");
  if (await pathExists(json)) return json;
  return yml;
}

export const opencodeCandidatePaths = (home: string): { xdg: string; dot: string } => ({
  xdg: path.join(home, ".config", "opencode", "opencode.json"),
  dot: path.join(home, ".opencode", "config.json"),
});

/**
 * Pick the opencode config file to write. Prefers an existing file whose
 * provider map already contains a matching-baseURL provider (when a baseUrl
 * is given), then `~/.config/opencode/opencode.json` when that directory
 * exists, then `~/.opencode/config.json`.
 */
export async function resolveOpencodeConfigPath(home: string, baseUrl?: string): Promise<string> {
  const { xdg, dot } = opencodeCandidatePaths(home);
  if (baseUrl) {
    for (const candidate of [xdg, dot]) {
      const { config } = await readJsonFile(candidate);
      const providers = config?.["provider"];
      if (!isRecord(providers)) continue;
      const matches = Object.values(providers).some((provider) => {
        if (!isRecord(provider)) return false;
        const options = provider["options"];
        return isRecord(options) && sameBaseUrl(options["baseURL"], baseUrl);
      });
      if (matches) return candidate;
    }
  }
  if (await pathExists(xdg)) return xdg;
  if (await pathExists(dot)) return dot;
  if (await pathExists(path.join(home, ".config", "opencode"))) return xdg;
  return dot;
}

/** agent id, display label, $HOME marker dirs, config-file resolver. */
type AgentProbe = [LocalAgentId, string, string[], (home: string) => string | Promise<string>];

const AGENT_PROBES: AgentProbe[] = [
  ["pi", "pi", [".pi"], piConfigPath],
  ["opencode", "opencode", [".config/opencode", ".opencode"], resolveOpencodeConfigPath],
  ["droid", "droid (Factory)", [".factory"], droidConfigPath],
  ["hermes", "Hermes", [".hermes"], hermesConfigPath],
  ["omp", "omp (Oh My Pi)", [".omp"], resolveOmpConfigPath],
];

export async function detectLocalAgents(home: string): Promise<LocalAgentTarget[]> {
  const targets: LocalAgentTarget[] = [];
  for (const [agent, label, markers, resolveConfigPath] of AGENT_PROBES) {
    const found = await Promise.all(markers.map((dir) => pathExists(path.join(home, dir))));
    if (!found.some(Boolean)) continue;
    const configPath = await resolveConfigPath(home);
    targets.push({ agent, label, configPath, exists: await pathExists(configPath) });
  }
  return targets;
}
