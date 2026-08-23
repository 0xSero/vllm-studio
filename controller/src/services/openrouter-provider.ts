import { randomUUID } from "node:crypto";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type {
  ProviderAuthType,
  ProviderLoginJobView,
  ProviderLoginPrompt,
  ProviderView,
} from "@local-studio/contracts/provider-auth";
import { redactLogLine } from "../core/log-redaction";
import { ApiKeyCredentialStore } from "./api-key-credential-store";
import type { HeadCompletionsProviderAdapter, HeadProviderModel } from "./head-provider";

export const OPENROUTER_PROVIDER_ID = "openrouter";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MAX_FINISHED_JOBS = 8;

type LoginJob = {
  jobId: string;
  status: ProviderLoginJobView["status"];
  error?: string;
  pending: {
    prompt: ProviderLoginPrompt;
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  } | null;
  abort: AbortController;
  finishedAt: number | null;
};

type ResolvedCredential = {
  key: string;
  source: "controller" | "OPENROUTER_API_KEY";
};

export class OpenRouterProviderService implements HeadCompletionsProviderAdapter {
  public readonly id = OPENROUTER_PROVIDER_ID;
  public readonly api = "openai-completions" as const;
  readonly #provider = openrouterProvider();
  readonly #credentials: ApiKeyCredentialStore;
  readonly #jobs = new Map<string, LoginJob>();

  public constructor(dataDirectory: string) {
    this.#credentials = new ApiKeyCredentialStore(dataDirectory, "openrouter.json");
  }

  #credential(): Promise<ResolvedCredential | null> {
    return this.#credentials.read().then((stored) => {
      if (stored) return { key: stored, source: "controller" };
      const environment = process.env["OPENROUTER_API_KEY"]?.trim();
      return environment ? { key: environment, source: "OPENROUTER_API_KEY" } : null;
    });
  }

  public view(): Promise<ProviderView> {
    return this.#credential().then((credential) => ({
      id: this.id,
      name: "OpenRouter",
      apiKey: { label: "OpenRouter API key" },
      configured: credential !== null,
      ...(credential
        ? {
            authSource: credential.source,
            authLabel: credential.source === "controller" ? "Head API key" : "OPENROUTER_API_KEY",
            ...(credential.source === "controller" ? { credentialType: "api_key" as const } : {}),
          }
        : {}),
      modelCount: this.#provider.getModels().length,
      controllerOwned: true,
    }));
  }

  public models(): Promise<HeadProviderModel[]> {
    return this.#credential().then((credential) =>
      credential
        ? this.#provider.getModels().map((model) => ({
            id: model.id,
            name: model.name,
            api: "openai-completions" as const,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
            reasoning: model.reasoning,
            vision: model.input.includes("image"),
            compat: {
              supportsStore: true,
              supportsDeveloperRole:
                model.id.startsWith("openai/") || model.id.startsWith("anthropic/"),
              supportsStrictMode: true,
              thinkingFormat: "openrouter",
              ...model.compat,
            },
            ...(model.thinkingLevelMap ? { thinkingLevelMap: { ...model.thinkingLevelMap } } : {}),
          }))
        : [],
    );
  }

  #finish(job: LoginJob, status: LoginJob["status"], error?: string): void {
    if (job.status !== "running") return;
    job.status = status;
    if (error) job.error = error;
    job.finishedAt = Date.now();
    job.pending?.reject(new Error("Login finished"));
    job.pending = null;
    const finished = [...this.#jobs.values()]
      .filter((candidate) => candidate.finishedAt !== null)
      .sort((left, right) => (left.finishedAt ?? 0) - (right.finishedAt ?? 0));
    while (finished.length > MAX_FINISHED_JOBS) {
      const oldest = finished.shift();
      if (oldest) this.#jobs.delete(oldest.jobId);
    }
  }

  #validate(key: string, signal: AbortSignal): Promise<void> {
    return fetch(`${OPENROUTER_BASE_URL}/auth/key`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    }).then((response) => {
      if (!response.ok)
        throw new Error(`OpenRouter rejected the API key (HTTP ${response.status})`);
    });
  }

  public startLogin(authType: ProviderAuthType): string {
    if (authType !== "api_key") throw new Error("OpenRouter requires an API key");
    for (const job of this.#jobs.values()) {
      if (job.status === "running") {
        job.abort.abort();
        this.#finish(job, "cancelled");
      }
    }
    const job: LoginJob = {
      jobId: randomUUID(),
      status: "running",
      pending: null,
      abort: new AbortController(),
      finishedAt: null,
    };
    const key = new Promise<string>((resolve, reject) => {
      job.pending = {
        prompt: {
          id: 1,
          type: "secret",
          message: "Enter your OpenRouter API key",
          placeholder: "sk-or-v1-…",
        },
        resolve,
        reject,
      };
    });
    this.#jobs.set(job.jobId, job);
    void key
      .then((value) => {
        const normalized = value.trim();
        if (!normalized) throw new Error("OpenRouter API key is required");
        return this.#validate(normalized, job.abort.signal).then(() => normalized);
      })
      .then((value) => this.#credentials.save(value))
      .then(() => this.#finish(job, "success"))
      .catch((error: unknown) =>
        this.#finish(
          job,
          job.abort.signal.aborted ? "cancelled" : "error",
          error instanceof Error ? redactLogLine(error.message).slice(0, 500) : "Login failed",
        ),
      );
    return job.jobId;
  }

  public loginJob(jobId: string, after = 0): ProviderLoginJobView | null {
    const job = this.#jobs.get(jobId);
    if (!job) return null;
    return {
      jobId,
      providerId: this.id,
      authType: "api_key",
      status: job.status,
      ...(job.error ? { error: job.error } : {}),
      events: [],
      ...(job.pending && after <= 0 ? { pendingPrompt: job.pending.prompt } : {}),
    };
  }

  public respond(jobId: string, promptId: number, value: string): boolean {
    const job = this.#jobs.get(jobId);
    const pending = job?.pending;
    if (!job || job.status !== "running" || !pending || pending.prompt.id !== promptId)
      return false;
    job.pending = null;
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

  public migrateApiKey(key: string): Promise<void> {
    return this.#credentials
      .read()
      .then((current) => (current ? undefined : this.#credentials.save(key)));
  }

  public logout(): Promise<void> {
    for (const job of this.#jobs.values()) {
      if (job.status === "running") {
        job.abort.abort();
        this.#finish(job, "cancelled");
      }
    }
    return this.#credentials.delete();
  }

  public completionsRoute(modelId: string): Promise<{
    upstreamUrl: string;
    headers: Record<string, string>;
  }> {
    if (!this.#provider.getModels().some((model) => model.id === modelId)) {
      return Promise.reject(new Error(`Unknown OpenRouter model '${modelId}'`));
    }
    return this.#credential().then((credential) => {
      if (!credential) throw new Error("OpenRouter is not connected on this Head");
      return {
        upstreamUrl: `${OPENROUTER_BASE_URL}/chat/completions`,
        headers: {
          Authorization: `Bearer ${credential.key}`,
          "HTTP-Referer": "https://github.com/jake-molnia/local-studio",
          "X-Title": "Local Studio",
        },
      };
    });
  }

  public shutdown(): void {
    for (const job of this.#jobs.values()) job.abort.abort();
    this.#jobs.clear();
  }
}
