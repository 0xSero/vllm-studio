import { createHash, randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Schema } from "effect";
import { resolveDataDir } from "./data-dir";
import { desktopOAuthVault, desktopOAuthVaultAvailable, type OAuthVault } from "./oauth-vault";
import {
  OnboardingProbeResultSchema,
  OnboardingProfileSchema,
  OnboardingRecoverySchema,
  OnboardingReceiptSchema,
  OnboardingStateSchema,
  type FastCrwSearchInput,
  type FastCrwScrapeInput,
  type FastCrwMapInput,
  type FastCrwCrawlInput,
  type FastCrwCrawlStatusInput,
  type FastCrwExtractInput,
  type FastCrwExtractStatusInput,
  type OnboardingProbeInput,
  type OnboardingProbeResult,
  type OnboardingProfile,
  type OnboardingReceipt,
  type OnboardingRecovery,
  type OnboardingSaveInput,
  type OnboardingState,
} from "./agent-onboarding-contract";
import { AgentOnboardingError } from "./agent-onboarding-error";
import {
  crawlFastCrwHttp,
  crawlStatusFastCrwHttp,
  extractFastCrwHttp,
  extractStatusFastCrwHttp,
  mapFastCrwHttp,
  proxyInferenceHttp,
  runtimeUrl,
  scrapeFastCrwHttp,
  searchFastCrwHttp,
} from "./agent-onboarding-http";
import { isValidSshTarget, probeSshTarget } from "./agent-onboarding-ssh";

type StoredOnboarding = {
  profile: OnboardingProfile;
  probes: OnboardingProbeResult[];
  receipt: OnboardingReceipt | null;
  recovery: OnboardingRecovery | null;
};

const keyPattern = /^vault:(enterprise:(vault|gitlab|jira)|runtime:inference|search:fastcrw)$/;
const serviceCredentialRefs = {
  vault: "vault:enterprise:vault",
  gitlab: "vault:enterprise:gitlab",
  jira: "vault:enterprise:jira",
} as const;
const allowedHosts = [
  "vault-tds.thales-systems.ca",
  "sc01-trt.thales-systems.ca",
  "pm01-trt.thales-systems.ca",
  "api.fastcrw.com",
  "api.tprime.vlans.ca",
  "127.0.0.1",
  "localhost",
];
const profileFile = () => path.join(resolveDataDir(), "agent-onboarding.json");
let onboardingAccess = Promise.resolve();

function withOnboardingAccess<A>(operation: () => Promise<A>): Promise<A> {
  const result = onboardingAccess.then(operation);
  onboardingAccess = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export { AgentOnboardingError } from "./agent-onboarding-error";

export function defaultOnboardingProfile(now = new Date().toISOString()): OnboardingProfile {
  return {
    version: 1,
    classification: "C2",
    services: [
      {
        id: "vault",
        name: "Vault",
        url: "https://vault-tds.thales-systems.ca/ui/vault",
        enabled: true,
        credentialRef: "vault:enterprise:vault",
      },
      {
        id: "gitlab",
        name: "GitLab",
        url: "https://sc01-trt.thales-systems.ca/gitlab/",
        enabled: true,
        credentialRef: "vault:enterprise:gitlab",
      },
      {
        id: "jira",
        name: "Jira",
        url: "https://pm01-trt.thales-systems.ca/jira/",
        enabled: true,
        credentialRef: "vault:enterprise:jira",
      },
    ],
    runtime: {
      baseUrl: "http://127.0.0.1:18181/v1",
      modelId: "qwen3-next-80b-a3b-nvfp4",
      contextWindow: 131072,
      credentialRef: "vault:runtime:inference",
    },
    search: {
      baseUrl: "https://api.fastcrw.com",
      enabled: true,
      credentialRef: "vault:search:fastcrw",
    },
    remoteAgent: { enabled: false, target: "" },
    localAgents: [],
    updatedAt: now,
  };
}

function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AgentOnboardingError(400, `Invalid URL: ${raw}`);
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new AgentOnboardingError(400, "Only credential-free HTTP URLs are accepted");
  }
  if (!allowedHosts.includes(url.hostname) && !url.hostname.endsWith(".tprime.vlans.ca")) {
    throw new AgentOnboardingError(
      400,
      `Host is outside the onboarding allowlist: ${url.hostname}`,
    );
  }
  return url;
}

function validateProfile(profile: OnboardingProfile): OnboardingProfile {
  const decoded = Schema.decodeUnknownSync(OnboardingProfileSchema)(profile);
  const serviceIds = new Set(decoded.services.map((service) => service.id));
  if (serviceIds.size !== decoded.services.length || serviceIds.size !== 3) {
    throw new AgentOnboardingError(400, "Vault, GitLab, and Jira must each be configured once");
  }
  decoded.services.forEach((service) => {
    validateUrl(service.url);
    if (service.credentialRef !== serviceCredentialRefs[service.id]) {
      throw new AgentOnboardingError(400, `Invalid credential reference: ${service.credentialRef}`);
    }
  });
  validateUrl(decoded.runtime.baseUrl);
  validateUrl(decoded.search.baseUrl);
  if (
    !keyPattern.test(decoded.runtime.credentialRef) ||
    !keyPattern.test(decoded.search.credentialRef) ||
    decoded.runtime.credentialRef !== "vault:runtime:inference" ||
    decoded.search.credentialRef !== "vault:search:fastcrw"
  ) {
    throw new AgentOnboardingError(400, "Runtime and search credential references are fixed");
  }
  if (
    !decoded.runtime.modelId.trim() ||
    !Number.isFinite(decoded.runtime.contextWindow) ||
    decoded.runtime.contextWindow < 1
  ) {
    throw new AgentOnboardingError(400, "Runtime model and context window are required");
  }
  if (decoded.remoteAgent.enabled && !isValidSshTarget(decoded.remoteAgent.target)) {
    throw new AgentOnboardingError(400, "Remote agent target must be an SSH host or user@host");
  }
  return decoded;
}

async function readStored(): Promise<StoredOnboarding> {
  if (!existsSync(profileFile())) {
    return { profile: defaultOnboardingProfile(), probes: [], receipt: null, recovery: null };
  }
  try {
    const parsed = JSON.parse(await readFile(profileFile(), "utf8")) as Record<string, unknown>;
    return {
      profile: validateProfile(parsed["profile"] as OnboardingProfile),
      probes: Array.isArray(parsed["probes"])
        ? [
            ...Schema.decodeUnknownSync(Schema.Array(OnboardingProbeResultSchema))(
              parsed["probes"].slice(0, 20),
            ),
          ]
        : [],
      receipt: parsed["receipt"]
        ? Schema.decodeUnknownSync(OnboardingReceiptSchema)(parsed["receipt"])
        : null,
      recovery: parsed["recovery"]
        ? Schema.decodeUnknownSync(OnboardingRecoverySchema)(parsed["recovery"])
        : null,
    };
  } catch (error) {
    if (error instanceof AgentOnboardingError) throw error;
    throw new AgentOnboardingError(500, "Agent onboarding state is invalid");
  }
}

async function writeStored(state: StoredOnboarding): Promise<void> {
  const file = profileFile();
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  await chmod(file, 0o600);
}

const runVault = <A>(effect: Effect.Effect<A, unknown>): Promise<A> => Effect.runPromise(effect);

async function keyringStatus(
  profile: OnboardingProfile,
  vault: OAuthVault,
): Promise<OnboardingState["keyring"]> {
  if (vault === desktopOAuthVault && !desktopOAuthVaultAvailable()) {
    return { available: false, credentialRefs: [] };
  }
  const refs = [
    ...profile.services.map((service) => service.credentialRef),
    profile.runtime.credentialRef,
    profile.search.credentialRef,
  ];
  try {
    await runVault(vault.read("vault:search:fastcrw"));
    const present: string[] = [];
    for (const ref of refs) {
      if (await runVault(vault.read(ref))) present.push(ref);
    }
    return { available: true, credentialRefs: present };
  } catch {
    return { available: false, credentialRefs: [] };
  }
}

export function getOnboardingState(
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<OnboardingState, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      const stored = await readStored();
      return Schema.decodeUnknownSync(OnboardingStateSchema)({
        ...stored,
        keyring: await keyringStatus(stored.profile, vault),
      });
    },
    catch: (error) =>
      error instanceof AgentOnboardingError
        ? error
        : new AgentOnboardingError(500, "Failed to read onboarding state"),
  });
}

export function saveOnboarding(
  input: OnboardingSaveInput,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<OnboardingState, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      const profile = validateProfile({ ...input.profile, updatedAt: new Date().toISOString() });
      const credentials = input.credentials ?? [];
      const credentialRefs = new Set(credentials.map((credential) => credential.ref));
      if (credentialRefs.size !== credentials.length) {
        throw new AgentOnboardingError(400, "Credential references must be unique");
      }
      if (
        credentials.length &&
        vault === desktopOAuthVault &&
        !desktopOAuthVaultAvailable()
      ) {
        throw new AgentOnboardingError(503, "Desktop keyring is unavailable");
      }
      for (const credential of credentials) {
        if (!keyPattern.test(credential.ref) || credential.value.length > 32_768) {
          throw new AgentOnboardingError(400, "Invalid credential input");
        }
      }
      const next = await withOnboardingAccess(async () => {
        const previousCredentials = new Map<string, string | undefined>();
        for (const credential of credentials) {
          previousCredentials.set(credential.ref, await runVault(vault.read(credential.ref)));
        }
        try {
          for (const credential of credentials) {
            if (credential.value) await runVault(vault.write(credential.ref, credential.value));
            else await runVault(vault.remove(credential.ref));
          }
          const current = await readStored();
          const digest = profileDigest(profile);
          const updated = {
            profile,
            probes: current.probes.filter((probe) => probe.profileDigest === digest),
            receipt: current.receipt,
            recovery: current.recovery,
          };
          await writeStored(updated);
          return updated;
        } catch (error) {
          for (const [ref, previous] of previousCredentials) {
            if (previous) await runVault(vault.write(ref, previous));
            else await runVault(vault.remove(ref));
          }
          throw error;
        }
      });
      return Schema.decodeUnknownSync(OnboardingStateSchema)({
        ...next,
        keyring: await keyringStatus(profile, vault),
      });
    },
    catch: (error) =>
      error instanceof AgentOnboardingError
        ? error
        : new AgentOnboardingError(503, "Desktop keyring is unavailable"),
  });
}

async function credentialHeaders(ref: string, vault: OAuthVault): Promise<HeadersInit> {
  if (vault === desktopOAuthVault && !desktopOAuthVaultAvailable()) return {};
  const value = await runVault(vault.read(ref)).catch(() => undefined);
  if (!value) return {};
  if (ref.endsWith(":vault")) return { "X-Vault-Token": value };
  if (ref.endsWith(":gitlab")) return { "PRIVATE-TOKEN": value };
  return { Authorization: `Bearer ${value}` };
}

function probeUrl(profile: OnboardingProfile, target: OnboardingProbeInput["target"]) {
  if (target === "runtime") {
    return runtimeUrl(profile.runtime.baseUrl, "/models");
  }
  if (target === "search") return new URL("/v1/search", profile.search.baseUrl);
  const service = profile.services.find((candidate) => candidate.id === target);
  if (!service) throw new AgentOnboardingError(404, `Unknown onboarding target: ${target}`);
  const base = new URL(service.url);
  if (target === "vault") return new URL("/v1/sys/health", base.origin);
  if (target === "gitlab") return new URL("api/v4/version", service.url);
  return new URL("rest/api/2/serverInfo", service.url);
}

async function probeHttp(
  profile: OnboardingProfile,
  target: Exclude<OnboardingProbeInput["target"], "remote-agent">,
  vault: OAuthVault,
): Promise<OnboardingProbeResult> {
  const url = probeUrl(profile, target);
  validateUrl(url.toString());
  const service = profile.services.find((candidate) => candidate.id === target);
  const ref =
    target === "runtime"
      ? profile.runtime.credentialRef
      : target === "search"
        ? profile.search.credentialRef
        : service?.credentialRef;
  const authHeaders = ref ? await credentialHeaders(ref, vault) : {};
  if (ref && Object.keys(authHeaders).length === 0) {
    return {
      target,
      ok: false,
      status: "Credential unavailable",
      detail: "A secure credential is required before this target can be verified",
      checkedAt: new Date().toISOString(),
    };
  }
  const response = await fetch(url, {
    method: target === "search" ? "POST" : "GET",
    headers: {
      ...(target === "search" ? { "Content-Type": "application/json" } : {}),
      ...authHeaders,
    },
    body:
      target === "search" ? JSON.stringify({ query: "connectivity check", limit: 1 }) : undefined,
    signal: AbortSignal.timeout(8_000),
  });
  await response.body?.cancel();
  const ok = response.ok || (target === "vault" && [429, 472, 473].includes(response.status));
  return {
    target,
    ok,
    status: `HTTP ${response.status}`,
    detail: ok ? url.origin : `Endpoint rejected the probe at ${url.pathname}`,
    checkedAt: new Date().toISOString(),
  };
}

export function probeOnboardingTarget(
  input: OnboardingProbeInput,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<OnboardingProbeResult, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      const stored = await readStored();
      const result =
        input.target === "remote-agent"
          ? await probeSshTarget(stored.profile.remoteAgent.target)
          : await probeHttp(stored.profile, input.target, vault);
      const boundResult = { ...result, profileDigest: profileDigest(stored.profile) };
      await withOnboardingAccess(async () => {
        const current = await readStored();
        if (profileDigest(current.profile) !== boundResult.profileDigest) {
          throw new AgentOnboardingError(409, "Onboarding profile changed during probe");
        }
        await writeStored({
          ...current,
          probes: [
            boundResult,
            ...current.probes.filter((probe) => probe.target !== input.target),
          ].slice(0, 20),
        });
      });
      return boundResult;
    },
    catch: (error) =>
      error instanceof AgentOnboardingError
        ? error
        : new AgentOnboardingError(502, error instanceof Error ? error.message : "Probe failed"),
  });
}

export function recordOnboardingReceipt(
  receipt: OnboardingReceipt,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<OnboardingState, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      const next = await withOnboardingAccess(async () => {
        const stored = await readStored();
        if (receipt.profileDigest !== profileDigest(stored.profile)) {
          throw new AgentOnboardingError(409, "Enrollment receipt does not match the active profile");
        }
        const updated = {
          ...stored,
          receipt: Schema.decodeUnknownSync(OnboardingReceiptSchema)(receipt),
          recovery: null,
        };
        await writeStored(updated);
        return updated;
      });
      return Schema.decodeUnknownSync(OnboardingStateSchema)({
        ...next,
        keyring: await keyringStatus(next.profile, vault),
      });
    },
    catch: (error) =>
      error instanceof AgentOnboardingError
        ? error
        : new AgentOnboardingError(500, "Failed to record onboarding receipt"),
  });
}

export function clearOnboardingReceipt(): Effect.Effect<void, AgentOnboardingError> {
  return Effect.tryPromise({
    try: async () => {
      await withOnboardingAccess(async () => {
        const stored = await readStored();
        await writeStored({ ...stored, receipt: null, recovery: null });
      });
    },
    catch: () => new AgentOnboardingError(500, "Failed to clear onboarding receipt"),
  });
}

export function recordOnboardingRecovery(
  recovery: OnboardingRecovery,
): Effect.Effect<void, AgentOnboardingError> {
  return Effect.tryPromise({
    try: () =>
      withOnboardingAccess(async () => {
        const stored = await readStored();
        await writeStored({
          ...stored,
          recovery: Schema.decodeUnknownSync(OnboardingRecoverySchema)(recovery),
        });
      }),
    catch: () => new AgentOnboardingError(500, "Failed to record onboarding recovery"),
  });
}

export function profileDigest(profile: OnboardingProfile): string {
  const { updatedAt: _, ...materialProfile } = profile;
  return `sha256:${createHash("sha256").update(JSON.stringify(materialProfile)).digest("hex")}`;
}

export function searchFastCrw(
  input: FastCrwSearchInput,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<unknown, AgentOnboardingError> {
  return searchFastCrwHttp(input, {
    loadProfile: async () => (await readStored()).profile,
    credentialHeaders: (ref) => credentialHeaders(ref, vault),
    validateUrl,
  });
}

export function scrapeFastCrw(
  input: FastCrwScrapeInput,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<unknown, AgentOnboardingError> {
  return scrapeFastCrwHttp(input, {
    loadProfile: async () => (await readStored()).profile,
    credentialHeaders: (ref) => credentialHeaders(ref, vault),
    validateUrl,
  });
}

export function mapFastCrw(
  input: FastCrwMapInput,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<unknown, AgentOnboardingError> {
  return mapFastCrwHttp(input, {
    loadProfile: async () => (await readStored()).profile,
    credentialHeaders: (ref) => credentialHeaders(ref, vault),
    validateUrl,
  });
}

export function crawlFastCrw(
  input: FastCrwCrawlInput,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<unknown, AgentOnboardingError> {
  return crawlFastCrwHttp(input, {
    loadProfile: async () => (await readStored()).profile,
    credentialHeaders: (ref) => credentialHeaders(ref, vault),
    validateUrl,
  });
}

export function crawlStatusFastCrw(
  input: FastCrwCrawlStatusInput,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<unknown, AgentOnboardingError> {
  return crawlStatusFastCrwHttp(input, {
    loadProfile: async () => (await readStored()).profile,
    credentialHeaders: (ref) => credentialHeaders(ref, vault),
    validateUrl,
  });
}

export function extractFastCrw(
  input: FastCrwExtractInput,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<unknown, AgentOnboardingError> {
  return extractFastCrwHttp(input, {
    loadProfile: async () => (await readStored()).profile,
    credentialHeaders: (ref) => credentialHeaders(ref, vault),
    validateUrl,
  });
}

export function extractStatusFastCrw(
  input: FastCrwExtractStatusInput,
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<unknown, AgentOnboardingError> {
  return extractStatusFastCrwHttp(input, {
    loadProfile: async () => (await readStored()).profile,
    credentialHeaders: (ref) => credentialHeaders(ref, vault),
    validateUrl,
  });
}

export function proxyOnboardingInference(
  request: Request,
  pathSegments: string[],
  vault: OAuthVault = desktopOAuthVault,
): Effect.Effect<Response, AgentOnboardingError> {
  return proxyInferenceHttp(request, pathSegments, {
    loadProfile: async () => (await readStored()).profile,
    credentialHeaders: (ref) => credentialHeaders(ref, vault),
    validateUrl,
  });
}
