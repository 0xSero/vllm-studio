import { Effect, Schema } from "effect";
import { createApiClient } from "@/lib/api/create-api-client";
import {
  loadSavedControllers,
  normalizeControllerUrl,
  saveSavedControllers,
} from "@/lib/api/controllers";
import { clearApiKey, setStoredBackendUrl } from "@/lib/api/connection";
import { scheduleDurableUiPreferencesSave } from "@/lib/desktop-ui-preferences";

const SettingsSaveResponseSchema = Schema.Struct({ success: Schema.Boolean });
const HEAD_PROBE_REQUEST = { timeout: 10_000, retries: 0 } as const;

function headProbeError(cause: unknown): Error {
  const status = cause instanceof Error ? (cause as Error & { status?: number }).status : undefined;
  if (status === 404) {
    return new Error("That controller is reachable, but it is not running in Head mode");
  }
  return new Error(
    cause instanceof Error
      ? `Could not connect to the Head: ${cause.message}`
      : "Could not connect to the Head",
  );
}

function requireHeadUrl(value: string): string {
  const normalized = normalizeControllerUrl(value);
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return normalized;
  } catch {
    throw new Error("Enter the full Head controller URL, for example http://192.168.1.90:8080");
  }
}

const connectHeadEffect = (input: { name: string; url: string }) =>
  Effect.gen(function* () {
    const url = requireHeadUrl(input.url);
    const probe = createApiClient({
      baseUrl: "/api/proxy",
      useProxy: true,
      backendUrlOverride: url,
      apiKeyOverride: "",
    });

    const workerPayload = yield* Effect.tryPromise({
      try: () => probe.getWorkers(HEAD_PROBE_REQUEST),
      catch: headProbeError,
    });

    if (workerPayload.mode !== "head") {
      return yield* Effect.fail(new Error("That controller is not running in Head mode"));
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ backendUrl: url, apiKey: "" }),
        }),
      catch: (cause) =>
        new Error(
          cause instanceof Error
            ? `Connected, but could not save the Head: ${cause.message}`
            : "Connected, but could not save the Head",
        ),
    });

    if (!response.ok) {
      return yield* Effect.fail(
        new Error(`Connected, but could not save the Head (${response.status})`),
      );
    }

    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new Error("Connected, but the desktop could not confirm the saved Head"),
    });
    yield* Schema.decodeUnknownEffect(SettingsSaveResponseSchema)(body).pipe(
      Effect.mapError(
        () => new Error("Connected, but the desktop could not confirm the saved Head"),
      ),
    );

    const controllers = loadSavedControllers().filter(
      (controller) => normalizeControllerUrl(controller.url) !== url,
    );
    saveSavedControllers([...controllers, { url, name: input.name.trim() || "Studio Head" }]);
    clearApiKey();
    setStoredBackendUrl(url);
    scheduleDurableUiPreferencesSave();
    return url;
  });

export const connectHead = (input: { name: string; url: string }): Promise<string> =>
  Effect.runPromise(connectHeadEffect(input));
