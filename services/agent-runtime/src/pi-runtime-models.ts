import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { getApiSettings, type ApiSettings } from "./settings-service";
import { resolveDataDir } from "./data-dir";
import { listProviderAgentModels, refreshProviderHub } from "./provider-hub";
import type { OpenAICompletionsCompat } from "@earendil-works/pi-ai";
import { Schema } from "effect";
import {
  normalizeOpenAIModels,
  inferReasoningSupport,
  type AgentModel,
} from "../../../shared/agent/models";
import { AGENT_THINKING_LEVELS, type AgentThinkingLevel } from "../../../shared/agent/agent-turn";
import { resolveModelVision } from "../../../controller/contracts/model-capabilities";

const PROVIDER_ID = "local-studio";
const USER_PI_PREFIX = "user-pi-";

function userPiModelsPath(): string {
  const agentDir = process.env["PI_CODING_AGENT_DIR"]?.trim();
  return path.join(
    agentDir || path.join(process.env["HOME"] ?? homedir(), ".pi", "agent"),
    "models.json",
  );
}

type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

interface JsonObject {
  readonly [key: string]: JsonValue;
}

const JsonValueSchema = Schema.suspend(
  (): Schema.Codec<JsonValue> =>
    Schema.Union([
      Schema.String,
      Schema.Number,
      Schema.Boolean,
      Schema.Null,
      Schema.Array(JsonValueSchema),
      Schema.Record(Schema.String, JsonValueSchema),
    ]),
);

const ThinkingLevelMapSchema = Schema.Record(
  Schema.Literals(AGENT_THINKING_LEVELS),
  Schema.NullOr(Schema.String),
);

const PiProviderModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  active: Schema.optional(Schema.Boolean),
  reasoning: Schema.optional(Schema.Boolean),
  input: Schema.optional(Schema.Array(Schema.String)),
  contextWindow: Schema.optional(Schema.Number),
  maxTokens: Schema.optional(Schema.Number),
  cost: Schema.optional(Schema.Record(Schema.String, Schema.Number)),
  compat: Schema.optional(Schema.Record(Schema.String, JsonValueSchema)),
  thinkingLevelMap: Schema.optional(ThinkingLevelMapSchema),
});

type PiProviderModel = typeof PiProviderModelSchema.Type;

const PiProviderConfigSchema = Schema.Struct({
  baseUrl: Schema.String,
  apiKey: Schema.optional(Schema.String),
  api: Schema.optional(Schema.String),
  authHeader: Schema.optional(Schema.Boolean),
  models: Schema.optional(Schema.Array(PiProviderModelSchema)),
  compat: Schema.optional(Schema.Record(Schema.String, JsonValueSchema)),
});

type PiProviderConfig = typeof PiProviderConfigSchema.Type;
type UserPiProviders = { [name: string]: PiProviderConfig };

const UserPiProvidersSchema = Schema.Record(Schema.String, PiProviderConfigSchema);

const PersistedControllersSchema = Schema.Array(
  Schema.Struct({
    url: Schema.String,
    apiKey: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
  }),
);

const OpenAIModelsResponseSchema = Schema.Struct({
  object: Schema.optional(Schema.String),
  data: Schema.optional(Schema.Array(Schema.Record(Schema.String, JsonValueSchema))),
});

/** Strip any prefixes this writer has already applied.
 *
 *  When PI_CODING_AGENT_DIR points at Local Studio's own data dir — which it
 *  does for the desktop app — the file we read here is the file we write. Every
 *  pass therefore re-prefixed providers that were already prefixed, so
 *  "vibeproxy-claude" became "user-pi-vibeproxy-claude", then
 *  "user-pi-user-pi-vibeproxy-claude", growing by one hop per launch. Observed
 *  in the wild at 26 nested hops and a 466 KB models.json.
 *
 *  Collapsing on read makes the merge idempotent and self-heals files that have
 *  already grown. */
function baseProviderName(name: string): string {
  let base = name;
  while (base.startsWith(USER_PI_PREFIX)) base = base.slice(USER_PI_PREFIX.length);
  return base;
}

async function loadUserPiProviders(): Promise<UserPiProviders> {
  const modelsPath = userPiModelsPath();
  if (!existsSync(modelsPath)) return {};
  try {
    const parsed = Schema.decodeUnknownSync(
      Schema.Struct({ providers: Schema.optional(UserPiProvidersSchema) }),
    )(JSON.parse(await readFile(modelsPath, "utf-8")));
    const collapsed: UserPiProviders = {};
    for (const [name, config] of Object.entries(parsed.providers ?? {})) {
      const base = baseProviderName(name);
      // Our own controller providers are regenerated from the live controller
      // every pass; reading them back would duplicate them under a user-pi name
      // the moment the controller went away. Test the COLLAPSED name — a prior
      // pass has already produced "user-pi-local-studio" in the wild, which is
      // our own provider wearing a user-pi hat.
      if (!base || base === PROVIDER_ID || base.startsWith(`${PROVIDER_ID}-`)) continue;
      collapsed[base] = config;
    }
    return collapsed;
  } catch {
    return {};
  }
}

function userPiModelToAgentModel(
  providerName: string,
  qualifiedProviderId: string,
  model: PiProviderModel,
  providerCompat?: JsonObject,
): AgentModel {
  const rawId = model.id;
  const name = model.name ?? rawId;
  const inputs = model.input ?? ["text"];
  const reasoning = model.reasoning ?? inferReasoningSupport(rawId);
  return {
    id: `${qualifiedProviderId}/${rawId}`,
    rawId,
    name: `${name} · ${providerName}`,
    provider: "local-studio",
    providerId: qualifiedProviderId,
    controllerName: providerName,
    contextWindow: model.contextWindow ?? 128_000,
    maxTokens: model.maxTokens ?? 65_536,
    reasoning,
    thinkingLevels: supportedPiThinkingLevels(model, reasoning, providerCompat),
    vision: resolveModelVision({ identifiers: [rawId], modalities: [inputs] }),
    active: false,
  };
}

function supportedPiThinkingLevels(
  model: PiProviderModel,
  reasoning: boolean,
  providerCompat?: JsonObject,
): AgentThinkingLevel[] {
  if (!reasoning) return ["off"];
  const supportsReasoningEffort =
    model.compat?.supportsReasoningEffort ?? providerCompat?.supportsReasoningEffort;
  if (supportsReasoningEffort !== true) return ["high"];
  return AGENT_THINKING_LEVELS.filter((level) => {
    if (level === "auto") return model.thinkingLevelMap?.minimal === "auto";
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

function isInklingModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes("inkling");
}

export function controllerModelThinkingLevels(
  reasoning: boolean,
  modelId = "",
): AgentThinkingLevel[] {
  if (reasoning && isInklingModelId(modelId)) {
    return ["off", "minimal", "low", "medium", "high", "max"];
  }
  return reasoning ? ["auto", "low", "medium", "high", "max", "off"] : ["off"];
}

export function toPiThinkingLevel(level: AgentThinkingLevel): Exclude<AgentThinkingLevel, "auto"> {
  return level === "auto" ? "minimal" : level;
}

export type PiControllerModelsRequest = {
  url: string;
  apiKey?: string;
  name?: string;
};

type PiControllerConfig = {
  url: string;
  apiKey: string;
  name?: string;
};

type ControllerModels = {
  controller: PiControllerConfig;
  models: AgentModel[];
  providerId: string;
};

function controllersPath(agentDir: string): string {
  return path.join(agentDir, "controllers.json");
}

function controllerLabel(controller: PiControllerConfig, index: number): string {
  if (controller.name?.trim()) return controller.name.trim();
  try {
    return new URL(controller.url).host;
  } catch {
    return index === 0 ? "primary" : `controller ${index + 1}`;
  }
}

function providerIdForController(controller: PiControllerConfig, index: number): string {
  if (index === 0) return PROVIDER_ID;
  const normalized = controller.url
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${PROVIDER_ID}-${normalized || index + 1}`;
}

function qualifyModelId(providerId: string, rawId: string): string {
  return providerId === PROVIDER_ID ? rawId : `${providerId}/${rawId}`;
}

function normalizeBackendUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizeControllerInput(input: PiControllerModelsRequest): PiControllerConfig | null {
  const url = normalizeBackendUrl(input.url || "");
  if (!url) return null;
  const apiKey = input.apiKey?.trim() ?? "";
  const name = input.name?.trim();
  const controller: PiControllerConfig = { url, apiKey };
  if (name) controller.name = name;
  return controller;
}

function mergeControllers(
  settings: ApiSettings,
  requested: PiControllerModelsRequest[] = [],
): PiControllerConfig[] {
  const requestedControllers = requested
    .map(normalizeControllerInput)
    .filter((controller): controller is PiControllerConfig => controller !== null);
  if (requestedControllers.length > 0) {
    return [
      ...new Map(requestedControllers.map((controller) => [controller.url, controller])).values(),
    ];
  }
  const primary = normalizeControllerInput({
    url: settings.backendUrl,
    apiKey: settings.apiKey,
    name: "primary",
  });
  return primary ? [primary] : [];
}

async function loadPersistedControllers(agentDir: string): Promise<PiControllerModelsRequest[]> {
  const file = controllersPath(agentDir);
  if (!existsSync(file)) return [];
  try {
    return [
      ...Schema.decodeUnknownSync(PersistedControllersSchema)(
        JSON.parse(await readFile(file, "utf-8")),
      ),
    ];
  } catch {
    return [];
  }
}

async function savePersistedControllers(
  agentDir: string,
  controllers: PiControllerConfig[],
): Promise<void> {
  await writeFile(controllersPath(agentDir), JSON.stringify(controllers, null, 2), "utf-8");
  await chmod(controllersPath(agentDir), 0o600).catch(() => undefined);
}

async function fetchModelsFromController(
  controller: PiControllerConfig,
  index: number,
  multipleControllers: boolean,
): Promise<ControllerModels> {
  const backendUrl = normalizeBackendUrl(controller.url);
  const headers: HeadersInit = { Accept: "application/json" };
  if (controller.apiKey) headers.Authorization = `Bearer ${controller.apiKey}`;
  const response = await fetch(`${backendUrl}/v1/models`, { headers, cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${backendUrl}/v1/models failed with HTTP ${response.status}`);
  }
  const payload = Schema.decodeUnknownSync(OpenAIModelsResponseSchema)(await response.json());
  const data = payload.data?.flatMap((row) => {
    const id = row["id"];
    return Schema.is(Schema.String)(id) ? [{ ...row, id }] : [];
  });
  const providerId = providerIdForController(controller, index);
  const label = controllerLabel(controller, index);
  const models = normalizeOpenAIModels({ object: payload.object, data }).map(
    (model) => ({
      ...model,
      reasoning: model.reasoning,
      id: qualifyModelId(providerId, model.id),
      rawId: model.id,
      providerId,
      controllerUrl: backendUrl,
      controllerName: label,
      thinkingLevels: controllerModelThinkingLevels(model.reasoning, model.rawId ?? model.id),
      name: multipleControllers ? `${model.name} · ${label}` : model.name,
    }),
  );
  return { controller: { ...controller, url: backendUrl }, models, providerId };
}

async function fetchModelsFromControllers(controllers: PiControllerConfig[]): Promise<{
  models: AgentModel[];
  controllerModels: ControllerModels[];
}> {
  const settled = await Promise.allSettled(
    controllers.map((controller, index) =>
      fetchModelsFromController(controller, index, controllers.length > 1),
    ),
  );
  const controllerModels = settled
    .filter(
      (result): result is PromiseFulfilledResult<ControllerModels> => result.status === "fulfilled",
    )
    .map((result) => result.value);
  if (controllerModels.length === 0) {
    const firstError = settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw firstError?.reason instanceof Error
      ? firstError.reason
      : new Error("No controllers returned models.");
  }
  const seen = new Set<string>();
  const models: AgentModel[] = [];
  for (const result of controllerModels) {
    for (const model of result.models) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      models.push(model);
    }
  }
  return { models: models.sort((a, b) => a.name.localeCompare(b.name)), controllerModels };
}

async function writePiModelsConfig(
  controllerModels: ControllerModels[],
  userPiProviders: UserPiProviders,
): Promise<string> {
  const dataDir = resolveDataDir();
  const agentDir = path.join(dataDir, "pi-agent");
  await mkdir(agentDir, { recursive: true });
  await chmod(agentDir, 0o700).catch(() => undefined);

  const vllmProviders = Object.fromEntries(
    controllerModels.map(({ controller, models, providerId }) => [
      providerId,
      {
        baseUrl: `${controller.url}/v1`,
        api: "openai-completions",
        apiKey: controller.apiKey || "local-studio",
        authHeader: Boolean(controller.apiKey),
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: true,
        },
        models: modelsToPiModels(models),
      },
    ]),
  );

  const providers: UserPiProviders = {};
  Object.assign(providers, vllmProviders);
  for (const [name, config] of Object.entries(userPiProviders)) {
    providers[`${USER_PI_PREFIX}${name}`] = {
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      api: config.api,
      authHeader: config.authHeader,
      compat: config.compat,
      models: config.models ?? [],
    };
  }

  const modelsPath = path.join(agentDir, "models.json");
  await writeFile(modelsPath, JSON.stringify({ providers }, null, 2), "utf-8");
  await chmod(modelsPath, 0o600).catch(() => undefined);
  return agentDir;
}

export type PiModelSelection = { providerId: string; modelId: string };

export function resolvePiModelSelection(modelId: string): PiModelSelection {
  const separator = modelId.indexOf("/");
  if (separator > 0) {
    const maybeProvider = modelId.slice(0, separator);
    if (maybeProvider.startsWith(USER_PI_PREFIX) || maybeProvider.startsWith(`${PROVIDER_ID}-`)) {
      return { providerId: maybeProvider, modelId: modelId.slice(separator + 1) };
    }
  }
  return { providerId: PROVIDER_ID, modelId };
}

export async function refreshPiModels(
  requestedControllers?: PiControllerModelsRequest[],
): Promise<{ models: AgentModel[]; agentDir: string }> {
  const settings = await getApiSettings();
  const dataDir = resolveDataDir();
  const agentDir = path.join(dataDir, "pi-agent");
  await mkdir(agentDir, { recursive: true });
  await chmod(agentDir, 0o700).catch(() => undefined);
  const persisted =
    requestedControllers && requestedControllers.length > 0
      ? requestedControllers
      : await loadPersistedControllers(agentDir);
  const controllers = mergeControllers(settings, persisted);
  await savePersistedControllers(agentDir, controllers);
  // A dead controller must not hide signed-in cloud providers: collect the
  // failure and only surface it when nothing else can serve models.
  let models: AgentModel[] = [];
  let controllerModels: ControllerModels[] = [];
  let controllerError: Error | null = null;
  try {
    ({ models, controllerModels } = await fetchModelsFromControllers(controllers));
  } catch (error) {
    controllerError = error instanceof Error ? error : new Error("No controllers returned models.");
  }

  const userPiProviders = await loadUserPiProviders();
  const userPiModels = Object.entries(userPiProviders).flatMap(([providerName, config]) => {
    const qualifiedProviderId = `${USER_PI_PREFIX}${providerName}`;
    return (config.models ?? []).map((model) =>
      userPiModelToAgentModel(providerName, qualifiedProviderId, model, config.compat),
    );
  });
  const writtenAgentDir = await writePiModelsConfig(controllerModels, userPiProviders);
  const providerModels = await collectProviderAgentModels();

  const allModels = [...models, ...userPiModels, ...providerModels];
  if (allModels.length === 0 && controllerError) {
    throw controllerError;
  }
  return { models: allModels, agentDir: writtenAgentDir };
}
async function collectProviderAgentModels(): Promise<AgentModel[]> {
  await refreshProviderHub().catch(() => undefined);
  return listProviderAgentModels();
}

// Moved here from the shared models module: only the runtime needs the
// pi-model mapping, and the OpenAICompletionsCompat type must resolve against
// the SDK install.
function isDeepSeekReasoningModel(model: AgentModel): boolean {
  const id = `${model.id} ${model.rawId ?? ""} ${model.name}`.toLowerCase();
  return model.reasoning && id.includes("deepseek");
}

function isControllerBackedModel(model: AgentModel): boolean {
  return Boolean(model.controllerUrl);
}

function isInklingReasoningModel(model: AgentModel): boolean {
  const id = `${model.id} ${model.rawId ?? ""} ${model.name}`.toLowerCase();
  return model.reasoning && id.includes("inkling");
}

const VLLM_OPENAI_COMPAT: OpenAICompletionsCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  supportsStrictMode: false,
  supportsUsageInStreaming: true,
  maxTokensField: "max_completion_tokens",
};

const CONTROLLER_THINKING_LEVEL_MAP = {
  off: "off",
  minimal: "auto",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
  max: "max",
} as const;

export function modelsToPiModels(models: AgentModel[]) {
  return models.map((model) => {
    // The hosted DeepSeek API uses a `thinking` object and requires an empty
    // `reasoning_content` field on replayed assistant messages. Our vLLM
    // controller exposes DeepSeek V4 through the standard OpenAI-compatible
    // surface instead, where that hosted-only dialect corrupts tool-history
    // turns. Keep the ordinary `reasoning_effort` mapping for controller models.
    const deepSeekReasoning =
      isDeepSeekReasoningModel(model) && !isControllerBackedModel(model);
    const inklingReasoning = isInklingReasoningModel(model);
    return {
      id: model.rawId ?? model.id,
      name: model.name,
      active: model.active,
      reasoning: model.reasoning,
      input: model.vision ? ["text", "image"] : ["text"],
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      ...(model.controllerUrl && model.reasoning
        ? { thinkingLevelMap: CONTROLLER_THINKING_LEVEL_MAP }
        : deepSeekReasoning
        ? {
            thinkingLevelMap: {
              off: null,
              minimal: null,
              low: "low",
              medium: "medium",
              high: "high",
              xhigh: "max",
              max: "max",
            },
          }
        : inklingReasoning
          ? {
              thinkingLevelMap: {
                off: "none",
                minimal: "minimal",
                low: "low",
                medium: "medium",
                high: "high",
                xhigh: null,
                max: "max",
              },
            }
          : {}),
      compat: deepSeekReasoning
        ? {
            ...VLLM_OPENAI_COMPAT,
            thinkingFormat: "deepseek",
            requiresReasoningContentOnAssistantMessages: true,
          }
        : VLLM_OPENAI_COMPAT,
    };
  });
}
