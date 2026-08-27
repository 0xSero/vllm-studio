import {
  inferModelVision,
  resolveModelVision,
} from "../../controller/contracts/model-capabilities";
import type { AgentThinkingLevel } from "./agent-turn";
import { Schema } from "effect";
import { isRecord, type UnknownRecord, type UnparsedValue } from "./guards";

export type OpenAIModelProperty =
  | string
  | number
  | boolean
  | null
  | OpenAIModelProperty[]
  | { [key: string]: OpenAIModelProperty | undefined };

export interface OpenAIModelListItem {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  name?: string;
  context_window?: number;
  contextWindow?: number;
  max_model_len?: number;
  max_tokens?: number;
  maxTokens?: number;
  metadata?: { [key: string]: OpenAIModelProperty | undefined };
  active?: boolean;
  [key: string]: OpenAIModelProperty | undefined;
}

export interface OpenAIModelsResponse {
  object?: string;
  data?: OpenAIModelListItem[];
}

export interface AgentModel {
  id: string;
  name: string;
  provider: "local-studio";
  providerId?: string;
  rawId?: string;
  controllerUrl?: string;
  controllerName?: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  thinkingLevels?: AgentThinkingLevel[];
  vision: boolean;
  active: boolean;
}

export function inferReasoningSupport(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return (
    normalized.includes("reason") ||
    normalized.includes("thinking") ||
    normalized.includes("r1") ||
    normalized.includes("deepseek") ||
    normalized.includes("inkling") ||
    normalized.includes("qwen3") ||
    normalized.includes("glm-5") ||
    normalized.includes("mimo")
  );
}

export function inferVisionSupport(modelId: string): boolean {
  return inferModelVision([modelId]);
}

const isNumber = Schema.is(Schema.Number);
const isString = Schema.is(Schema.String);
const isBoolean = Schema.is(Schema.Boolean);

function numberFromUnknown(value: UnparsedValue): number | undefined {
  if (isNumber(value) && Number.isFinite(value) && value > 0) return value;
  if (isString(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function recordFromUnknown(value: UnparsedValue): UnknownRecord {
  return isRecord(value) ? value : {};
}

function firstNumber(values: UnparsedValue[], fallback: number): number {
  for (const value of values) {
    const parsed = numberFromUnknown(value);
    if (parsed) return parsed;
  }
  return fallback;
}

function resolveContextWindow(model: OpenAIModelListItem, metadata: UnknownRecord): number {
  return firstNumber(
    [
      model.contextWindow,
      model.context_window,
      model.max_model_len,
      metadata["contextWindow"],
      metadata["context_window"],
      metadata["max_model_len"],
    ],
    128_000,
  );
}

function resolveMaxTokens(
  model: OpenAIModelListItem,
  metadata: UnknownRecord,
  contextWindow: number,
): number {
  return firstNumber(
    [model.maxTokens, model.max_tokens, metadata["maxTokens"], metadata["max_tokens"]],
    Math.min(contextWindow, 65_536),
  );
}

function resolveReasoning(
  model: OpenAIModelListItem,
  metadata: UnknownRecord,
  id: string,
): boolean {
  const explicitReasoning = metadata["reasoning"] ?? model["reasoning"];
  return isBoolean(explicitReasoning) ? explicitReasoning : inferReasoningSupport(id);
}

function modelDisplayName(value: UnparsedValue, fallback: string): string {
  if (isString(value)) return value.trim() || fallback;
  if (isNumber(value) || isBoolean(value)) return String(value).trim() || fallback;
  if (Array.isArray(value)) return value.join(",").trim() || fallback;
  return isRecord(value) ? "[object Object]" : fallback;
}

export function normalizeOpenAIModel(model: OpenAIModelListItem): AgentModel {
  const metadata = recordFromUnknown(model.metadata);
  const id = String(model.id || "").trim();
  const name = modelDisplayName(model.name || metadata["name"], id);
  const contextWindow = resolveContextWindow(model, metadata);
  const maxTokens = resolveMaxTokens(model, metadata, contextWindow);
  const explicitActive = metadata["active"] ?? model.active;

  return {
    id,
    name,
    provider: "local-studio",
    contextWindow,
    maxTokens,
    reasoning: resolveReasoning(model, metadata, id),
    vision: resolveModelVision({
      identifiers: [id],
      metadata,
      modalities: [model["input"], model["inputs"], model["modalities"]],
    }),
    active: explicitActive === true,
  };
}

export function normalizeOpenAIModels(payload: OpenAIModelsResponse): AgentModel[] {
  const rows = Array.isArray(payload.data) ? payload.data : [];
  const seen = new Set<string>();
  const models: AgentModel[] = [];
  for (const row of rows) {
    if (!row || !isString(row.id) || !row.id.trim()) continue;
    const model = normalizeOpenAIModel(row);
    if (seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}
