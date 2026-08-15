import { isRecord } from "@/lib/guards";
import {
  backupExistingFile,
  existingFileMode,
  readJsonFile,
  readYamlFile,
  writeJsonAtomic,
  writeYamlAtomic,
  type JsonRecord,
} from "./local-agent-config-file-io";
import { providerKeyForBaseUrl } from "./local-agent-config-merge";
import { detectLocalAgents, ompSettingsPath, resolveAgentSpec } from "./local-agent-registry";
import type {
  AttachAction,
  AttachExtraUpdate,
  AttachModelInput,
  AttachResult,
  LocalAgentId,
  LocalAgentModel,
} from "./local-agent-types";

export { LOCAL_AGENT_IDS, type LocalAgentId, type LocalAgentTarget } from "./local-agent-types";
export type { AttachAction, AttachModelInput, AttachResult, LocalAgentModel };
export { detectLocalAgents };

const planFor = (agent: LocalAgentId, home: string, model: LocalAgentModel) =>
  resolveAgentSpec(agent, home, model);

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
