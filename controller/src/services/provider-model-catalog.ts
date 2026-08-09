import { Effect, Schema } from "effect";
import type { ProviderConfig } from "../config/persisted-config";

const ProviderModelsSchema = Schema.Struct({
  data: Schema.optional(Schema.Array(Schema.Struct({ id: Schema.optional(Schema.String) }))),
});

export const providerModels = (
  provider: ProviderConfig,
  timeoutMs = 10_000,
): Effect.Effect<{ provider: string; models: Array<{ id: string }> }, unknown> =>
  Effect.gen(function* () {
    const url = `${provider.base_url.replace(/\/+$/, "")}/v1/models`;
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, {
          headers: { Authorization: `Bearer ${provider.api_key}` },
          signal: AbortSignal.timeout(timeoutMs),
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
      return id ? [{ id }] : [];
    });
    return { provider: provider.id, models };
  });
