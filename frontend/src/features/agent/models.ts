import type { ModelCatalogResponse, ModelOffer } from "@local-studio/contracts/model-catalog";
import type { AgentThinkingLevel } from "@/features/agent/contracts";
export {
  inferReasoningSupport,
  inferVisionSupport,
  normalizeOpenAIModel,
  normalizeOpenAIModels,
  type OpenAIModelListItem,
  type OpenAIModelsResponse,
} from "@shared/agent/models";

export type CatalogAgentModel = ModelOffer & {
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  thinkingLevels: AgentThinkingLevel[];
  vision: boolean;
  active: boolean;
};

export function agentModelsFromCatalog(payload: ModelCatalogResponse): CatalogAgentModel[] {
  return payload.models.map((model) => ({
    ...model,
    maxTokens: model.maxOutputTokens,
    reasoning: model.capabilities.reasoning,
    thinkingLevels: [...model.capabilities.thinkingLevels],
    vision: model.capabilities.input.includes("image"),
    active: model.available,
  }));
}

export type {
  ModelCatalogResponse,
  ModelLab,
  ModelProtocol,
  ModelRouteOffer,
} from "@local-studio/contracts/model-catalog";
