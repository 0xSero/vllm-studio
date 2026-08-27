/**
 * Merges a Local Studio model entry into each agent's own config shape,
 * mutating the parsed config in place so unrelated keys keep their original
 * order and any fields this feature doesn't know about survive untouched.
 */
import { Schema } from "effect";
import type { AttachAction, LocalAgentModel } from "./local-agent-types";
import { sameBaseUrl, type JsonRecord, type JsonValue } from "./local-agent-config-file-io";
import { isRecord } from "@shared/agent/guards";

const DEFAULT_PROVIDER_KEY = "local-studio";

function providerKeyFor(taken: (key: string) => boolean): string {
  if (!taken(DEFAULT_PROVIDER_KEY)) return DEFAULT_PROVIDER_KEY;
  let suffix = 2;
  while (taken(`${DEFAULT_PROVIDER_KEY}-${suffix}`)) suffix += 1;
  return `${DEFAULT_PROVIDER_KEY}-${suffix}`;
}

const slugify = (value: string): string =>
  value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function mergePiConfig(config: JsonRecord, model: LocalAgentModel): AttachAction {
  const providerValue = config["providers"];
  const providers: JsonRecord = isRecord(providerValue) ? providerValue : {};
  if (!isRecord(providerValue)) config["providers"] = providers;

  const modelEntry: JsonRecord = {
    id: model.modelId,
    name: model.displayName,
    reasoning: model.reasoning,
    input: model.images ? ["text", "image"] : ["text"],
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {},
  };

  const existing = Object.values(providers).find(
    (provider) => isRecord(provider) && sameBaseUrl(provider["baseUrl"], model.baseUrl),
  );
  if (isRecord(existing)) {
    const modelValue = existing["models"];
    const models: JsonValue[] = Array.isArray(modelValue) ? modelValue : [];
    if (!Array.isArray(modelValue)) existing["models"] = models;
    const index = models.findIndex((entry) => isRecord(entry) && entry["id"] === model.modelId);
    if (index >= 0) {
      models[index] = modelEntry;
      return "updated";
    }
    models.push(modelEntry);
    return "added";
  }

  const key = providerKeyFor((candidate) => candidate in providers);
  providers[key] = {
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    api: "openai-completions",
    models: [modelEntry],
  };
  return "added";
}

export function providerKeyForBaseUrl(config: JsonRecord, baseUrl: string): string | null {
  const providers = config["providers"];
  if (!isRecord(providers)) return null;
  for (const [key, provider] of Object.entries(providers)) {
    if (isRecord(provider) && sameBaseUrl(provider["baseUrl"], baseUrl)) return key;
  }
  return null;
}

export function mergeOpencodeConfig(config: JsonRecord, model: LocalAgentModel): AttachAction {
  const providerValue = config["provider"];
  const providers: JsonRecord = isRecord(providerValue) ? providerValue : {};
  if (!isRecord(providerValue)) config["provider"] = providers;

  const modelEntry: JsonRecord = {
    id: model.modelId,
    name: model.displayName,
    limit: { context: model.contextWindow, output: model.maxTokens },
  };

  const existing = Object.values(providers).find((provider) => {
    if (!isRecord(provider)) return false;
    const options = provider["options"];
    return isRecord(options) && sameBaseUrl(options["baseURL"], model.baseUrl);
  });
  if (isRecord(existing)) {
    const modelValue = existing["models"];
    const models: JsonRecord = isRecord(modelValue) ? modelValue : {};
    if (!isRecord(modelValue)) existing["models"] = models;
    const action: AttachAction = model.modelId in models ? "updated" : "added";
    models[model.modelId] = modelEntry;
    return action;
  }

  const key = providerKeyFor((candidate) => candidate in providers);
  providers[key] = {
    npm: "@ai-sdk/openai-compatible",
    name: "Local Studio",
    options: { baseURL: model.baseUrl, apiKey: model.apiKey },
    models: { [model.modelId]: modelEntry },
  };
  return "added";
}

export function mergeDroidConfig(config: JsonRecord, model: LocalAgentModel): AttachAction {
  const customModelValue = config["customModels"];
  const customModels: JsonValue[] = Array.isArray(customModelValue) ? customModelValue : [];
  if (!Array.isArray(customModelValue)) config["customModels"] = customModels;

  const existing = customModels.find(
    (entry) =>
      isRecord(entry) &&
      entry["model"] === model.modelId &&
      sameBaseUrl(entry["baseUrl"], model.baseUrl),
  );
  if (isRecord(existing)) {
    existing["model"] = model.modelId;
    existing["baseUrl"] = model.baseUrl;
    existing["apiKey"] = model.apiKey;
    existing["displayName"] = model.displayName;
    existing["maxContextLimit"] = model.contextWindow;
    existing["noImageSupport"] = !model.images;
    existing["provider"] = "generic-chat-completion-api";
    return "updated";
  }

  const indexes: number[] = [];
  for (const entry of customModels) {
    if (!isRecord(entry)) continue;
    const parsedIndex = Schema.decodeUnknownOption(Schema.Number)(entry["index"]);
    if (parsedIndex._tag === "Some") indexes.push(parsedIndex.value);
  }
  const index = indexes.length > 0 ? Math.max(...indexes) + 1 : 0;
  customModels.push({
    model: model.modelId,
    id: `custom:${slugify(model.displayName)}-${index}`,
    index,
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    displayName: model.displayName,
    maxContextLimit: model.contextWindow,
    noImageSupport: !model.images,
    provider: "generic-chat-completion-api",
  });
  return "added";
}

export function mergeHermesConfig(config: JsonRecord, model: LocalAgentModel): AttachAction {
  const customModelValue = config["custom_models"];
  const customModels: JsonValue[] = Array.isArray(customModelValue) ? customModelValue : [];
  if (!Array.isArray(customModelValue)) config["custom_models"] = customModels;

  const ConfigKeySchema = Schema.Struct({
    model: Schema.optional(Schema.String),
    name: Schema.optional(Schema.String),
  });
  type ConfigKey = typeof ConfigKeySchema.Type;
  const normaliseKey = (entry: ConfigKey, key: "model" | "name") => entry[key] ?? "";

  const existing = customModels.find((entry) => {
    if (!isRecord(entry)) return false;
    const parsedEntry = Schema.decodeUnknownOption(ConfigKeySchema)(entry);
    const modelKey = parsedEntry._tag === "Some" ? normaliseKey(parsedEntry.value, "model") : "";
    const nameKey = parsedEntry._tag === "Some" ? normaliseKey(parsedEntry.value, "name") : "";
    return (
      (modelKey === model.modelId || nameKey === model.modelId) &&
      sameBaseUrl(entry["base_url"], model.baseUrl)
    );
  });
  if (isRecord(existing)) {
    existing["model"] = model.modelId;
    existing["name"] = model.displayName;
    existing["base_url"] = model.baseUrl;
    existing["api_key"] = model.apiKey;
    existing["provider"] = existing["provider"] ?? "custom";
    if (model.reasoning) existing["reasoning_effort"] = "high";
    return "updated";
  }

  const indexes: number[] = [];
  for (const entry of customModels) {
    if (!isRecord(entry)) continue;
    const parsedIndex = Schema.decodeUnknownOption(Schema.Number)(entry["index"]);
    if (parsedIndex._tag === "Some") indexes.push(parsedIndex.value);
  }
  const index = indexes.length > 0 ? Math.max(...indexes) + 1 : 0;
  const entry: JsonRecord = {
    name: model.displayName,
    model: model.modelId,
    base_url: model.baseUrl,
    api_key: model.apiKey,
    provider: "custom",
    index,
  };
  if (model.reasoning) entry["reasoning_effort"] = "high";
  customModels.push(entry);
  return "added";
}
