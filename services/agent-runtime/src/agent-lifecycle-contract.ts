import { createHash } from "node:crypto";
import { Schema } from "effect";
import { OnboardingProfileSchema } from "./agent-onboarding-contract";
import {
  AgentLifecycleProfileSchema,
  type AgentExecutionTarget,
  type AgentLifecycleProfile,
  type AgentTargetId,
} from "./agent-lifecycle-view-contract";
export * from "./agent-lifecycle-view-contract";

const decodeV1 = Schema.decodeUnknownSync(OnboardingProfileSchema, {
  onExcessProperty: "error",
});
const decodeV2 = Schema.decodeUnknownSync(AgentLifecycleProfileSchema, {
  onExcessProperty: "error",
});
const agentIds = new Set<AgentTargetId>(["pi", "opencode", "droid", "hermes", "omp"]);
const targetRefPattern = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/;
const machineIdPattern = /^[a-z0-9][a-z0-9-]{0,62}$/;

const digest = (value: unknown): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

const canonicalTarget = (target: AgentExecutionTarget) => ({
  ...target,
  capabilities: [...target.capabilities].sort(),
});

export function migrateAgentLifecycleProfile(
  input: unknown,
  locality: {
    machineId: string;
    accessProfileId: string;
    executionHome: string;
    inferenceEndpoint: string;
    credentialRef: string;
  },
): AgentLifecycleProfile {
  if (typeof input === "object" && input !== null && "version" in input && input.version === 2) {
    return validateAgentLifecycleProfile(input);
  }
  const legacy = decodeV1(input);
  const localAgents = legacy.localAgents.map((agent) => {
    if (!agentIds.has(agent as AgentTargetId)) {
      throw new Error(`Unknown local agent "${agent}"`);
    }
    return agent as AgentTargetId;
  });
  return validateAgentLifecycleProfile({
    version: 2,
    classification: legacy.classification,
    targets: localAgents.map((agentId) => ({
      id: `${locality.machineId}:${agentId}`,
      agentId,
      machineId: locality.machineId,
      accessProfileId: locality.accessProfileId,
      mode: "local" as const,
      executionHome: locality.executionHome,
      inferenceEndpoint: locality.inferenceEndpoint,
      credentialRef: locality.credentialRef,
      modelId: legacy.runtime.modelId,
      contextWindow: legacy.runtime.contextWindow,
      capabilities: [
        "config.read" as const,
        "config.write" as const,
        "config.restore" as const,
        "inference.invoke" as const,
      ],
    })),
    updatedAt: legacy.updatedAt,
  });
}

export function validateAgentLifecycleProfile(input: unknown): AgentLifecycleProfile {
  const profile = decodeV2(input);
  const targetIds = new Set<string>();
  const targetBindings = new Set<string>();
  if (Number.isNaN(Date.parse(profile.updatedAt))) {
    throw new Error("Agent lifecycle updatedAt must be an ISO timestamp");
  }
  for (const target of profile.targets) {
    if (!targetRefPattern.test(target.id) || targetIds.has(target.id)) {
      throw new Error(`Agent target id must be non-empty and unique: "${target.id}"`);
    }
    targetIds.add(target.id);
    const binding = `${target.machineId}:${target.agentId}`;
    if (targetBindings.has(binding)) {
      throw new Error(`Agent target binding must be unique: "${binding}"`);
    }
    targetBindings.add(binding);
    if (
      !machineIdPattern.test(target.machineId) ||
      !targetRefPattern.test(target.accessProfileId) ||
      !target.executionHome.startsWith("/") ||
      target.executionHome.length > 1024 ||
      !target.modelId.trim() ||
      target.modelId.length > 256 ||
      !Number.isFinite(target.contextWindow) ||
      !Number.isInteger(target.contextWindow) ||
      target.contextWindow < 1 ||
      target.contextWindow > 16_777_216
    ) {
      throw new Error(`Agent target "${target.id}" is incomplete`);
    }
    let endpoint: URL;
    try {
      endpoint = new URL(target.inferenceEndpoint);
    } catch {
      throw new Error(`Agent target "${target.id}" has an invalid inference endpoint`);
    }
    const loopback = ["127.0.0.1", "::1", "localhost"].includes(endpoint.hostname);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      (endpoint.protocol === "http:" && !loopback) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      throw new Error(`Agent target "${target.id}" has an invalid inference endpoint`);
    }
    if (
      target.credentialRef.length > 256 ||
      !/^(keyring|vault):[a-zA-Z0-9][a-zA-Z0-9:._-]+$/.test(target.credentialRef)
    ) {
      throw new Error(`Agent target "${target.id}" has an invalid credential reference`);
    }
    const capabilities = new Set(target.capabilities);
    if (capabilities.size !== target.capabilities.length) {
      throw new Error(`Agent target "${target.id}" repeats a capability`);
    }
  }
  return profile;
}

export function agentLifecycleProfileDigest(profile: AgentLifecycleProfile): string {
  const { updatedAt: _, ...material } = profile;
  return digest({
    ...material,
    targets: [...material.targets]
      .map(canonicalTarget)
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

export function agentTargetDesiredDigest(target: AgentExecutionTarget): string {
  return digest(canonicalTarget(target));
}
