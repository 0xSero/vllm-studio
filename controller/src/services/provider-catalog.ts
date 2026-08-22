import { Effect, Schema } from "effect";
import type { ProviderConfig } from "../config/persisted-config";

const ProviderModelsSchema = Schema.Struct({
  data: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        name: Schema.optional(Schema.String),
        context_window: Schema.optional(Schema.Number),
        max_model_len: Schema.optional(Schema.Number),
        max_tokens: Schema.optional(Schema.Number),
        metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      }),
    ),
  ),
});

export type ConfiguredProviderModel = {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
};

export type ConfiguredProviderCatalog = {
  provider: string;
  models: ConfiguredProviderModel[];
};

const optionalPositive = (...values: Array<number | undefined>): number | undefined =>
  values.find((value) => value !== undefined && Number.isFinite(value) && value > 0);

export const fetchConfiguredProviderModels = (
  provider: ProviderConfig,
): Effect.Effect<ConfiguredProviderCatalog, unknown> =>
  Effect.gen(function* () {
    const url = `${provider.base_url.replace(/\/+$/, "")}/v1/models`;
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          headers: { Authorization: `Bearer ${provider.api_key}` },
          signal: AbortSignal.timeout(10_000),
        }),
      catch: (source) => source,
    });
    if (!response.ok) return yield* Effect.fail(response.status);
    const payload = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (source) => source,
    });
    const decoded = yield* Schema.decodeUnknownEffect(ProviderModelsSchema)(payload);
    const models = (decoded.data ?? []).flatMap((model) => {
      const id = model.id?.trim();
      if (!id) return [];
      const contextWindow = optionalPositive(model.context_window, model.max_model_len);
      const maxTokens = optionalPositive(model.max_tokens);
      return [
        {
          id,
          ...(model.name?.trim() ? { name: model.name.trim() } : {}),
          ...(contextWindow ? { contextWindow } : {}),
          ...(maxTokens ? { maxTokens } : {}),
          ...(model.metadata ? { metadata: model.metadata } : {}),
        },
      ];
    });
    return { provider: provider.id, models };
  });

export const listConfiguredProviderModels = (
  providers: ProviderConfig[],
): Effect.Effect<ConfiguredProviderCatalog[]> =>
  Effect.forEach(
    providers.filter((provider) => provider.enabled && provider.api_key),
    (provider) => fetchConfiguredProviderModels(provider).pipe(Effect.option),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((results) =>
      results.flatMap((result) => (result._tag === "Some" ? [result.value] : [])),
    ),
  );
