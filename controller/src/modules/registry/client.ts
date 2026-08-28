import { Effect, Schema } from "effect";
import {
  REGISTRY_DEFAULT_BASE_URL,
  RegistryHardwareSchema,
  RegistryIndexSchema,
  RegistryModelInstanceSchema,
  RegistryModelSchema,
  RegistryRecipeSchema,
  type RegistryCollection,
  type RegistryHardware,
  type RegistryIndex,
  type RegistryModel,
  type RegistryModelInstance,
  type RegistryRecipe,
} from "@local-studio/contracts/registry";

export class RegistryClientError extends Schema.TaggedErrorClass<RegistryClientError>()(
  "RegistryClientError",
  {
    operation: Schema.String,
    message: Schema.String,
    status: Schema.optional(Schema.Number),
    source: Schema.optional(Schema.Unknown),
  },
) {}

type FetchLike = typeof globalThis.fetch;

export interface RegistryClient {
  readonly index: () => Effect.Effect<RegistryIndex, RegistryClientError>;
  readonly hardware: (id: string) => Effect.Effect<RegistryHardware, RegistryClientError>;
  readonly model: (id: string) => Effect.Effect<RegistryModel, RegistryClientError>;
  readonly modelInstance: (
    id: string,
  ) => Effect.Effect<RegistryModelInstance, RegistryClientError>;
  readonly recipe: (id: string) => Effect.Effect<RegistryRecipe, RegistryClientError>;
  readonly speedSweep: (id: string) => Effect.Effect<unknown, RegistryClientError>;
  /** Drop every cached record; the next read refetches. */
  readonly invalidate: () => Effect.Effect<void>;
}

export const registryBaseUrl = (): string =>
  process.env["LOCAL_AI_REGISTRY_BASE"]?.trim() || REGISTRY_DEFAULT_BASE_URL;

const decodeCollection = {
  hardware: RegistryHardwareSchema,
  model: RegistryModelSchema,
  "model-instance": RegistryModelInstanceSchema,
  recipe: RegistryRecipeSchema,
} as const;

/**
 * One progressively-populated cache over the published registry. Discovery is a
 * single index read; every exact record is fetched on first use and memoized,
 * so browsing N recipes costs N + (models + instances) requests, not the whole
 * collection.
 */
export const makeRegistryClient = (options?: {
  baseUrl?: string;
  fetch?: FetchLike;
}): RegistryClient => {
  const baseUrl = (options?.baseUrl ?? registryBaseUrl()).replace(/\/+$/, "");
  const doFetch = options?.fetch ?? globalThis.fetch;
  const cache = new Map<string, Effect.Effect<unknown, RegistryClientError>>();

  const readPath = (path: string): Effect.Effect<unknown, RegistryClientError> =>
    Effect.tryPromise({
      try: () => doFetch(`${baseUrl}/${path}`, { signal: AbortSignal.timeout(20_000) }),
      catch: (source) =>
        new RegistryClientError({
          operation: `read ${path}`,
          message: "Registry request failed",
          source,
        }),
    }).pipe(
      Effect.flatMap((response) => {
        if (!response.ok) {
          return Effect.fail(
            new RegistryClientError({
              operation: `read ${path}`,
              message: `Registry returned HTTP ${response.status}`,
              status: response.status,
            }),
          );
        }
        return Effect.tryPromise({
          try: () => response.json(),
          catch: (source) =>
            new RegistryClientError({
              operation: `read ${path}`,
              message: "Registry sent invalid JSON",
              source,
            }),
        });
      }),
    );

  const unwrapData = (value: unknown): unknown =>
    value !== null &&
    typeof value === "object" &&
    "data" in value &&
    Object.keys(value).every((key) => key === "data" || key === "meta" || key === "links")
      ? (value as { data: unknown }).data
      : value;

  // Raw GitHub serves records as bare JSON; the published API wraps them in
  // `{data}`. Try the raw form first, fall back to the bare path for API bases.
  const readRecord = (path: string): Effect.Effect<unknown, RegistryClientError> =>
    readPath(`${path}.json`).pipe(
      Effect.catch((error) =>
        error.status === 404 ? Effect.succeed(null) : Effect.fail(error),
      ),
      Effect.flatMap((raw) =>
        raw === null
          ? readPath(path).pipe(Effect.map(unwrapData))
          : Effect.succeed(unwrapData(raw)),
      ),
    );

  const memoized = (
    key: string,
    load: () => Effect.Effect<unknown, RegistryClientError>,
  ): Effect.Effect<unknown, RegistryClientError> =>
    Effect.suspend(() => {
      const existing = cache.get(key);
      if (existing) return existing;
      // First run materializes the memoized inner effect from Effect.cached
      // and stores it; later runs replay the stored result without refetching.
      return Effect.map(Effect.cached(load()), (inner) => {
        cache.set(key, inner);
        return inner;
      }).pipe(Effect.flatten);
    });

  const record = (
    collection: RegistryCollection,
    id: string,
    schema:
      | typeof RegistryHardwareSchema
      | typeof RegistryModelSchema
      | typeof RegistryModelInstanceSchema
      | typeof RegistryRecipeSchema,
  ): Effect.Effect<unknown, RegistryClientError> =>
    memoized(`${collection}/${id}`, () =>
      readRecord(`${collection}/${id}`).pipe(
        Effect.flatMap((value) =>
          Effect.try({
            try: () => Schema.decodeUnknownSync(schema)(value),
            catch: (source) =>
              new RegistryClientError({
                operation: `${collection}/${id}`,
                message: `Registry ${collection} record failed validation`,
                source,
              }),
          }),
        ),
      ),
    );

  return {
    index: () =>
      memoized("index", () =>
        readPath("index.json").pipe(
          Effect.map(unwrapData),
          Effect.flatMap((value) =>
            Effect.try({
              try: () => Schema.decodeUnknownSync(RegistryIndexSchema)(value),
              catch: (source) =>
                new RegistryClientError({
                  operation: "index",
                  message: "Registry index failed validation",
                  source,
                }),
            }),
          ),
        ),
      ) as Effect.Effect<RegistryIndex, RegistryClientError>,
    hardware: (id) =>
      record("hardware", id, decodeCollection.hardware) as Effect.Effect<RegistryHardware, RegistryClientError>,
    model: (id) =>
      record("model", id, decodeCollection.model) as Effect.Effect<RegistryModel, RegistryClientError>,
    modelInstance: (id) =>
      record("model-instance", id, decodeCollection["model-instance"]) as Effect.Effect<RegistryModelInstance, RegistryClientError>,
    recipe: (id) =>
      record("recipe", id, decodeCollection.recipe) as Effect.Effect<RegistryRecipe, RegistryClientError>,
    speedSweep: (id) => memoized(`speed-sweeps/${id}`, () => readRecord(`speed-sweeps/${id}`)),
    invalidate: () =>
      Effect.sync(() => {
        cache.clear();
      }),
  } satisfies RegistryClient;
};
