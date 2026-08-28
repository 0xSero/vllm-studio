import { Effect, Schema } from "effect";
import { badRequest, HttpStatus } from "../../core/errors";
import { decodeJsonBody } from "../../core/validation";
import { defineRoutes, effectRoute, mergeRoutes } from "../../http/route-registrar";
import type { AppContext } from "../../app-context";
import type { RegistryCollection } from "@local-studio/contracts/registry";
import { makeRegistryClient, RegistryClientError, registryBaseUrl } from "./client";
import { buildRecommendations } from "./recommendations";
import { detectedAppleSilicon, detectedFromGpus, matchAccelerators } from "./hardware-match";
import { getGpuInfo } from "../system/platform/gpu";
import { recipeToLaunchInput } from "../compute/active-model";
import {
  makeShareService,
  shareDependenciesFromContext,
  shareErrorStatus,
  type ShareError,
  type ShareService,
} from "./share";

const COLLECTIONS: readonly RegistryCollection[] = [
  "hardware",
  "model",
  "model-instance",
  "recipe",
  "speed-sweeps",
];

let registryClient: ReturnType<typeof makeRegistryClient> | null = null;
let shareService: ShareService | null = null;

/** Test seam: drop the process-wide clients so the next request rebuilds them. */
export const resetRegistryClients = (): void => {
  registryClient = null;
  shareService = null;
};

const registryFor = (): ReturnType<typeof makeRegistryClient> => {
  if (!registryClient) registryClient = makeRegistryClient();
  return registryClient;
};

const shareFor = (context: AppContext): ShareService => {
  if (!shareService) {
    shareService = makeShareService(
      shareDependenciesFromContext({
        stores: context.stores,
        compute: {
          host: context.compute.host,
          instances: () => context.compute.service.instances(),
        },
        config: context.config,
        toLaunchInput: (recipe) => recipeToLaunchInput(recipe, context.config, []),
      }),
    );
  }
  return shareService;
};

const registryError = (error: RegistryClientError): HttpStatus =>
  new HttpStatus({ status: 502, detail: `local-ai-registry: ${error.message}` });

const shareFailure = (error: ShareError): HttpStatus =>
  new HttpStatus({ status: shareErrorStatus(error), detail: error.message });

const hardwareMatches = () =>
  Effect.gen(function* () {
    const client = registryFor();
    const [gpus, index] = yield* Effect.all([
      getGpuInfo().pipe(Effect.orElseSucceed(() => [])),
      client.index().pipe(Effect.mapError(registryError)),
    ]);
    const hardware = yield* Effect.forEach(
      index.collections["hardware"] ?? [],
      (id) => client.hardware(id).pipe(Effect.mapError(registryError)),
      { concurrency: 8 },
    );
    const detected = [...detectedFromGpus(gpus), ...detectedAppleSilicon(null)];
    return { index, hardware, matches: matchAccelerators(detected, hardware) };
  });

export const registerRegistryRoutes = defineRoutes((app, context) =>
  mergeRoutes(
    effectRoute(app.get, "/registry/index", (ctx) =>
      Effect.gen(function* () {
        if (ctx.req.query("refresh") === "1") registryFor().invalidate();
        const index = yield* registryFor().index().pipe(Effect.mapError(registryError));
        return ctx.json({
          data: index,
          meta: { base_url: registryBaseUrl(), source: "local-ai-registry" },
        });
      }),
    ),

    effectRoute(app.get, "/registry/recommendations", (ctx) =>
      Effect.gen(function* () {
        if (ctx.req.query("refresh") === "1") registryFor().invalidate();
        const { index, hardware, matches } = yield* hardwareMatches();
        const payload = buildRecommendations(
          index,
          matches,
          ctx.req.query("all") === "1",
          registryBaseUrl(),
          new Date().toISOString(),
        );
        const matchedIds = new Set(matches.filter((m) => m.matched).map((m) => m.hardware_id));
        return ctx.json({
          ...payload,
          hardware_records: Object.fromEntries(
            hardware.filter((entry) => matchedIds.has(entry.id)).map((entry) => [entry.id, entry]),
          ),
        });
      }),
    ),

    effectRoute(app.get, "/registry/hardware/matches", (ctx) =>
      Effect.gen(function* () {
        void ctx;
        const { hardware, matches } = yield* hardwareMatches();
        const matchedIds = new Set(matches.filter((m) => m.matched).map((m) => m.hardware_id));
        return ctx.json({
          matches,
          records: Object.fromEntries(
            hardware.filter((entry) => matchedIds.has(entry.id)).map((entry) => [entry.id, entry]),
          ),
        });
      }),
    ),

    effectRoute(app.get, "/registry/records/:collection/:id", (ctx) =>
      Effect.gen(function* () {
        const collection = (ctx.req.param("collection") ?? "") as RegistryCollection;
        const id = ctx.req.param("id") ?? "";
        if (!COLLECTIONS.includes(collection)) {
          return yield* Effect.fail(badRequest(`Unknown registry collection ${collection}`));
        }
        const client = registryFor();
        const record =
          collection === "speed-sweeps"
            ? yield* client.speedSweep(id).pipe(Effect.mapError(registryError))
            : collection === "hardware"
              ? yield* client.hardware(id).pipe(Effect.mapError(registryError))
              : collection === "model"
                ? yield* client.model(id).pipe(Effect.mapError(registryError))
                : collection === "model-instance"
                  ? yield* client.modelInstance(id).pipe(Effect.mapError(registryError))
                  : yield* client.recipe(id).pipe(Effect.mapError(registryError));
        return ctx.json({ data: record, meta: { collection, id } });
      }),
    ),

    effectRoute(app.get, "/registry/share/notice", (ctx) =>
      Effect.gen(function* () {
        void context;
        const { SHARE_PR_NOTICE } = yield* Effect.promise(() => import("./share"));
        return ctx.json({ notice: SHARE_PR_NOTICE });
      }),
    ),

    effectRoute(app.get, "/registry/share/preview", (ctx) =>
      Effect.gen(function* () {
        const recipeId = ctx.req.query("recipe_id")?.trim() ?? "";
        if (!recipeId) return yield* Effect.fail(badRequest("recipe_id is required"));
        const payload = yield* shareFor(context)
          .preview(recipeId)
          .pipe(Effect.mapError(shareFailure));
        return ctx.json(payload);
      }),
    ),

    effectRoute(app.post, "/registry/share/pr", (ctx) =>
      Effect.gen(function* () {
        const body = yield* decodeJsonBody(
          ctx,
          Schema.Struct({
            recipe_id: Schema.String,
            confirm: Schema.Boolean,
          }),
        );
        const result = yield* shareFor(context)
          .createPullRequest(body.recipe_id, body.confirm)
          .pipe(Effect.mapError(shareFailure));
        return ctx.json(result);
      }),
    ),
  ),
);
