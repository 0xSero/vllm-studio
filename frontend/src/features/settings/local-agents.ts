/**
 * Server-only support for attaching a Local Studio model to locally installed
 * coding-agent CLIs (pi, opencode, droid, hermes). Detection inspects well-known
 * config directories under a given home dir; attachment merges a provider /
 * model entry into each agent's own config file, preserving everything else
 * in the file and backing the file up before the first modification.
 */
import path from "node:path";
import { isRecord } from "@/lib/guards";
import {
  backupExistingFile,
  existingFileMode,
  pathExists,
  readJsonFile,
  readYamlFile,
  sameBaseUrl,
  writeJsonAtomic,
  writeYamlAtomic,
  type JsonRecord,
} from "./local-agent-config-file-io";
import {
  mergeDroidConfig,
  mergeHermesConfig,
  mergeOpencodeConfig,
  mergePiConfig,
  providerKeyForBaseUrl,
} from "./local-agent-config-merge";
import type {
  AttachAction,
  AttachExtraUpdate,
  AttachModelInput,
  AttachResult,
  LocalAgentId,
  LocalAgentModel,
  LocalAgentTarget,
} from "./local-agent-types";

export { LOCAL_AGENT_IDS, type LocalAgentId, type LocalAgentTarget } from "./local-agent-types";
export type { AttachAction, AttachModelInput, AttachResult, LocalAgentModel };

/**
 * Where each supported agent keeps its config, and which of them are actually
 * installed under a given home dir.
 */
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

interface AgentAttachPlan {
  configPath: string;
  detected: boolean;
  format: "json" | "yaml";
  /** Object to start from when the config file does not exist yet. */
  emptyConfig: () => JsonRecord;
  merge: (config: JsonRecord, model: LocalAgentModel) => AttachAction;
}

/** How to reach and update each agent's own config file. */
const PLAN_BY_AGENT: Record<
  LocalAgentId,
  (home: string, model: LocalAgentModel) => Promise<AgentAttachPlan>
> = {
  pi: async (home) => ({
    configPath: piConfigPath(home),
    detected: await pathExists(path.join(home, ".pi")),
    format: "json",
    emptyConfig: () => ({ providers: {} }),
    merge: mergePiConfig,
  }),
  opencode: async (home, model) => {
    const { xdg, dot } = opencodeCandidatePaths(home);
    return {
      configPath: await resolveOpencodeConfigPath(home, model.baseUrl),
      detected: (await pathExists(path.dirname(xdg))) || (await pathExists(path.dirname(dot))),
      format: "json",
      emptyConfig: () => ({ $schema: "https://opencode.ai/config.json" }),
      merge: mergeOpencodeConfig,
    };
  },
  hermes: async (home) => ({
    configPath: hermesConfigPath(home),
    detected: await pathExists(path.join(home, ".hermes")),
    format: "yaml",
    emptyConfig: () => ({ custom_models: [] }),
    merge: mergeHermesConfig,
  }),
  omp: async (home) => {
    const configPath = await resolveOmpConfigPath(home);
    return {
      configPath,
      detected: await pathExists(path.join(home, ".omp")),
      format: configPath.endsWith(".json") ? "json" : "yaml",
      emptyConfig: () => ({ providers: {} }),
      merge: mergePiConfig,
    };
  },
  droid: async (home) => ({
    configPath: droidConfigPath(home),
    detected: await pathExists(path.join(home, ".factory")),
    format: "json",
    emptyConfig: () => ({ customModels: [] }),
    merge: mergeDroidConfig,
  }),
};

const planFor = (agent: LocalAgentId, home: string, model: LocalAgentModel) =>
  PLAN_BY_AGENT[agent](home, model);

async function attachToAgent(
  agent: LocalAgentId,
  home: string,
  model: LocalAgentModel,
): Promise<AttachResult> {
  const plan = await planFor(agent, home, model);
  const { configPath, format } = plan;
  if (!plan.detected) {
    return {
      agent,
      ok: false,
      configPath,
      error: `${agent} is not installed (config directory not found)`,
    };
  }

  let file: { exists: boolean; config?: JsonRecord; error?: string };
  if (format === "yaml") {
    const yamlFile = await readYamlFile(configPath);
    if (yamlFile.error) {
      return { agent, ok: false, configPath, error: yamlFile.error };
    }
    file = { exists: yamlFile.exists, config: yamlFile.document?.toJS() as JsonRecord | undefined };
  } else {
    file = await readJsonFile(configPath);
  }
  if (file.error) {
    return { agent, ok: false, configPath, error: file.error };
  }

  const config = file.config ?? plan.emptyConfig();
  const mergeAction = plan.merge(config, model);

  let backupPath: string | undefined;
  if (file.exists) {
    backupPath = await backupExistingFile(configPath);
  }

  const mode = file.exists ? ((await existingFileMode(configPath)) ?? 0o600) : 0o600;
  if (format === "yaml") {
    await writeYamlAtomic(configPath, config, mode);
  } else {
    await writeJsonAtomic(configPath, config, mode);
  }

  const action: AttachAction = file.exists ? mergeAction : "created-file";
  const extraUpdates =
    agent === "omp" ? await enableOmpModel(home, model, config).catch(() => undefined) : undefined;
  return {
    agent,
    ok: true,
    configPath,
    backupPath,
    action,
    ...(extraUpdates ? { extraUpdates } : {}),
  };
}

async function enableOmpModel(
  home: string,
  model: LocalAgentModel,
  mergedConfig: JsonRecord,
): Promise<AttachExtraUpdate[] | undefined> {
  const providerKey = providerKeyForBaseUrl(mergedConfig, model.baseUrl);
  if (!providerKey) return undefined;
  const settingsPath = ompSettingsPath(home);
  const settings = await readYamlFile(settingsPath);
  if (settings.error || !settings.exists || !settings.document) return undefined;
  const doc = settings.document.toJS() as JsonRecord | undefined;
  if (!isRecord(doc)) return undefined;
  const enabled = doc["enabledModels"];
  if (!Array.isArray(enabled) || enabled.length === 0) return undefined;
  const selector = `${providerKey}/${model.modelId}`;
  if (enabled.includes(selector)) return undefined;
  enabled.push(selector);
  const backupPath = await backupExistingFile(settingsPath);
  const mode = (await existingFileMode(settingsPath)) ?? 0o600;
  await writeYamlAtomic(settingsPath, doc, mode);
  return [{ configPath: settingsPath, backupPath }];
}

export async function attachModelToAgents(input: AttachModelInput): Promise<AttachResult[]> {
  const results: AttachResult[] = [];
  for (const agent of input.targets) {
    try {
      results.push(await attachToAgent(agent, input.home, input.model));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const plan = await planFor(agent, input.home, input.model).catch(() => null);
      results.push({
        agent,
        ok: false,
        configPath: plan?.configPath ?? "",
        error: message,
      });
    }
  }
  return results;
}
