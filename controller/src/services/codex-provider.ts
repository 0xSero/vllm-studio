import { randomUUID } from "node:crypto";
import { hostname, platform, release } from "node:os";
import {
  createModels,
  type AuthEvent,
  type AuthInteraction,
  type AuthPrompt,
  type Api,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import type {
  ProviderAuthType,
  ProviderLoginEvent,
  ProviderLoginEventPayload,
  ProviderLoginJobView,
  ProviderLoginPrompt,
  ProviderView,
} from "@local-studio/contracts/provider-auth";
import { Effect } from "effect";
import { redactLogLine } from "../core/log-redaction";
import type { HeadResponsesProviderAdapter } from "./head-provider";
import { OAuthCredentialStore } from "./oauth-credential-store";

export const CODEX_PROVIDER_ID = "openai-codex";

const MAX_JOB_EVENTS = 200;
const MAX_FINISHED_JOBS = 8;
const CODEX_ACCOUNT_CLAIM = "https://api.openai.com/auth";

type LoginJob = {
  jobId: string;
  status: ProviderLoginJobView["status"];
  error?: string;
  events: ProviderLoginEvent[];
  eventSeq: number;
  promptSeq: number;
  pending: {
    prompt: ProviderLoginPrompt;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  } | null;
  abort: AbortController;
  finishedAt: number | null;
};

export type CodexModelView = {
  id: string;
  name: string;
  api: "openai-responses";
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  vision: boolean;
};

export type CodexResponsesCompletion = {
  response: Record<string, unknown>;
  status: number;
};

const serializeAuthEvent = (event: AuthEvent): ProviderLoginEventPayload => {
  switch (event.type) {
    case "auth_url":
      return {
        type: "auth_url",
        url: event.url,
        ...(event.instructions ? { instructions: event.instructions } : {}),
      };
    case "device_code":
      return {
        type: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds === undefined ? {} : { intervalSeconds: event.intervalSeconds }),
        ...(event.expiresInSeconds === undefined
          ? {}
          : { expiresInSeconds: event.expiresInSeconds }),
      };
    case "progress":
      return { type: "progress", message: event.message };
    case "info":
      return {
        type: "info",
        message: event.message,
        ...(event.links?.length
          ? { links: event.links.map(({ url, label }) => ({ url, ...(label ? { label } : {}) })) }
          : {}),
      };
  }
};

const serializePrompt = (job: LoginJob, prompt: AuthPrompt): ProviderLoginPrompt => {
  job.promptSeq += 1;
  return {
    id: job.promptSeq,
    type: prompt.type,
    message: prompt.message,
    ...("placeholder" in prompt && prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
    ...(prompt.type === "select" ? { options: prompt.options } : {}),
  };
};

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const value = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const accountIdFromToken = (token: string): string => {
  const payload = decodeJwtPayload(token);
  const auth = payload?.[CODEX_ACCOUNT_CLAIM];
  const accountId =
    auth && typeof auth === "object" && !Array.isArray(auth)
      ? (auth as Record<string, unknown>)["chatgpt_account_id"]
      : undefined;
  if (typeof accountId !== "string" || !accountId) {
    throw new Error("The OpenAI credential does not contain a ChatGPT account ID");
  }
  return accountId;
};

const responseEndpoint = (baseUrl: string): string => {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/codex/responses")) return normalized;
  if (normalized.endsWith("/codex")) return `${normalized}/responses`;
  return `${normalized}/codex/responses`;
};

const normalizeResponseStatus = (status: unknown): string | undefined => {
  if (typeof status !== "string") return undefined;
  return ["completed", "incomplete", "failed", "cancelled", "queued", "in_progress"].includes(
    status,
  )
    ? status
    : undefined;
};

const normalizeCodexEvent = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const type = event["type"];
  if (type !== "response.done" && type !== "response.completed" && type !== "response.incomplete") {
    return event;
  }
  const rawResponse = event["response"];
  const response =
    rawResponse && typeof rawResponse === "object" && !Array.isArray(rawResponse)
      ? (rawResponse as Record<string, unknown>)
      : null;
  return {
    ...event,
    type: "response.completed",
    ...(response
      ? {
          response: {
            ...response,
            ...(normalizeResponseStatus(response["status"])
              ? { status: normalizeResponseStatus(response["status"]) }
              : {}),
          },
        }
      : {}),
  };
};

const normalizeSse = (
  body: ReadableStream<Uint8Array>,
): { stream: ReadableStream<Uint8Array>; completion: Promise<Record<string, unknown> | null> } => {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let settled = false;
  let resolveCompletion: (value: Record<string, unknown> | null) => void = () => undefined;
  const completion = new Promise<Record<string, unknown> | null>((resolve) => {
    resolveCompletion = resolve;
  });
  const settle = (value: Record<string, unknown> | null): void => {
    if (settled) return;
    settled = true;
    resolveCompletion(value);
  };
  const nextBoundary = (): { index: number; length: number } | null => {
    const match = /\r?\n\r?\n/.exec(buffer);
    return match ? { index: match.index, length: match[0].length } : null;
  };
  const normalizeBlock = (block: string): string => {
    const lines = block.split(/\r?\n/);
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return block;
    try {
      const event = normalizeCodexEvent(JSON.parse(data));
      if (!event) return block;
      if (event["type"] === "response.completed") {
        const response = event["response"];
        settle(
          response && typeof response === "object" && !Array.isArray(response)
            ? (response as Record<string, unknown>)
            : null,
        );
      }
      return `data: ${JSON.stringify(event)}`;
    } catch {
      return block;
    }
  };
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller): void {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary = nextBoundary();
        while (boundary) {
          const block = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary.length);
          controller.enqueue(encoder.encode(`${normalizeBlock(block)}\n\n`));
          boundary = nextBoundary();
        }
      },
      flush(controller): void {
        buffer += decoder.decode();
        if (buffer.trim()) controller.enqueue(encoder.encode(normalizeBlock(buffer)));
        settle(null);
      },
    }),
  );
  return { stream, completion };
};

export class CodexProviderService implements HeadResponsesProviderAdapter {
  public readonly id = CODEX_PROVIDER_ID;
  public readonly api = "openai-responses" as const;
  readonly #models: MutableModels;
  readonly #jobs = new Map<string, LoginJob>();

  public constructor(dataDirectory: string) {
    this.#models = createModels({
      credentials: new OAuthCredentialStore(dataDirectory, "openai-codex.json", "OpenAI Codex"),
    });
    this.#models.setProvider(openaiCodexProvider());
  }

  #configured(): Promise<boolean> {
    return this.#models.checkAuth(CODEX_PROVIDER_ID).then(Boolean);
  }

  public view(): Promise<ProviderView> {
    const provider = this.#models.getProvider(CODEX_PROVIDER_ID);
    if (!provider) throw new Error("OpenAI Codex provider is unavailable");
    return this.#configured().then((configured) => ({
      id: provider.id,
      name: provider.name,
      oauth: { label: provider.auth.oauth?.name ?? "OpenAI (ChatGPT subscription)" },
      configured,
      ...(configured ? { authSource: "controller", authLabel: "ChatGPT OAuth" } : {}),
      ...(configured ? { credentialType: "oauth" as const } : {}),
      modelCount: provider.getModels().length,
      controllerOwned: true,
    }));
  }

  public models(): Promise<CodexModelView[]> {
    return this.#configured().then((configured) =>
      configured
        ? this.#models.getModels(CODEX_PROVIDER_ID).map((model) => ({
            id: model.id,
            name: model.name,
            api: "openai-responses" as const,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            reasoning: model.reasoning,
            vision: model.input.includes("image"),
          }))
        : [],
    );
  }

  #pushEvent(job: LoginJob, event: AuthEvent): void {
    job.eventSeq += 1;
    job.events.push({ seq: job.eventSeq, event: serializeAuthEvent(event) });
    if (job.events.length > MAX_JOB_EVENTS) {
      job.events.splice(0, job.events.length - MAX_JOB_EVENTS);
    }
  }

  #parkPrompt(job: LoginJob, prompt: AuthPrompt): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const pending = {
        prompt: serializePrompt(job, prompt),
        resolve: (value: string): void => {
          cleanup();
          resolve(value);
        },
        reject: (error: Error): void => {
          cleanup();
          reject(error);
        },
      };
      const onAbort = (): void => pending.reject(new Error("Prompt cancelled"));
      const cleanup = (): void => {
        if (job.pending === pending) job.pending = null;
        prompt.signal?.removeEventListener("abort", onAbort);
      };
      job.pending?.reject(new Error("Prompt superseded"));
      job.pending = pending;
      prompt.signal?.addEventListener("abort", onAbort);
      if (prompt.signal?.aborted) onAbort();
    });
  }

  #finish(job: LoginJob, status: LoginJob["status"], error?: string): void {
    if (job.status !== "running") return;
    job.status = status;
    if (error) job.error = error;
    job.finishedAt = Date.now();
    job.pending?.reject(new Error("Login finished"));
    const finished = [...this.#jobs.values()]
      .filter((candidate) => candidate.finishedAt !== null)
      .sort((left, right) => (left.finishedAt ?? 0) - (right.finishedAt ?? 0));
    while (finished.length > MAX_FINISHED_JOBS) {
      const oldest = finished.shift();
      if (oldest) this.#jobs.delete(oldest.jobId);
    }
  }

  public startLogin(authType: ProviderAuthType): string {
    if (authType !== "oauth") throw new Error("OpenAI Codex requires OAuth");
    for (const job of this.#jobs.values()) {
      if (job.status === "running") {
        job.abort.abort();
        this.#finish(job, "cancelled");
      }
    }
    const job: LoginJob = {
      jobId: randomUUID(),
      status: "running",
      events: [],
      eventSeq: 0,
      promptSeq: 0,
      pending: null,
      abort: new AbortController(),
      finishedAt: null,
    };
    this.#jobs.set(job.jobId, job);
    const interaction: AuthInteraction = {
      signal: job.abort.signal,
      prompt: (prompt) => this.#parkPrompt(job, prompt),
      notify: (event) => this.#pushEvent(job, event),
    };
    void this.#models
      .login(CODEX_PROVIDER_ID, "oauth", interaction)
      .then(() => this.#finish(job, "success"))
      .catch((error: unknown) => {
        this.#finish(
          job,
          job.abort.signal.aborted ? "cancelled" : "error",
          error instanceof Error ? redactLogLine(error.message).slice(0, 500) : "Login failed",
        );
      });
    return job.jobId;
  }

  public loginJob(jobId: string, after = 0): ProviderLoginJobView | null {
    const job = this.#jobs.get(jobId);
    if (!job) return null;
    return {
      jobId: job.jobId,
      providerId: CODEX_PROVIDER_ID,
      authType: "oauth",
      status: job.status,
      ...(job.error ? { error: job.error } : {}),
      events: job.events.filter((event) => event.seq > after),
      ...(job.pending ? { pendingPrompt: job.pending.prompt } : {}),
    };
  }

  public respond(jobId: string, promptId: number, value: string): boolean {
    const pending = this.#jobs.get(jobId)?.pending;
    if (!pending || pending.prompt.id !== promptId) return false;
    pending.resolve(value);
    return true;
  }

  public cancel(jobId: string): boolean {
    const job = this.#jobs.get(jobId);
    if (!job) return false;
    job.abort.abort();
    this.#finish(job, "cancelled");
    return true;
  }

  public logout(): Promise<void> {
    for (const job of this.#jobs.values()) {
      if (job.status === "running") {
        job.abort.abort();
        this.#finish(job, "cancelled");
      }
    }
    return this.#models.logout(CODEX_PROVIDER_ID);
  }

  public shutdown(): void {
    for (const job of this.#jobs.values()) job.abort.abort();
    this.#jobs.clear();
  }

  #resolveModel(modelId: string): Promise<{ model: Model<Api>; token: string }> {
    const model = this.#models.getModel(CODEX_PROVIDER_ID, modelId);
    if (!model) throw new Error(`Unknown OpenAI Codex model '${modelId}'`);
    return this.#models.getAuth(model).then((auth) => {
      const token = auth?.auth.apiKey;
      if (!token) throw new Error("OpenAI Codex is not connected on this controller");
      return { model, token };
    });
  }

  public responses(
    modelId: string,
    request: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ response: Response; completion: Promise<CodexResponsesCompletion | null> }> {
    return Effect.runPromise(
      Effect.tryPromise({
        try: async () => {
          const { model, token } = await this.#resolveModel(modelId);
          const accountId = accountIdFromToken(token);
          const requestedStream = request["stream"] === true;
          const include = Array.isArray(request["include"])
            ? request["include"].filter((entry): entry is string => typeof entry === "string")
            : [];
          const upstreamBody: Record<string, unknown> = {
            ...request,
            model: model.id,
            store: false,
            stream: true,
            instructions:
              typeof request["instructions"] === "string" && request["instructions"]
                ? request["instructions"]
                : "You are a helpful assistant.",
            include: [...new Set([...include, "reasoning.encrypted_content"])],
          };
          delete upstreamBody["max_output_tokens"];
          delete upstreamBody["stream_options"];
          const sessionId =
            typeof request["prompt_cache_key"] === "string"
              ? request["prompt_cache_key"]
              : undefined;
          const headers = new Headers({
            Authorization: `Bearer ${token}`,
            "chatgpt-account-id": accountId,
            originator: "pi",
            "User-Agent": `local-studio (${hostname()}; ${platform()} ${release()})`,
            "OpenAI-Beta": "responses=experimental",
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          });
          if (sessionId) {
            headers.set("session-id", sessionId);
            headers.set("x-client-request-id", sessionId);
          }
          const upstream = await fetch(responseEndpoint(model.baseUrl), {
            method: "POST",
            headers,
            body: JSON.stringify(upstreamBody),
            signal,
          });
          if (!upstream.ok || !upstream.body) {
            const errorBody = await upstream.text();
            const response = new Response(errorBody, {
              status: upstream.status,
              headers: {
                "Content-Type":
                  upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
              },
            });
            return { response, completion: Promise.resolve(null) };
          }
          const normalized = normalizeSse(upstream.body);
          const completion = normalized.completion.then((response) =>
            response ? { response, status: upstream.status } : null,
          );
          if (requestedStream) {
            return {
              response: new Response(normalized.stream, {
                status: upstream.status,
                headers: {
                  "Content-Type": "text/event-stream; charset=utf-8",
                  "Cache-Control": "no-cache",
                  Connection: "keep-alive",
                  "X-Accel-Buffering": "no",
                },
              }),
              completion,
            };
          }
          await new Response(normalized.stream).text();
          const completed = await completion;
          return {
            response: completed
              ? Response.json(completed.response, { status: completed.status })
              : Response.json(
                  { error: { message: "Codex stream ended without a response" } },
                  { status: 502 },
                ),
            completion: Promise.resolve(completed),
          };
        },
        catch: (source) => source,
      }),
    );
  }
}
