import { resolve } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import cursorExtension from "@rahularya01/pi-cursor";
import { Effect, Schema } from "effect";
import { createCursorResponsesFromStream } from "./responses";

const BridgeRequestSchema = Schema.Struct({
  dataDirectory: Schema.String,
  modelId: Schema.String,
  request: Schema.Record(Schema.String, Schema.Unknown),
});

const readInput = async (): Promise<string> => {
  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  return input;
};

const modelFromConfig = (provider: ProviderConfig, modelId: string): Model<Api> | null => {
  const model = provider.models?.find((candidate) => candidate.id === modelId);
  const api = model?.api ?? provider.api;
  const baseUrl = model?.baseUrl ?? provider.baseUrl;
  if (!model || !api || !baseUrl) return null;
  return {
    id: model.id,
    name: model.name,
    api,
    provider: "cursor",
    baseUrl,
    reasoning: model.reasoning,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
    ...(model.headers ? { headers: model.headers } : {}),
    ...(model.compat ? { compat: model.compat } : {}),
  };
};

const extensionApi = (capture: (provider: ProviderConfig) => void): ExtensionAPI => {
  const target = {
    on: (..._args: unknown[]): void => undefined,
    registerCommand: (..._args: unknown[]): void => undefined,
    registerProvider: (providerId: unknown, config: unknown): void => {
      if (providerId !== "cursor" || !config || typeof config !== "object") {
        throw new Error("Cursor provider registration is invalid");
      }
      capture(config as ProviderConfig);
    },
  };
  return new Proxy(target, {
    get(value, property): unknown {
      if (property in value) return value[property as keyof typeof value];
      throw new Error(`Cursor requested unsupported extension API '${String(property)}'`);
    },
  }) as unknown as ExtensionAPI;
};

const run = Effect.gen(function* () {
  const input = yield* Effect.tryPromise({
    try: readInput,
    catch: (cause) => new Error("Unable to read Cursor provider request", { cause }),
  });
  const decoded = yield* Effect.try({
    try: () => Schema.decodeUnknownSync(BridgeRequestSchema)(JSON.parse(input)),
    catch: (cause) => new Error("Invalid Cursor provider request", { cause }),
  });
  const runtimeDirectory = resolve(decoded.dataDirectory, "providers", "cursor");
  process.env["PI_CODING_AGENT_DIR"] = runtimeDirectory;
  process.env["PI_CURSOR_CACHE_DIR"] = resolve(runtimeDirectory, "cache");
  process.env["PI_CURSOR_SYSTEM_CREDENTIALS"] = "1";
  process.env["PI_CURSOR_AGENT_URL"] ??= "https://agentn.us.api5.cursor.sh";
  let provider: ProviderConfig | null = null;
  yield* Effect.tryPromise({
    try: () => cursorExtension(extensionApi((value) => (provider = value))),
    catch: (cause) => new Error("Unable to initialize Cursor provider", { cause }),
  });
  const registered = provider as ProviderConfig | null;
  if (!registered?.streamSimple)
    return yield* Effect.fail(new Error("Cursor provider transport is unavailable"));
  let model = modelFromConfig(registered, decoded.modelId);
  if (!model && registered.refreshModels) {
    const refreshed = yield* Effect.tryPromise({
      try: () =>
        registered.refreshModels!({
          allowNetwork: true,
          force: true,
          store: {
            read: () => Promise.resolve(undefined),
            write: () => Promise.resolve(),
            delete: () => Promise.resolve(),
          },
        }),
      catch: (cause) => new Error("Unable to refresh Cursor models", { cause }),
    });
    registered.models = refreshed;
    model = modelFromConfig(registered, decoded.modelId);
  }
  if (!model) return yield* Effect.fail(new Error(`Unknown Cursor model '${decoded.modelId}'`));
  const abort = new AbortController();
  const result = yield* Effect.tryPromise({
    try: () =>
      createCursorResponsesFromStream(
        registered.streamSimple!,
        model,
        decoded.request,
        abort.signal,
      ),
    catch: (cause) => new Error("Cursor provider request failed", { cause }),
  });
  const body = yield* Effect.tryPromise({
    try: () => result.response.arrayBuffer(),
    catch: (cause) => new Error("Unable to read Cursor provider response", { cause }),
  });
  yield* Effect.tryPromise({
    try: () =>
      new Promise<void>((resolveWrite, rejectWrite) => {
        process.stdout.write(Buffer.from(body), (error) => {
          if (error) rejectWrite(error);
          else resolveWrite();
        });
      }),
    catch: (cause) => new Error("Unable to write Cursor provider response", { cause }),
  });
});

Effect.runPromise(run).then(
  () => process.exit(0),
  (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`${message}\n`, () => process.exit(1));
  },
);
