import { randomUUID } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Option, Schema } from "effect";
import type {
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  AuthType,
  Model,
  Api,
} from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { inferReasoningSupport, type AgentModel } from "../../../shared/agent/models";
import { resolveDataDir } from "./data-dir";
import { getGlobalSingleton } from "./instances";
import type {
  ProviderLoginEvent,
  ProviderLoginEventPayload,
  ProviderLoginJobView,
  ProviderLoginPrompt,
  ProviderView,
} from "./provider-hub-contract";

export type {
  ProviderLoginEvent,
  ProviderLoginJobView,
  ProviderLoginPrompt,
  ProviderView,
} from "./provider-hub-contract";

const INTERNAL_PROVIDER_PREFIXES = ["local-studio", "user-pi-"];

const MAX_JOB_EVENTS = 200;
const MAX_FINISHED_JOBS = 8;
const ReasoningCompatSchema = Schema.Struct({
  supportsReasoningEffort: Schema.optional(Schema.Boolean),
});

type LoginJob = {
  jobId: string;
  providerId: string;
  authType: AuthType;
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

function serializeAuthEvent(event: AuthEvent): ProviderLoginEventPayload {
  switch (event.type) {
    case "auth_url": {
      const payload: ProviderLoginEventPayload = { type: "auth_url", url: event.url };
      if (event.instructions) payload.instructions = event.instructions;
      return payload;
    }
    case "device_code": {
      const payload: ProviderLoginEventPayload = {
        type: "device_code",
        userCode: event.userCode,
        verificationUri: event.verificationUri,
      };
      if (event.intervalSeconds !== undefined) payload.intervalSeconds = event.intervalSeconds;
      if (event.expiresInSeconds !== undefined) payload.expiresInSeconds = event.expiresInSeconds;
      return payload;
    }
    case "progress":
      return { type: "progress", message: event.message };
    default: {
      const payload: ProviderLoginEventPayload = { type: "info", message: event.message };
      if (event.links?.length) {
        payload.links = event.links.map(({ url, label }) => {
          if (label) return { url, label };
          return { url };
        });
      }
      return payload;
    }
  }
}

function isInternalProviderId(id: string): boolean {
  return INTERNAL_PROVIDER_PREFIXES.some((prefix) => id === prefix || id.startsWith(prefix));
}

function agentDirPath(): string {
  return path.join(resolveDataDir(), "pi-agent");
}

async function createHubRuntime(): Promise<ModelRuntime> {
  const modelsDir = agentDirPath();
  const nativeAgentDir =
    process.env.PI_CODING_AGENT_DIR?.trim() || path.join(homedir(), ".pi", "agent");
  await mkdir(modelsDir, { recursive: true });
  await mkdir(nativeAgentDir, { recursive: true });
  await chmod(modelsDir, 0o700).catch(() => undefined);
  await chmod(nativeAgentDir, 0o700).catch(() => undefined);
  return ModelRuntime.create({
    authPath: path.join(nativeAgentDir, "auth.json"),
    modelsPath: path.join(modelsDir, "models.json"),
  });
}

function hubPromise(): Promise<ModelRuntime> {
  return getGlobalSingleton("providerHubRuntime", createHubRuntime);
}

function jobsMap(): Map<string, LoginJob> {
  return getGlobalSingleton("providerHubLoginJobs", () => new Map<string, LoginJob>());
}

export function getProviderHub(): Promise<ModelRuntime> {
  return hubPromise();
}

export async function refreshProviderHub(): Promise<void> {
  const runtime = await hubPromise();
  await runtime.refresh({ allowNetwork: false });
}

export async function listProviders(): Promise<ProviderView[]> {
  const runtime = await hubPromise();
  const credentials = new Map(
    (await runtime.listCredentials()).map((info) => [info.providerId, info.type]),
  );
  const views: ProviderView[] = [];
  for (const provider of runtime.getProviders()) {
    if (isInternalProviderId(provider.id)) continue;
    const status = runtime.getProviderAuthStatus(provider.id);
    const view: ProviderView = {
      id: provider.id,
      name: provider.name,
      configured: status.configured,
      modelCount: runtime.getModels(provider.id).length,
    };
    if (provider.auth.oauth) view.oauth = { label: provider.auth.oauth.name };
    if (provider.auth.apiKey?.login) view.apiKey = { label: provider.auth.apiKey.name };
    if (status.source) view.authSource = status.source;
    if (status.label) view.authLabel = status.label;
    const credentialType = credentials.get(provider.id);
    if (credentialType) view.credentialType = credentialType;
    views.push(view);
  }
  return views.sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function serializePrompt(job: LoginJob, prompt: AuthPrompt): ProviderLoginPrompt {
  job.promptSeq += 1;
  const serialized: ProviderLoginPrompt = {
    id: job.promptSeq,
    type: prompt.type,
    message: prompt.message,
  };
  if ("placeholder" in prompt && prompt.placeholder) serialized.placeholder = prompt.placeholder;
  if (prompt.type === "select") serialized.options = prompt.options;
  return serialized;
}

function pushEvent(job: LoginJob, event: AuthEvent): void {
  job.eventSeq += 1;
  job.events.push({ seq: job.eventSeq, event: serializeAuthEvent(event) });
  if (job.events.length > MAX_JOB_EVENTS) job.events.splice(0, job.events.length - MAX_JOB_EVENTS);
}

function parkPrompt(job: LoginJob, prompt: AuthPrompt): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const pending = {
      prompt: serializePrompt(job, prompt),
      resolve: (value: string) => {
        cleanup();
        resolve(value);
      },
      reject: (error: Error) => {
        cleanup();
        reject(error);
      },
    };
    const onAbort = () => pending.reject(new Error("Prompt cancelled"));
    const cleanup = () => {
      if (job.pending === pending) job.pending = null;
      prompt.signal?.removeEventListener("abort", onAbort);
    };
    job.pending?.reject(new Error("Prompt superseded"));
    job.pending = pending;
    prompt.signal?.addEventListener("abort", onAbort);
    if (prompt.signal?.aborted) onAbort();
  });
}

function pruneFinishedJobs(jobs: Map<string, LoginJob>): void {
  const finished = [...jobs.values()]
    .filter((job) => job.finishedAt !== null)
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  while (finished.length > MAX_FINISHED_JOBS) {
    const oldest = finished.shift();
    if (oldest) jobs.delete(oldest.jobId);
  }
}

function finishJob(job: LoginJob, status: LoginJob["status"], error?: string): void {
  if (job.status !== "running") return;
  job.status = status;
  if (error) job.error = error;
  job.finishedAt = Date.now();
  job.pending?.reject(new Error("Login finished"));
}

export async function startProviderLogin(
  providerId: string,
  authType: AuthType,
): Promise<{ jobId: string } | { error: string; status: number }> {
  const runtime = await hubPromise();
  const provider = runtime.getProvider(providerId);
  if (!provider || isInternalProviderId(providerId)) {
    return { error: `Unknown provider '${providerId}'.`, status: 404 };
  }
  const supportsType =
    authType === "oauth"
      ? provider.auth.oauth !== undefined
      : provider.auth.apiKey?.login !== undefined;
  if (!supportsType) {
    return { error: `Provider '${providerId}' does not support ${authType} login.`, status: 400 };
  }
  const jobs = jobsMap();
  for (const existing of jobs.values()) {
    if (existing.providerId === providerId && existing.status === "running") {
      existing.abort.abort();
      finishJob(existing, "cancelled");
    }
  }
  const job: LoginJob = {
    jobId: randomUUID(),
    providerId,
    authType,
    status: "running",
    events: [],
    eventSeq: 0,
    promptSeq: 0,
    pending: null,
    abort: new AbortController(),
    finishedAt: null,
  };
  jobs.set(job.jobId, job);
  pruneFinishedJobs(jobs);

  const interaction: AuthInteraction = {
    signal: job.abort.signal,
    prompt: (prompt) => parkPrompt(job, prompt),
    notify: (event) => pushEvent(job, event),
  };
  void runtime
    .login(providerId, authType, interaction)
    .then(() => finishJob(job, "success"))
    .catch((error) => {
      if (job.abort.signal.aborted) {
        finishJob(job, "cancelled");
        return;
      }
      finishJob(job, "error", error instanceof Error ? error.message : "Login failed");
    });
  return { jobId: job.jobId };
}

export function getProviderLoginJob(jobId: string, after = 0): ProviderLoginJobView | null {
  const job = jobsMap().get(jobId);
  if (!job) return null;
  const view: ProviderLoginJobView = {
    jobId: job.jobId,
    providerId: job.providerId,
    authType: job.authType,
    status: job.status,
    events: job.events.filter((entry) => entry.seq > after),
  };
  if (job.error) view.error = job.error;
  if (job.pending) view.pendingPrompt = job.pending.prompt;
  return view;
}

export function respondProviderLogin(jobId: string, promptId: number, value: string): boolean {
  const job = jobsMap().get(jobId);
  if (!job || job.status !== "running") return false;
  const pending = job.pending;
  if (!pending || pending.prompt.id !== promptId) return false;
  pending.resolve(value);
  return true;
}

export function cancelProviderLogin(jobId: string): boolean {
  const job = jobsMap().get(jobId);
  if (!job) return false;
  if (job.status === "running") {
    job.abort.abort();
    finishJob(job, "cancelled");
  }
  return true;
}

export async function logoutProvider(
  providerId: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  const runtime = await hubPromise();
  if (!runtime.getProvider(providerId) || isInternalProviderId(providerId)) {
    return { error: `Unknown provider '${providerId}'.`, status: 404 };
  }
  await runtime.logout(providerId);
  return { ok: true };
}

function providerModelToAgentModel(
  providerId: string,
  providerName: string,
  model: Model<Api>,
): AgentModel {
  const reasoning = model.reasoning || inferReasoningSupport(model.id);
  const compat = Option.getOrUndefined(
    Schema.decodeUnknownOption(ReasoningCompatSchema)(model.compat),
  );
  let thinkingLevels: AgentModel["thinkingLevels"];
  if (!reasoning) thinkingLevels = ["off"];
  else if (compat?.supportsReasoningEffort === false) thinkingLevels = ["high"];
  else thinkingLevels = getSupportedThinkingLevels({ ...model, reasoning });
  return {
    id: `${providerId}/${model.id}`,
    rawId: model.id,
    name: `${model.name} · ${providerName}`,
    provider: "local-studio",
    providerId,
    controllerName: providerName,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning,
    thinkingLevels,
    vision: model.input.includes("image"),
    active: false,
  };
}

export async function listProviderAgentModels(): Promise<AgentModel[]> {
  try {
    const runtime = await hubPromise();
    const available = await runtime.getAvailable();
    const models: AgentModel[] = [];
    for (const model of available) {
      if (isInternalProviderId(model.provider)) continue;
      const providerName = runtime.getProvider(model.provider)?.name ?? model.provider;
      models.push(providerModelToAgentModel(model.provider, providerName, model));
    }
    return models.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
