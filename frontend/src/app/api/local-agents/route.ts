import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { Schema } from "effect";
import { getApiSettings } from "@local-studio/agent-runtime/settings-service";
import { requireApiAccess } from "@/lib/auth/guard";

import {
  attachModelToAgents,
  detectLocalAgents,
  LOCAL_AGENT_IDS,
  type LocalAgentId,
} from "@/features/settings/local-agents";
import { inferVisionSupport } from "@/features/agent/models";
import { errorMessage, jsonError } from "../_lib/route-helpers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const agents = await detectLocalAgents(os.homedir());
    return NextResponse.json({ agents });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to detect local agents"), 500);
  }
}

const LocalAgentsBodySchema = Schema.Struct({
  modelId: Schema.optional(Schema.Unknown),
  targets: Schema.optional(Schema.Unknown),
});
const LocalAgentIdSchema = Schema.Literals(LOCAL_AGENT_IDS);
const LocalAgentTargetsSchema = Schema.Array(LocalAgentIdSchema);
const decodeLocalAgentsBody = Schema.decodeUnknownOption(LocalAgentsBodySchema);
const decodeModelId = Schema.decodeUnknownOption(Schema.String);
const decodeLocalAgentTargets = Schema.decodeUnknownOption(LocalAgentTargetsSchema);

const ControllerRecipeSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  model_path: Schema.String,
  served_model_name: Schema.optional(Schema.NullOr(Schema.String)),
  max_model_len: Schema.optional(Schema.Number),
});
const ControllerRecipesSchema = Schema.Array(ControllerRecipeSchema);
const ControllerModelsSchema = Schema.Struct({
  data: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        vision: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
});
const ControllerErrorSchema = Schema.Struct({
  detail: Schema.optional(Schema.String),
  error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
  message: Schema.optional(Schema.String),
});
type ControllerRecipe = typeof ControllerRecipeSchema.Type;
const decodeControllerRecipes = Schema.decodeUnknownSync(
  Schema.fromJsonString(ControllerRecipesSchema),
);
const decodeControllerModels = Schema.decodeUnknownSync(
  Schema.fromJsonString(ControllerModelsSchema),
);
const decodeControllerError = Schema.decodeUnknownOption(
  Schema.fromJsonString(ControllerErrorSchema),
);

async function controllerPayload(
  backendUrl: string,
  apiKey: string,
  endpoint: "/recipes" | "/v1/models",
): Promise<string> {
  const headers = new Headers({ accept: "application/json" });
  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
    if (endpoint === "/recipes") headers.set("X-API-Key", apiKey);
  }
  const response = await fetch(`${backendUrl}${endpoint}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) {
    const decoded = decodeControllerError(text);
    const message =
      decoded._tag === "Some"
        ? decoded.value.detail || decoded.value.error?.message || decoded.value.message
        : undefined;
    throw new Error(message || `${endpoint} returned HTTP ${response.status}`);
  }
  return text;
}

async function resolveModelImages(
  backendUrl: string,
  apiKey: string,
  recipe: ControllerRecipe,
  modelId: string,
): Promise<boolean> {
  try {
    const payload = decodeControllerModels(
      await controllerPayload(backendUrl, apiKey, "/v1/models"),
    );
    const model = payload.data?.find((entry) => entry.id === modelId);
    if (model?.vision !== undefined) return model.vision;
  } catch {}
  return inferVisionSupport(`${modelId} ${recipe.name} ${recipe.model_path}`);
}

export async function POST(request: NextRequest) {
  const denied = requireApiAccess(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body");
  }
  const decodedBody = decodeLocalAgentsBody(body);
  const decodedModelId =
    decodedBody._tag === "Some" ? decodeModelId(decodedBody.value.modelId) : decodedBody;
  if (decodedModelId._tag === "None" || !decodedModelId.value.trim()) {
    return jsonError("modelId is required");
  }
  const modelId = decodedModelId.value;
  const decodedTargets =
    decodedBody._tag === "Some" ? decodeLocalAgentTargets(decodedBody.value.targets) : decodedBody;
  if (decodedTargets._tag === "None" || decodedTargets.value.length === 0) {
    return jsonError(
      "targets must be a non-empty array of agent ids (pi, opencode, droid, hermes, omp)",
    );
  }

  const targets: LocalAgentId[] = [...decodedTargets.value];
  const settings = await getApiSettings();
  const backendUrl = settings.backendUrl.replace(/\/+$/, "");
  let recipes: ControllerRecipe[];
  try {
    recipes = [
      ...decodeControllerRecipes(await controllerPayload(backendUrl, settings.apiKey, "/recipes")),
    ];
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to fetch recipes from controller"), 502);
  }

  const recipe = recipes.find((entry) => (entry.served_model_name || entry.id) === modelId);
  if (!recipe) return jsonError(`Model not found: ${modelId}`, 404);

  const contextWindow = recipe.max_model_len || 131072;
  const images = await resolveModelImages(backendUrl, settings.apiKey, recipe, modelId);
  try {
    const results = await attachModelToAgents({
      home: os.homedir(),
      targets,
      model: {
        modelId,
        displayName: recipe.name || modelId,
        baseUrl: `${backendUrl}/v1`,
        apiKey: settings.apiKey,
        contextWindow,
        maxTokens: contextWindow,
        reasoning: true,
        images,
      },
    });
    return NextResponse.json({ results });
  } catch (error) {
    return jsonError(errorMessage(error, "Failed to attach model to local agents"), 500);
  }
}
