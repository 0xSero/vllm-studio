import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createModels,
  createProvider,
  type Api,
  type AuthEvent,
  type AuthInteraction,
  type AuthPrompt,
  type Model,
  type MutableModels,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import type {
  ProviderAuthType,
  ProviderLoginEvent,
  ProviderLoginEventPayload,
  ProviderLoginJobView,
  ProviderLoginPrompt,
  ProviderView,
} from "@local-studio/contracts/provider-auth";
import { redactLogLine } from "../core/log-redaction";
import { createCursorResponses } from "./cursor-responses";
import type {
  HeadProviderModel,
  HeadProviderResponse,
  HeadResponsesProviderAdapter,
} from "./head-provider";
import { OAuthCredentialStore } from "./oauth-credential-store";

export const CURSOR_PROVIDER_ID = "cursor";

const MAX_JOB_EVENTS = 200;
const MAX_FINISHED_JOBS = 8;

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

const abortable = <A>(operation: Promise<A>, signal?: AbortSignal): Promise<A> => {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(new Error("Login cancelled"));
  return new Promise<A>((resolve, reject) => {
    const abort = (): void => reject(new Error("Login cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
};

export class CursorProviderService implements HeadResponsesProviderAdapter {
  public readonly id = CURSOR_PROVIDER_ID;
  public readonly api = "openai-responses" as const;
  readonly #models: MutableModels;
  readonly #jobs = new Map<string, LoginJob>();
  #providerConfig: ProviderConfig | null = null;

  private constructor(dataDirectory: string) {
    this.#models = createModels({
      credentials: new OAuthCredentialStore(dataDirectory, "cursor.json", "Cursor"),
    });
  }

  public static open(dataDirectory: string): Promise<CursorProviderService> {
    const service = new CursorProviderService(dataDirectory);
    const runtimeDirectory = resolve(dataDirectory, "providers", "cursor");
    process.env["PI_CODING_AGENT_DIR"] = runtimeDirectory;
    process.env["PI_CURSOR_CACHE_DIR"] = resolve(runtimeDirectory, "cache");
    process.env["PI_CURSOR_SYSTEM_CREDENTIALS"] = "0";
    return import("@rahularya01/pi-cursor")
      .then(({ default: cursorExtension }) => cursorExtension(service.#extensionApi()))
      .then(() => {
        if (!service.#providerConfig) throw new Error("Cursor provider failed to register");
        return service;
      });
  }

  #extensionApi(): ExtensionAPI {
    const target = {
      on: (..._args: unknown[]): void => undefined,
      registerCommand: (..._args: unknown[]): void => undefined,
      registerProvider: (providerId: unknown, config: unknown): void => {
        if (providerId !== CURSOR_PROVIDER_ID || !config || typeof config !== "object") {
          throw new Error("Cursor provider registration is invalid");
        }
        this.#installProvider(config as ProviderConfig);
      },
    };
    return new Proxy(target, {
      get(value, property): unknown {
        if (property in value) return value[property as keyof typeof value];
        throw new Error(`Cursor requested unsupported extension API '${String(property)}'`);
      },
    }) as unknown as ExtensionAPI;
  }

  #installProvider(config: ProviderConfig): void {
    const oauth = config.oauth;
    const streamSimple = config.streamSimple;
    const api = config.api;
    const baseUrl = config.baseUrl;
    if (!oauth || !streamSimple || !api || !baseUrl) {
      throw new Error("Cursor provider registration is incomplete");
    }
    this.#providerConfig = config;
    const models: Model<Api>[] = (config.models ?? []).map((model) => ({
      id: model.id,
      name: model.name,
      api: model.api ?? api,
      provider: CURSOR_PROVIDER_ID,
      baseUrl: model.baseUrl ?? baseUrl,
      reasoning: model.reasoning,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      ...(model.thinkingLevelMap ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
      ...(model.headers ? { headers: model.headers } : {}),
      ...(model.compat ? { compat: model.compat } : {}),
    }));
    const streams = { stream: streamSimple, streamSimple } as ProviderStreams;
    this.#models.setProvider(
      createProvider({
        id: CURSOR_PROVIDER_ID,
        name: config.name ?? "Cursor",
        baseUrl,
        auth: {
          oauth: {
            name: oauth.name,
            loginLabel: oauth.name,
            login: (interaction) =>
              abortable(
                oauth.login({
                  ...(interaction.signal ? { signal: interaction.signal } : {}),
                  onAuth: (info) => interaction.notify({ type: "auth_url", ...info }),
                  onDeviceCode: (info) => interaction.notify({ type: "device_code", ...info }),
                  onProgress: (message) => interaction.notify({ type: "progress", message }),
                  onPrompt: (prompt) =>
                    interaction.prompt({
                      type: "text",
                      message: prompt.message,
                      ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
                    }),
                  onManualCodeInput: () =>
                    interaction.prompt({
                      type: "manual_code",
                      message: "Enter the authorization code",
                    }),
                  onSelect: (prompt) =>
                    interaction.prompt({
                      type: "select",
                      message: prompt.message,
                      options: prompt.options,
                    }),
                }),
                interaction.signal,
              ).then((credential) => ({ ...credential, type: "oauth" as const })),
            refresh: (credential) =>
              oauth
                .refreshToken(credential)
                .then((refreshed) => ({ ...refreshed, type: "oauth" as const })),
            toAuth: (credential) => Promise.resolve({ apiKey: oauth.getApiKey(credential) }),
          },
        },
        models,
        api: streams,
      }),
    );
  }

  #configured(): Promise<boolean> {
    return this.#models.checkAuth(CURSOR_PROVIDER_ID).then(Boolean);
  }

  public view(): Promise<ProviderView> {
    return this.#configured().then((configured) => ({
      id: CURSOR_PROVIDER_ID,
      name: "Cursor",
      oauth: { label: "Cursor subscription" },
      configured,
      ...(configured ? { authSource: "controller", authLabel: "Cursor OAuth" } : {}),
      ...(configured ? { credentialType: "oauth" as const } : {}),
      modelCount: this.#models.getModels(CURSOR_PROVIDER_ID).length,
      controllerOwned: true,
    }));
  }

  public models(): Promise<HeadProviderModel[]> {
    return this.#configured().then((configured) =>
      configured
        ? this.#models.getModels(CURSOR_PROVIDER_ID).map((model) => ({
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
    if (authType !== "oauth") throw new Error("Cursor requires OAuth");
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
      .login(CURSOR_PROVIDER_ID, "oauth", interaction)
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
      providerId: CURSOR_PROVIDER_ID,
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
    return this.#models.logout(CURSOR_PROVIDER_ID);
  }

  public responses(
    modelId: string,
    request: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<HeadProviderResponse> {
    const model = this.#models.getModel(CURSOR_PROVIDER_ID, modelId);
    if (!model) return Promise.reject(new Error(`Unknown Cursor model '${modelId}'`));
    return createCursorResponses(this.#models, model, request, signal);
  }

  public shutdown(): void {
    for (const job of this.#jobs.values()) job.abort.abort();
    this.#jobs.clear();
  }
}
