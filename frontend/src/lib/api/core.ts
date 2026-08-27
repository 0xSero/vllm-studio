import { Option, Schema } from "effect";
import { clearStoredBackendUrl, getApiKey, getStoredBackendUrl } from "./connection";
import { delay } from "../async";
import { formatHttpErrorMessage, isRetryableError } from "./http-error-message";
import {
  isBenignSseTransportFailure,
  scrubTransportFetchErrorMessage,
} from "./sse-transport-errors";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export const encodePathSegments = (path: string) =>
  path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

export interface RequestOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonRecord;
export interface JsonRecord {
  [key: string]: JsonValue;
}

export interface ChatRunStreamEvent {
  event: string;
  data: JsonRecord;
}

interface ApiHeaders {
  [header: string]: string;
}

const JsonValueSchema: Schema.Codec<JsonValue, JsonValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.mutable(Schema.Array(JsonValueSchema)),
    Schema.Record(Schema.String, JsonValueSchema),
  ]),
);
const JsonRecordSchema = Schema.Record(Schema.String, JsonValueSchema);
const SseEnvelopeSchema = Schema.Struct({
  event: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  data: Schema.optional(JsonRecordSchema),
  payload: Schema.optional(JsonRecordSchema),
});
const ErrorResponseSchema = Schema.Struct({
  detail: Schema.optional(Schema.String),
  error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
});
const decodeJsonValue = Schema.decodeUnknownSync(JsonValueSchema);
const decodeJsonRecord = Schema.decodeUnknownOption(JsonRecordSchema);
const decodeSseEnvelope = Schema.decodeUnknownOption(SseEnvelopeSchema);
const decodeErrorResponse = Schema.decodeUnknownOption(ErrorResponseSchema);
const isString = Schema.is(Schema.String);

class HttpStatusError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type RpcRequest = (
  input?: { param?: Record<string, string>; query?: Record<string, string> },
  options?: { init?: RequestInit },
) => Promise<Response>;

interface RpcRoute {
  $get: RpcRequest;
  $post: RpcRequest;
  $put: RpcRequest;
  $patch: RpcRequest;
  $delete: RpcRequest;
}

interface ControllerRpc {
  recipes: RpcRoute & { ":recipeId": RpcRoute };
  studio: {
    rigs: RpcRoute & {
      ":rigId": RpcRoute & {
        nodes: RpcRoute & { ":nodeId": RpcRoute };
      };
    };
  };
}

export type ApiCore = ReturnType<typeof createApiCore>;

export function createApiCore(params: {
  baseUrl: string;
  useProxy: boolean;
  backendUrlOverride?: string;
  apiKeyOverride?: string;
}) {
  const { baseUrl, useProxy, backendUrlOverride, apiKeyOverride } = params;
  const hasBackendUrlOverride = Boolean(backendUrlOverride?.trim());

  const normalizeSsePayload = (event: string, data: JsonRecord): ChatRunStreamEvent => {
    const envelope = Option.getOrNull(decodeSseEnvelope(data));
    const nestedEvent = envelope?.event ?? envelope?.type ?? null;
    const nestedData = envelope?.data ?? envelope?.payload ?? null;

    if ((event === "message" || event === "") && nestedEvent && nestedData) {
      return { event: nestedEvent, data: nestedData };
    }

    return { event: event || "message", data };
  };

  const maybeClearInvalidBackendOverride = (response: Response): void => {
    if (!useProxy) return;
    if (hasBackendUrlOverride) return;
    if (response.headers.get("x-backend-override-invalid") !== "1") return;
    clearStoredBackendUrl();
  };

  const shouldRetryWithoutBackendOverride = (
    response: Response,
    headers: ApiHeaders,
    retriedWithoutBackendOverride: boolean,
  ): boolean =>
    useProxy &&
    !hasBackendUrlOverride &&
    response.headers.get("x-backend-override-invalid") === "1" &&
    Boolean(headers["X-Backend-Url"]) &&
    !retriedWithoutBackendOverride;

  const responseError = async (response: Response): Promise<Error> => {
    const errorBody = decodeJsonValue(
      await response.json().catch(() => ({ detail: "Request failed" })),
    );
    return new HttpStatusError(formatHttpErrorMessage(response.status, errorBody), response.status);
  };

  const normalizeRequestError = <RequestFailure>(error: RequestFailure, timeout: number): Error => {
    if (error instanceof Error && error.name === "AbortError") {
      return new Error(`Request timeout after ${timeout}ms`);
    }
    if (error instanceof Error) return error;
    return new Error(String(error));
  };

  const shouldRetryAttempt = <RequestFailure>(
    error: RequestFailure,
    status: number | undefined,
    attempt: number,
    retries: number,
  ): boolean => attempt < retries && isRetryableError(error, status);

  const waitBeforeRetry = async (
    endpoint: string,
    attempt: number,
    retries: number,
    retryDelay: number,
    cause: string,
  ) => {
    const backoffMs = retryDelay * Math.pow(2, attempt);
    console.warn(
      `[API] Retry ${attempt + 1}/${retries} for ${endpoint} after ${backoffMs}ms ${cause}`,
    );
    await delay(backoffMs);
  };

  const buildUrl = (endpoint: string): string => {
    const path = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
    return useProxy ? `${baseUrl}/${path}` : `${baseUrl}${endpoint}`;
  };

  const buildHeaders = (extraHeaders?: HeadersInit): ApiHeaders => {
    const headers: ApiHeaders = { "Content-Type": "application/json" };

    const storedBackendUrl = backendUrlOverride?.trim() || getStoredBackendUrl();
    if (useProxy && storedBackendUrl) {
      headers["X-Backend-Url"] = storedBackendUrl;
      headers["X-Backend-Strict"] = "1";
    }

    const storedKey = apiKeyOverride === undefined ? getApiKey() : apiKeyOverride.trim();
    if (storedKey) {
      headers["Authorization"] = `Bearer ${storedKey}`;
    } else if (apiKeyOverride !== undefined) {
      headers["X-Backend-Suppress-Auth"] = "1";
    }

    if (extraHeaders) {
      const merged = new Headers(extraHeaders);
      merged.forEach((value, key) => {
        headers[key] = value;
      });
    }

    return headers;
  };

  const fetchResponse = async (
    url: string,
    endpoint: string,
    options: RequestOptions = {},
  ): Promise<Response> => {
    const {
      timeout = DEFAULT_TIMEOUT_MS,
      retries = DEFAULT_RETRIES,
      retryDelay = DEFAULT_RETRY_DELAY_MS,
      ...fetchOptions
    } = options;

    const headers = buildHeaders(fetchOptions.headers);
    let lastError: Error | null = null;
    let lastStatus: number | undefined;
    let retriedWithoutBackendOverride = false;
    const maxAttempts = retries + (useProxy && headers["X-Backend-Url"] ? 1 : 0);

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          headers: { ...headers },
          credentials: "include",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastStatus = response.status;
        maybeClearInvalidBackendOverride(response);

        if (!response.ok) {
          if (shouldRetryWithoutBackendOverride(response, headers, retriedWithoutBackendOverride)) {
            retriedWithoutBackendOverride = true;
            delete headers["X-Backend-Url"];
            continue;
          }

          lastError = await responseError(response);
          if (shouldRetryAttempt(lastError, response.status, attempt, retries)) {
            await waitBeforeRetry(
              endpoint,
              attempt,
              retries,
              retryDelay,
              `(status: ${response.status})`,
            );
            continue;
          }

          throw lastError;
        }

        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = normalizeRequestError(error, timeout);

        if (shouldRetryAttempt(error, lastStatus, attempt, retries)) {
          await waitBeforeRetry(endpoint, attempt, retries, retryDelay, `(${lastError.message})`);
          continue;
        }

        throw lastError;
      }
    }

    throw lastError || new Error("Request failed after retries");
  };

  function request<Result>(endpoint: string, options?: RequestOptions): Promise<Result>;
  async function request(endpoint: string, options: RequestOptions = {}): Promise<JsonValue> {
    const response = await fetchResponse(buildUrl(endpoint), endpoint, options);
    const text = await response.text();
    return text ? decodeJsonValue(JSON.parse(text)) : null;
  }

  const rpcFetch: typeof fetch = async (input, init) => {
    const url = isString(input) ? input : input instanceof URL ? input.href : input.url;
    return fetchResponse(url, url, init ?? {});
  };

  const rpcRequest =
    (path: string, method: string): RpcRequest =>
    (input = {}, options = {}) => {
      let resolvedPath = path;
      for (const [name, value] of Object.entries(input.param ?? {})) {
        resolvedPath = resolvedPath.replace(`:${name}`, encodeURIComponent(value));
      }
      const query = new URLSearchParams(input.query);
      const queryString = query.size > 0 ? `?${query.toString()}` : "";
      const url = `${baseUrl.replace(/\/$/, "")}/${resolvedPath}${queryString}`;
      return rpcFetch(url, { ...options.init, method });
    };

  const rpcRoute = (path: string): RpcRoute => ({
    $get: rpcRequest(path, "GET"),
    $post: rpcRequest(path, "POST"),
    $put: rpcRequest(path, "PUT"),
    $patch: rpcRequest(path, "PATCH"),
    $delete: rpcRequest(path, "DELETE"),
  });

  const recipeRoute = rpcRoute("recipes/:recipeId");
  const nodeRoute = rpcRoute("studio/rigs/:rigId/nodes/:nodeId");
  const nodesRoute = rpcRoute("studio/rigs/:rigId/nodes");
  const rigRoute = rpcRoute("studio/rigs/:rigId");
  const rigsRoute = rpcRoute("studio/rigs");
  const recipesRoute = rpcRoute("recipes");
  const rpc: ControllerRpc = {
    recipes: { ...recipesRoute, ":recipeId": recipeRoute },
    studio: {
      rigs: {
        ...rigsRoute,
        ":rigId": {
          ...rigRoute,
          nodes: { ...nodesRoute, ":nodeId": nodeRoute },
        },
      },
    },
  };

  function rpcJson<Result>(response: Promise<Response>): Promise<Result>;
  async function rpcJson(response: Promise<Response>): Promise<JsonValue> {
    return decodeJsonValue(await (await response).json());
  }

  const parseSseStream = async function* (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatRunStreamEvent> {
    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = "";
    let dataLines: string[] = [];

    const flushEvent = (): ChatRunStreamEvent | null => {
      if (dataLines.length === 0) return null;
      const dataString = dataLines.join("\n");
      let data: JsonRecord;
      try {
        data = Option.getOrElse(decodeJsonRecord(JSON.parse(dataString)), () => ({
          raw: dataString,
        }));
      } catch {
        data = { raw: dataString };
      }
      const payload = normalizeSsePayload(eventType, data);
      eventType = "";
      dataLines = [];
      return payload;
    };

    while (true) {
      let chunk: Uint8Array | undefined;
      try {
        const result = await reader.read();
        if (result.done) break;
        chunk = result.value;
      } catch (err) {
        if (isBenignSseTransportFailure(err, signal)) {
          break;
        }
        throw err;
      }

      if (!chunk) break;

      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line) {
          const payload = flushEvent();
          if (payload) yield payload;
          continue;
        }

        if (line.startsWith(":")) {
          yield { event: "keepalive", data: {} };
          continue;
        }

        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
    }

    const finalPayload = flushEvent();
    if (finalPayload) yield finalPayload;
  };

  const getSseJson = async (
    endpoint: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<AsyncGenerator<ChatRunStreamEvent>> => {
    const url = buildUrl(endpoint);
    const headers = buildHeaders({ Accept: "text/event-stream" });

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: options.signal,
      credentials: "include",
    });

    if (!response.ok || !response.body) {
      const errorBody = Option.getOrNull(
        decodeErrorResponse(await response.json().catch(() => ({ detail: "Request failed" }))),
      );
      const errorMessage =
        errorBody?.detail ?? errorBody?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }

    const reader = response.body.getReader();
    const signal = options.signal;

    if (signal) {
      const onAbort = () => {
        try {
          void reader.cancel();
        } catch {}
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    return parseSseStream(reader, signal);
  };

  const postSseJson = async <Payload>(
    endpoint: string,
    payload: Payload,
    options: { signal?: AbortSignal } = {},
  ): Promise<{ runId: string | null; stream: AsyncGenerator<ChatRunStreamEvent> }> => {
    const url = buildUrl(endpoint);
    const headers = buildHeaders({ Accept: "text/event-stream" });

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: options.signal,
        credentials: "include",
      });
    } catch (err) {
      if (err instanceof Error) {
        const cleaned = scrubTransportFetchErrorMessage(err.message);
        if (cleaned && cleaned !== err.message) {
          throw new Error(cleaned);
        }
      }
      throw err;
    }
    maybeClearInvalidBackendOverride(response);

    if (!response.ok || !response.body) {
      const errorBody = Option.getOrNull(
        decodeErrorResponse(await response.json().catch(() => ({ detail: "Request failed" }))),
      );
      const errorMessage =
        errorBody?.detail ?? errorBody?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(errorMessage);
    }

    const runId = response.headers.get("x-run-id");
    const reader = response.body.getReader();
    const signal = options.signal;

    if (signal) {
      const onAbort = () => {
        try {
          void reader.cancel();
        } catch {}
      };
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    return { runId, stream: parseSseStream(reader, signal) };
  };

  const healthPoll = async (timeoutMs = 5_000): Promise<boolean> => {
    try {
      const url = buildUrl("/health");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        credentials: "include",
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  };

  return {
    baseUrl,
    useProxy,
    buildUrl,
    buildHeaders,
    request,
    rpc,
    rpcJson,
    postSseJson,
    getSseJson,
    healthPoll,
  };
}
