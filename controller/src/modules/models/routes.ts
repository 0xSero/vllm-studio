import { basename, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { Effect, Option, Schema } from "effect";
import { effectRoute, defineRoutes, mergeRoutes } from "../../http/route-registrar";
import type { Recipe } from "../models/types";
import type { RecipeExtraArgument } from "@local-studio/contracts/recipes";
import { recipeExtraArgumentsSchema } from "./recipes/recipe-serializer";
import { resolveModelVision } from "@local-studio/contracts/model-capabilities";

interface OpenAIModelInfo {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  active: boolean;
  max_model_len?: number | null;
  metadata: Schema.Schema.Type<typeof recipeExtraArgumentsSchema>;
}

const ActiveModelsSchema = Schema.Struct({
  data: Schema.optional(
    Schema.Array(Schema.Struct({ max_model_len: Schema.optional(Schema.Number) })),
  ),
});

const HuggingFaceModelSchema = recipeExtraArgumentsSchema;
const HuggingFaceModelsSchema = Schema.Array(HuggingFaceModelSchema);
type HuggingFaceModel = Schema.Schema.Type<typeof HuggingFaceModelSchema>;

const decodeResponse = <S extends Schema.Constraint>(
  response: Response,
  schema: S,
): Effect.Effect<S["Type"], unknown, S["DecodingServices"]> =>
  Effect.tryPromise({ try: () => response.json(), catch: (source) => source }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
  );
import { buildModelInfo, discoverModelDirectories } from "./model-browser";
import { selectRunningRecipe } from "./recipes/recipe-matching";
import { notFound } from "../../core/errors";
import { findObservedInferenceProcess } from "../../core/function-observability";
import { fetchInference } from "../../http/local-fetch";
import { listProviderModelsCached } from "../../services/provider-routing";

const decodeMetadata = Schema.decodeUnknownOption(recipeExtraArgumentsSchema);
const decodeString = Schema.decodeUnknownOption(Schema.String);

function recipeMetadata(recipe: Recipe): HuggingFaceModel {
  return Option.getOrElse(decodeMetadata(recipe.extra_args?.["metadata"]), () => ({}));
}

function resolvedRecipeMetadata(recipe: Recipe, modelId: string): HuggingFaceModel {
  const metadata = recipeMetadata(recipe);
  return {
    ...metadata,
    vision: resolveModelVision({
      identifiers: [modelId, recipe.id, recipe.name, recipe.model_path],
      recipeOverride: recipe.vision,
      metadata,
    }),
  };
}

const stringValue = (value: RecipeExtraArgument | undefined): string =>
  Option.getOrElse(decodeString(value), () => "");

const localModelInfo = (
  recipe: Recipe,
  activeRecipe: Recipe | null,
  activeMaxModelLength: number | undefined,
  created: number,
): OpenAIModelInfo => {
  const active = recipe === activeRecipe;
  const modelId = recipe.served_model_name ?? recipe.id;
  return {
    id: modelId,
    object: "model",
    created,
    owned_by: "local-studio",
    active,
    max_model_len: active && activeMaxModelLength ? activeMaxModelLength : recipe.max_model_len,
    metadata: resolvedRecipeMetadata(recipe, modelId),
  };
};

export const registerModelsRoutes = defineRoutes((app, context) => {
  const activeMaxModelLength = (): Effect.Effect<number | undefined, unknown> =>
    fetchInference(context, "/v1/models", { timeoutMs: 5000 }).pipe(
      Effect.flatMap((response) =>
        response.ok ? decodeResponse(response, ActiveModelsSchema) : Effect.succeed(null),
      ),
      Effect.catch(() => Effect.succeed(null)),
      Effect.map((data) => data?.data?.[0]?.max_model_len),
    );
  return mergeRoutes(
    effectRoute(app.get, "/v1/models", (ctx) =>
      Effect.gen(function* () {
        const recipes = yield* context.stores.recipeStore.list();
        const current = yield* findObservedInferenceProcess(context, "models.list");
        const activeMaxLength = current ? yield* activeMaxModelLength() : undefined;

        const now = Math.floor(Date.now() / 1000);
        // Several recipes can share one model path. Pick one best match so only
        // one entry is reported active.
        const activeRecipe = current
          ? selectRunningRecipe(recipes, current, { allowEitherPathContains: true })
          : null;

        const models = recipes.map((recipe) =>
          localModelInfo(recipe, activeRecipe, activeMaxLength, now),
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
            max_model_len: activeMaxLength ?? 32768,
            metadata: { vision: resolveModelVision({ identifiers: [inferredId] }) },
          });
        }

        const providerCatalogs = yield* listProviderModelsCached(context.config.providers);
        models.push(
          ...providerCatalogs.flatMap((catalog) =>
            catalog.models.map((model): OpenAIModelInfo => {
              const modelId = `${catalog.provider}/${model.id}`;
              return {
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
              };
            }),
          ),
        );

        const payload = { object: "list" as const, data: models };
        return ctx.json(payload);
      }),
    ),

    effectRoute(app.get, "/v1/models/:modelId", (ctx) =>
      Effect.gen(function* () {
        const modelId = ctx.req.param("modelId");
        const recipes = yield* context.stores.recipeStore.list();
        const recipe =
          recipes.find((entry) => entry.served_model_name === modelId || entry.id === modelId) ??
          null;
        if (!recipe) {
          return yield* Effect.fail(notFound("Model not found"));
        }

        const current = yield* findObservedInferenceProcess(context, "models.detail");
        let isActive = false;
        let maxModelLength = recipe.max_model_len;
        // Same exclusive selection as the list route: a recipe is active
        // only when it is THE best match for the running process, so the
        // detail view can never contradict the list.
        if (
          current &&
          selectRunningRecipe(recipes, current, { allowEitherPathContains: true }) === recipe
        ) {
          isActive = true;
          maxModelLength = (yield* activeMaxModelLength()) ?? recipe.max_model_len;
        }

        const payload: OpenAIModelInfo = {
          id: recipe.served_model_name ?? recipe.id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "local-studio",
          active: isActive,
          max_model_len: maxModelLength,
          metadata: resolvedRecipeMetadata(recipe, recipe.served_model_name ?? recipe.id),
        };

        return ctx.json(payload);
      }),
    ),

    effectRoute(app.get, "/v1/studio/models", (ctx) =>
      Effect.gen(function* () {
        const recipes = yield* context.stores.recipeStore.list();
        const recipesByPath = new Map<string, string[]>();
        const recipesByBasename = new Map<string, string[]>();

        const expandUserPath = (pathValue: string): string => {
          if (pathValue.startsWith("~")) {
            return resolve(pathValue.replace("~", homedir()));
          }
          return resolve(pathValue);
        };

        for (const recipe of recipes) {
          const modelPath = recipe.model_path?.trim();
          if (!modelPath) {
            continue;
          }
          const name = basename(modelPath);
          const existingNames = recipesByBasename.get(name) ?? [];
          existingNames.push(recipe.id);
          recipesByBasename.set(name, existingNames);
          if (modelPath.startsWith("/")) {
            const canonical = expandUserPath(modelPath);
            const existingPaths = recipesByPath.get(canonical) ?? [];
            existingPaths.push(recipe.id);
            recipesByPath.set(canonical, existingPaths);
          }
        }

        const rootIndex = new Map<
          string,
          { path: string; exists: boolean; sources: Set<string>; recipeIds: Set<string> }
        >();

        const addRoot = (pathValue: string, source: string, recipeId?: string): void => {
          const resolvedPath = expandUserPath(pathValue);
          const entry = rootIndex.get(resolvedPath) ?? {
            path: resolvedPath,
            exists: existsSync(resolvedPath),
            sources: new Set<string>(),
            recipeIds: new Set<string>(),
          };
          entry.sources.add(source);
          if (recipeId) {
            entry.recipeIds.add(recipeId);
          }
          rootIndex.set(resolvedPath, entry);
        };

        addRoot(context.config.models_dir, "config");

        for (const recipe of recipes) {
          const modelPath = recipe.model_path?.trim();
          if (!modelPath || !modelPath.startsWith("/")) {
            continue;
          }
          const parent = dirname(expandUserPath(modelPath));
          if (parent === "/") {
            continue;
          }
          addRoot(parent, "recipe_parent", recipe.id);
        }

        const roots = Array.from(rootIndex.values()).sort((left, right) =>
          left.path.localeCompare(right.path),
        );
        const scanRoots = roots.filter((root) => root.exists).map((root) => root.path);

        const modelDirectories = yield* discoverModelDirectories(scanRoots, 2, 1000);
        const models = yield* Effect.forEach(
          modelDirectories,
          (directory) => {
            const canonical = resolve(directory);
            let recipeIds = recipesByPath.get(canonical) ?? [];
            if (recipeIds.length === 0) {
              const byName = recipesByBasename.get(basename(directory)) ?? [];
              if (byName.length === 1) {
                recipeIds = [...byName];
              }
            }
            return buildModelInfo(directory, recipeIds);
          },
          { concurrency: "unbounded" },
        );
        models.sort((left, right) =>
          String(left.name).toLowerCase().localeCompare(String(right.name).toLowerCase()),
        );

        const rootsPayload = roots.map((root) => ({
          path: root.path,
          exists: Boolean(root.exists),
          sources: Array.from(root.sources).sort(),
          recipe_ids: Array.from(root.recipeIds).sort(),
        }));

        return ctx.json({
          models,
          roots: rootsPayload,
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

        const sortMapping = new Map([
          ["createdAt", "createdAt"],
          ["trending", "trendingScore"],
          ["downloads", "downloads"],
          ["likes", "likes"],
          ["lastModified", "lastModified"],
          ["modified", "lastModified"],
        ]);
        const hfSort = sort ? (sortMapping.get(sort) ?? "trendingScore") : undefined;
        const requestLimit = Math.min(limit + offset, 500);
        const params = new URLSearchParams({
          limit: String(requestLimit),
          full: "false",
        });
        if (hfSort) {
          params.set("sort", hfSort);
        }
        if (search) {
          params.set("search", search);
        }
        if (filter) {
          params.set("filter", filter);
        }

        const normalize = (model: HuggingFaceModel): HuggingFaceModel => {
          const modelId = stringValue(model["modelId"]) || stringValue(model["id"]);
          return {
            ...model,
            _id: stringValue(model["_id"]) || modelId,
            modelId,
            downloads: Number(model["downloads"] ?? 0),
            likes: Number(model["likes"] ?? 0),
            tags: Array.isArray(model["tags"]) ? model["tags"] : [],
            private: Boolean(model["private"]),
          };
        };

        const url = `https://huggingface.co/api/models?${params.toString()}`;
        return yield* Effect.all([
          Effect.tryPromise({ try: () => fetch(url), catch: (source) => source }),
          search && search.includes("/")
            ? Effect.tryPromise({
                try: () =>
                  fetch(
                    `https://huggingface.co/api/models/${search.split("/").map(encodeURIComponent).join("/")}`,
                  ),
                catch: (source) => source,
              })
            : Effect.succeed(null),
        ]).pipe(
          Effect.flatMap(([listResponse, exactResponse]) =>
            Effect.gen(function* () {
              if (!listResponse.ok) {
                return Response.json(
                  { detail: `HuggingFace API error: ${listResponse.status}` },
                  { status: listResponse.status },
                );
              }
              const data = (yield* decodeResponse(listResponse, HuggingFaceModelsSchema)).map(
                normalize,
              );
              let results = data.slice(offset, offset + limit);

              if (exactResponse?.ok) {
                const exact = normalize(
                  yield* decodeResponse(exactResponse, HuggingFaceModelSchema),
                );
                const exactId = stringValue(exact["modelId"]).toLowerCase();
                if (exactId) {
                  results = [
                    exact,
                    ...results.filter(
                      (entry) => stringValue(entry["modelId"]).toLowerCase() !== exactId,
                    ),
                  ];
                }
              }

              return ctx.json(results);
            }),
          ),
          Effect.catch((error) =>
            Effect.succeed(
              ctx.json(
                { detail: `Failed to reach HuggingFace API: ${String(error)}` },
                { status: 503 },
              ),
            ),
          ),
        );
      }),
    ),
  );
});
