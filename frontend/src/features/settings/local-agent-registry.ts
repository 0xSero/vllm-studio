import path from "node:path";
import { isRecord } from "@shared/agent/guards";
import {
  pathExists,
  readJsonFile,
  sameBaseUrl,
  type JsonRecord,
} from "./local-agent-config-file-io";
import {
  mergeDroidConfig,
  mergeHermesConfig,
  mergeOpencodeConfig,
  mergePiConfig,
} from "./local-agent-config-merge";
import {
  LOCAL_AGENT_IDS,
  type AttachAction,
  type LocalAgentId,
  type LocalAgentModel,
  type LocalAgentTarget,
} from "./local-agent-types";

type AgentSpec = {
  label: string;
  roots: (home: string) => string[];
  configPath: (home: string, model?: LocalAgentModel) => string | Promise<string>;
  format: "json" | "yaml" | ((configPath: string) => "json" | "yaml");
  emptyConfig: () => JsonRecord;
  merge: (config: JsonRecord, model: LocalAgentModel) => AttachAction;
};

const ompPaths = (home: string) => ({
  yml: path.join(home, ".omp", "agent", "models.yml"),
  json: path.join(home, ".omp", "agent", "models.json"),
});

const opencodePaths = (home: string) => ({
  xdg: path.join(home, ".config", "opencode", "opencode.json"),
  dot: path.join(home, ".opencode", "config.json"),
});

const resolveOmpConfigPath = async (home: string): Promise<string> => {
  const { yml, json } = ompPaths(home);
  return (await pathExists(yml)) ? yml : (await pathExists(json)) ? json : yml;
};

const resolveOpencodeConfigPath = async (
  home: string,
  model?: LocalAgentModel,
): Promise<string> => {
  const { xdg, dot } = opencodePaths(home);
  if (model) {
    for (const candidate of [xdg, dot]) {
      const providers = (await readJsonFile(candidate)).config?.["provider"];
      if (
        isRecord(providers) &&
        Object.values(providers).some((provider) => {
          const options = isRecord(provider) ? provider["options"] : null;
          return isRecord(options) && sameBaseUrl(options["baseURL"], model.baseUrl);
        })
      ) {
        return candidate;
      }
    }
  }
  if (await pathExists(xdg)) return xdg;
  if (await pathExists(dot)) return dot;
  return (await pathExists(path.dirname(xdg))) ? xdg : dot;
};

export const ompSettingsPath = (home: string): string =>
  path.join(home, ".omp", "agent", "config.yml");

export const LOCAL_AGENT_SPECS: Record<LocalAgentId, AgentSpec> = {
  pi: {
    label: "pi",
    roots: (home) => [path.join(home, ".pi")],
    configPath: (home) => path.join(home, ".pi", "agent", "models.json"),
    format: "json",
    emptyConfig: () => ({ providers: {} }),
    merge: mergePiConfig,
  },
  opencode: {
    label: "opencode",
    roots: (home) => Object.values(opencodePaths(home)).map(path.dirname),
    configPath: resolveOpencodeConfigPath,
    format: "json",
    emptyConfig: () => ({ $schema: "https://opencode.ai/config.json" }),
    merge: mergeOpencodeConfig,
  },
  droid: {
    label: "droid (Factory)",
    roots: (home) => [path.join(home, ".factory")],
    configPath: (home) => path.join(home, ".factory", "settings.json"),
    format: "json",
    emptyConfig: () => ({ customModels: [] }),
    merge: mergeDroidConfig,
  },
  hermes: {
    label: "Hermes",
    roots: (home) => [path.join(home, ".hermes")],
    configPath: (home) => path.join(home, ".hermes", "config.yaml"),
    format: "yaml",
    emptyConfig: () => ({ custom_models: [] }),
    merge: mergeHermesConfig,
  },
  omp: {
    label: "omp (Oh My Pi)",
    roots: (home) => [path.join(home, ".omp")],
    configPath: resolveOmpConfigPath,
    format: (configPath) => (configPath.endsWith(".json") ? "json" : "yaml"),
    emptyConfig: () => ({ providers: {} }),
    merge: mergePiConfig,
  },
};

export const resolveAgentSpec = async (
  agent: LocalAgentId,
  home: string,
  model?: LocalAgentModel,
) => {
  const spec = LOCAL_AGENT_SPECS[agent];
  const configPath = await spec.configPath(home, model);
  return {
    ...spec,
    agent,
    configPath,
    detected: (await Promise.all(spec.roots(home).map(pathExists))).some(Boolean),
    exists: await pathExists(configPath),
    format: typeof spec.format === "function" ? spec.format(configPath) : spec.format,
  };
};

export const detectLocalAgents = async (home: string): Promise<LocalAgentTarget[]> =>
  (await Promise.all(LOCAL_AGENT_IDS.map((agent) => resolveAgentSpec(agent, home))))
    .filter(({ detected }) => detected)
    .map(({ agent, label, configPath, exists }) => ({ agent, label, configPath, exists }));
