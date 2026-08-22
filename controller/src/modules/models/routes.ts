import { basename, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { Effect, Schema } from "effect";
import { effectRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import type { AppContext } from "../../app-context";
import type { ProcessInfo, Recipe } from "../models/types";
import { resolveModelVision } from "@local-studio/contracts/model-capabilities";
import { buildModelInfo, discoverModelDirectories } from "./model-browser";
import { selectRunningRecipe } from "./recipes/recipe-matching";
import { notFound } from "../../core/errors";
import { findObservedInferenceProcess } from "../../core/function-observability";
import { fetchInference } from "../../http/local-fetch";
import { listProviderModelsCached } from "../../services/provider-routing";

interface OpenAIModelInfo {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  active: boolean;
  max_model_len?: number | null;
  metadata: Record<string, unknown>;
}

const ActiveModelsSchema = Schema.Struct({
  data: Schema.optional(
    Schema.Array(Schema.Struct({ max_model_len: Schema.optional(Schema.Number) })),
  ),
});

const HuggingFaceModelsSchema = Schema.Array(Schema.Record(Schema.String, Schema.Unknown));
const HuggingFaceModelSchema = Schema.Record(Schema.String, Schema.Unknown);

const decodeResponse = <S extends Schema.Constraint>(
  response: Response,
  schema: S,
): Effect.Effect<S["Type"], unknown, S["DecodingServices"]> =>
  Effect.tryPromise({ try: () => response.json(), catch: (source) => source }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
  );

const fetchUrl = (url: string): Effect.Effect<Response, unknown> =>
  Effect.tryPromise({ try: () => fetch(url), catch: (source) => source });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const expandUserPath = (pathValue: string): string =>
  resolve(pathValue.startsWith("~") ? pathValue.replace("~", homedir()) : pathValue);

const appendId = (index: Map<string, string[]>, key: string, recipeId: string): void => {
  const existing = index.get(key);
  if (existing) existing.push(recipeId);
  else index.set(key, [recipeId]);
};

interface ModelRoot {
  path: string;
  exists: boolean;
  sources: Set<string>;
  recipeIds: Set<string>;
}

const addRoot = (
  index: Map<string, ModelRoot>,
  pathValue: string,
  source: string,
  recipeId?: string,
): void => {
  const resolvedPath = expandUserPath(pathValue);
  const entry = index.get(resolvedPath) ?? {
    path: resolvedPath,
    exists: existsSync(resolvedPath),
    sources: new Set<string>(),
    recipeIds: new Set<string>(),
  };
  entry.sources.add(source);
  if (recipeId) entry.recipeIds.add(recipeId);
  index.set(resolvedPath, entry);
};

const resolvedRecipeMetadata = (recipe: Recipe, modelId: string): Record<string, unknown> => {
  const raw = recipe.extra_args?.["metadata"];
  const metadata = isRecord(raw) ? raw : {};
  return {
    ...metadata,
    vision: resolveModelVision({
      identifiers: [modelId, recipe.id, recipe.name, recipe.model_path],
      recipeOverride: recipe.vision,
      metadata,
    }),
  };
};

const fetchActiveModelLength = (context: AppContext): Effect.Effect<number | undefined> =>
  fetchInference(context, "/v1/models", { timeoutMs: 5000 }).pipe(
    Effect.flatMap((response) =>
      response.ok ? decodeResponse(response, ActiveModelsSchema) : Effect.succeed(null),
    ),
    Effect.catch(() => Effect.succeed(null)),
    Effect.map((active) => active?.data?.[0]?.max_model_len),
  );

const resolveActiveRecipe = (
  context: AppContext,
  recipes: readonly Recipe[],
  label: string,
): Effect.Effect<{ current: ProcessInfo | null; activeRecipe: Recipe | null }> =>
  // Several recipes can share one model path, and each would match the
  // single running process — pick the best match once so exactly one
  // entry is reported active (the rest stay listed, just inactive).
  findObservedInferenceProcess(context, label).pipe(
    Effect.map((current) => ({
      current,
      activeRecipe: current
        ? selectRunningRecipe(recipes, current, { allowEitherPathContains: true })
        : null,
    })),
  );

const toOpenAIModelInfo = (
  recipe: Recipe,
  active: boolean,
  activeMaxModelLength: number | undefined,
  now: number,
): OpenAIModelInfo => {
  const modelId = recipe.served_model_name ?? recipe.id;
  return {
    id: modelId,
    object: "model",
    created: now,
    owned_by: "local-studio",
    active,
    max_model_len: (active ? activeMaxModelLength : undefined) ?? recipe.max_model_len,
    metadata: resolvedRecipeMetadata(recipe, modelId),
  };
};

const HUGGINGFACE_SORT_FIELDS: Record<string, string> = {
  createdAt: "createdAt",
  trending: "trendingScore",
  downloads: "downloads",
  likes: "likes",
  lastModified: "lastModified",
  modified: "lastModified",
};

const normalizeHuggingFaceModel = (model: Record<string, unknown>): Record<string, unknown> => {
  const modelId = String(model["modelId"] ?? model["id"] ?? "");
  return {
    ...model,
    _id: String(model["_id"] ?? modelId),
    modelId,
    downloads: Number(model["downloads"] ?? 0),
    likes: Number(model["likes"] ?? 0),
    tags: Array.isArray(model["tags"]) ? model["tags"] : [],
    private: Boolean(model["private"]),
  };
};

export const registerModelsRoutes = defineRoutes((app, context) => {
  return mergeRoutes(
    effectRoute(app.get, "/v1/models", (ctx) =>
      Effect.gen(function* () {
        const recipes = yield* context.stores.recipeStore.list();
        const { current, activeRecipe } = yield* resolveActiveRecipe(
          context,
          recipes,
          "models.list",
        );
        const activeMaxModelLength = current ? yield* fetchActiveModelLength(context) : undefined;
        const now = Math.floor(Date.now() / 1000);
        const models: OpenAIModelInfo[] = recipes.map((recipe) =>
          toOpenAIModelInfo(recipe, recipe === activeRecipe, activeMaxModelLength, now),
        );

        if (models.length === 0 && current) {
          const inferredId =
            current.served_model_name ||
            (current.model_path ? basename(current.model_path) : "") ||
            "active-model";
          models.push({
            id: inferredId,
            object: "model",
            created: now,
            owned_by: "local-studio",
            active: true,
            max_model_len: activeMaxModelLength ?? 32768,
            metadata: { vision: resolveModelVision({ identifiers: [inferredId] }) },
          });
        }

        const providerCatalogs = yield* listProviderModelsCached(context.config.providers);
        for (const catalog of providerCatalogs) {
          for (const model of catalog.models) {
            const modelId = `${catalog.provider}/${model.id}`;
            models.push({
              id: modelId,
              object: "model",
              created: now,
              owned_by: catalog.provider,
              active: false,
              max_model_len: null,
              metadata: {
                external: true,
                provider: catalog.provider,
                vision: resolveModelVision({ identifiers: [model.id, modelId] }),
              },
            });
          }
        }

        return ctx.json({ object: "list" as const, data: models });
      }),
    ),

    effectRoute(app.get, "/v1/models/:modelId", (ctx) =>
      Effect.gen(function* () {
        const modelId = ctx.req.param("modelId");
        const recipes = yield* context.stores.recipeStore.list();
        const recipe = recipes.find(
          (entry) => entry.served_model_name === modelId || entry.id === modelId,
        );
        if (!recipe) {
          return yield* Effect.fail(notFound("Model not found"));
        }

        // Same exclusive selection as the list route: a recipe is active
        // only when it is THE best match for the running process, so the
        // detail view can never contradict the list.
        const { activeRecipe } = yield* resolveActiveRecipe(context, recipes, "models.detail");
        const isActive = activeRecipe === recipe;
        const activeMaxModelLength = isActive ? yield* fetchActiveModelLength(context) : undefined;

        return ctx.json(
          toOpenAIModelInfo(recipe, isActive, activeMaxModelLength, Math.floor(Date.now() / 1000)),
        );
      }),
    ),

    effectRoute(app.get, "/v1/studio/models", (ctx) =>
      Effect.gen(function* () {
        const recipes = yield* context.stores.recipeStore.list();
        const recipesByPath = new Map<string, string[]>();
        const recipesByBasename = new Map<string, string[]>();
        const rootIndex = new Map<string, ModelRoot>();
        addRoot(rootIndex, context.config.models_dir, "config");

        for (const recipe of recipes) {
          const modelPath = recipe.model_path?.trim();
          if (!modelPath) continue;
          appendId(recipesByBasename, basename(modelPath), recipe.id);
          if (!modelPath.startsWith("/")) continue;
          const canonical = expandUserPath(modelPath);
          appendId(recipesByPath, canonical, recipe.id);
          const parent = dirname(canonical);
          if (parent !== "/") addRoot(rootIndex, parent, "recipe_parent", recipe.id);
        }

        const roots = Array.from(rootIndex.values()).sort((left, right) =>
          left.path.localeCompare(right.path),
        );

        const modelDirectories = yield* discoverModelDirectories(
          roots.filter((root) => root.exists).map((root) => root.path),
          2,
          1000,
        );
        const models = yield* Effect.forEach(
          modelDirectories,
          (directory) => {
            const byPath = recipesByPath.get(resolve(directory)) ?? [];
            const byName = recipesByBasename.get(basename(directory)) ?? [];
            // A basename match is only trustworthy when exactly one recipe claims it.
            const recipeIds = byPath.length > 0 ? byPath : byName.length === 1 ? byName : [];
            return buildModelInfo(directory, recipeIds);
          },
          { concurrency: "unbounded" },
        );
        models.sort((left, right) =>
          String(left.name).toLowerCase().localeCompare(String(right.name).toLowerCase()),
        );

        return ctx.json({
          models,
          roots: roots.map((root) => ({
            path: root.path,
            exists: root.exists,
            sources: Array.from(root.sources).sort(),
            recipe_ids: Array.from(root.recipeIds).sort(),
          })),
          configured_models_dir: context.config.models_dir,
        });
      }),
    ),

    effectRoute(app.get, "/v1/huggingface/models", (ctx) =>
      Effect.gen(function* () {
        const search = ctx.req.query("search")?.trim() || undefined;
        const filter = ctx.req.query("filter") || undefined;
        const sort = ctx.req.query("sort")?.trim() || undefined;
        const limit = Math.min(Math.max(Number(ctx.req.query("limit") ?? 50), 1), 100);
        const offset = Math.max(Number(ctx.req.query("offset") ?? 0), 0);

        const params = new URLSearchParams({
          limit: String(Math.min(limit + offset, 500)),
          full: "false",
        });
        if (sort) params.set("sort", HUGGINGFACE_SORT_FIELDS[sort] ?? "trendingScore");
        if (search) params.set("search", search);
        if (filter) params.set("filter", filter);

        const [listResponse, exactResponse] = yield* Effect.all([
          fetchUrl(`https://huggingface.co/api/models?${params.toString()}`),
          search?.includes("/")
            ? fetchUrl(
                `https://huggingface.co/api/models/${search.split("/").map(encodeURIComponent).join("/")}`,
              )
            : Effect.succeed(null),
        ]);

        if (!listResponse.ok) {
          return Response.json(
            { detail: `HuggingFace API error: ${listResponse.status}` },
            { status: listResponse.status },
          );
        }
        const data = (yield* decodeResponse(listResponse, HuggingFaceModelsSchema)).map(
          normalizeHuggingFaceModel,
        );
        let results = data.slice(offset, offset + limit);

        if (exactResponse?.ok) {
          const exact = normalizeHuggingFaceModel(
            yield* decodeResponse(exactResponse, HuggingFaceModelSchema),
          );
          const exactId = String(exact["modelId"] ?? "").toLowerCase();
          if (exactId) {
            results = [
              exact,
              ...results.filter(
                (entry) => String(entry["modelId"] ?? "").toLowerCase() !== exactId,
              ),
            ];
          }
        }

        return ctx.json(results);
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(
            ctx.json(
              { detail: `Failed to reach HuggingFace API: ${String(error)}` },
              { status: 503 },
            ),
          ),
        ),
      ),
    ),
  );
});
