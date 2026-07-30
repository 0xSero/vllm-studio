import { randomUUID } from "node:crypto";
import os from "node:os";
import { Effect } from "effect";
import type { OnboardingReceipt, OnboardingState } from "./agent-onboarding-contract";
import { AgentOnboardingError } from "./agent-onboarding-error";
import { ONBOARDING_REMOTE_AGENT_ALLOW_TOOLS } from "./agent-onboarding-policy";
import {
  clearOnboardingReceipt,
  getOnboardingState,
  profileDigest,
  recordOnboardingReceipt,
  recordOnboardingRecovery,
} from "./agent-onboarding-service";
import {
  listConnectors,
  removeConnector,
  upsertConnector,
  type ConnectorConfig,
} from "./connectors-service";
import {
  attachModelToAgents,
  LOCAL_AGENT_IDS,
  revokeAgentAttachments,
  type AttachResult,
  type LocalAgentId,
} from "./local-agents";
import { resolveBundledMcpServerPath } from "./pi-runtime-helpers";

const connectorId = "onboarding-remote-agent";
const connectorOrigin = {
  kind: "onboarding",
  id: "agent-onboarding",
  binding: "remote-agent",
} as const;

const selectedLocalAgents = (values: readonly string[]): LocalAgentId[] =>
  values.filter((value): value is LocalAgentId =>
    (LOCAL_AGENT_IDS as readonly string[]).includes(value),
  );

const readState = (): Promise<OnboardingState> => Effect.runPromise(getOnboardingState());

const requiredCredentialRefs = (state: OnboardingState): string[] => [
  state.profile.runtime.credentialRef,
  ...state.profile.services
    .filter((service) => service.enabled)
    .map((service) => service.credentialRef),
  ...(state.profile.search.enabled ? [state.profile.search.credentialRef] : []),
];

const frontendBase = (): string => {
  const raw = process.env.LOCAL_STUDIO_FRONTEND_BASE?.trim();
  if (!raw) throw new AgentOnboardingError(503, "Frontend base URL is not configured");
  const url = new URL(raw);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol === "http:" && !loopback) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new AgentOnboardingError(503, "Frontend base URL is invalid");
  }
  return url.toString().replace(/\/+$/, "");
};

const verifyRequiredProbes = (state: OnboardingState): void => {
  const availableCredentials = new Set(state.keyring.credentialRefs);
  const missingCredentials = requiredCredentialRefs(state).filter(
    (ref) => ref.trim() && !availableCredentials.has(ref),
  );
  if (missingCredentials.length) {
    throw new AgentOnboardingError(
      409,
      `Secure credentials required: ${missingCredentials.join(", ")}`,
    );
  }
  const required = [
    "runtime",
    ...state.profile.services.filter((service) => service.enabled).map((service) => service.id),
    ...(state.profile.search.enabled ? ["search"] : []),
    ...(state.profile.remoteAgent.enabled ? ["remote-agent"] : []),
  ];
  const cutoff = Date.now() - 10 * 60 * 1000;
  const digest = profileDigest(state.profile);
  const missing = required.filter((target) => {
    const probe = state.probes.find((candidate) => candidate.target === target);
    return !probe?.ok || probe.profileDigest !== digest || Date.parse(probe.checkedAt) < cutoff;
  });
  if (missing.length) {
    throw new AgentOnboardingError(
      409,
      `Current successful probes required: ${missing.join(", ")}`,
    );
  }
};

const configureRemoteAgent = async (target: string): Promise<void> => {
  const serverPath = resolveBundledMcpServerPath("ssh-remote.mjs");
  if (!serverPath) throw new AgentOnboardingError(500, "Bundled SSH agent server is missing");
  await upsertConnector({
    id: connectorId,
    name: `Remote agent: ${target}`,
    transport: "stdio",
    command: "node",
    args: [serverPath],
    env: { SSH_HOST: target },
    allowTools: [...ONBOARDING_REMOTE_AGENT_ALLOW_TOOLS],
    origin: connectorOrigin,
    enabled: true,
  });
};

const isOwnedConnector = (connector: ConnectorConfig): boolean =>
  connector.id === connectorId &&
  connector.origin?.kind === connectorOrigin.kind &&
  connector.origin.id === connectorOrigin.id &&
  connector.origin.binding === connectorOrigin.binding &&
  Object.keys(connector.env ?? {}).every((key) => key === "SSH_HOST") &&
  !connector.headers;

const restoreRemoteAgentConnector = async (
  previous: ConnectorConfig | null | undefined,
): Promise<void> => {
  if (previous) {
    await upsertConnector(previous);
    return;
  }
  await removeConnector(connectorId);
};

export async function applyOnboarding(): Promise<OnboardingState> {
  let results: AttachResult[] = [];
  let previousConnector: ConnectorConfig | undefined;
  let connectorChanged = false;
  try {
    const state = await readState();
    if (state.recovery) {
      throw new AgentOnboardingError(409, "Resolve the recorded onboarding recovery before apply");
    }
    verifyRequiredProbes(state);
    if (state.receipt) {
      if (state.receipt.profileDigest === profileDigest(state.profile)) return state;
      throw new AgentOnboardingError(
        409,
        "Revoke the active enrollment before applying a replacement",
      );
    }
    results = await attachModelToAgents({
      home: os.homedir(),
      targets: selectedLocalAgents(state.profile.localAgents),
      model: {
        modelId: state.profile.runtime.modelId,
        displayName: state.profile.runtime.modelId,
        baseUrl: `${frontendBase()}/api/agent/onboarding/inference/v1`,
        apiKey: "local-studio-keyring",
        contextWindow: state.profile.runtime.contextWindow,
        reasoning: true,
        images: false,
      },
    });
    const failed = results.filter((result) => !result.ok);
    if (failed.length) {
      throw new AgentOnboardingError(
        500,
        `Agent enrollment rolled back: ${failed.map((result) => result.agent).join(", ")}`,
      );
    }
    previousConnector = (await listConnectors()).find((connector) => connector.id === connectorId);
    if (previousConnector && !isOwnedConnector(previousConnector)) {
      throw new AgentOnboardingError(
        409,
        "Remote connector ownership conflicts with agent onboarding",
      );
    }
    connectorChanged = true;
    if (state.profile.remoteAgent.enabled) {
      await configureRemoteAgent(state.profile.remoteAgent.target);
    } else {
      await removeConnector(connectorId);
    }
    const receipt: OnboardingReceipt = {
      id: `onboarding-${randomUUID()}`,
      profileDigest: profileDigest(state.profile),
      appliedAt: new Date().toISOString(),
      localAgentResults: results,
      probes: state.probes,
      previousConnector: previousConnector ?? null,
    };
    return Effect.runPromise(recordOnboardingReceipt(receipt));
  } catch (error) {
    const rollbackFailures: string[] = [];
    if (results.some((result) => result.ok)) {
      await revokeAgentAttachments(os.homedir(), results).catch((cause) => {
        rollbackFailures.push(
          `local agents: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      });
    }
    if (connectorChanged) {
      await restoreRemoteAgentConnector(previousConnector).catch((cause) => {
        rollbackFailures.push(
          `remote connector: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      });
    }
    if (rollbackFailures.length) {
      const state = await readState().catch(() => null);
      if (state) {
        await Effect.runPromise(
          recordOnboardingRecovery({
            id: `recovery-${randomUUID()}`,
            operation: "apply",
            failedAt: new Date().toISOString(),
            profileDigest: profileDigest(state.profile),
            failures: rollbackFailures,
            localAgentResults: results,
            previousConnector: previousConnector ?? null,
          }),
        ).catch(() => undefined);
      }
      throw new AgentOnboardingError(
        500,
        `Enrollment rollback requires recovery: ${rollbackFailures.join("; ")}`,
      );
    }
    throw error;
  }
}

export async function revokeOnboarding(): Promise<OnboardingState> {
  const state = await readState();
  const failures: string[] = [];
  const localAgentResults =
    state.receipt?.localAgentResults ?? state.recovery?.localAgentResults ?? [];
  const previousConnector =
    state.receipt?.previousConnector ?? state.recovery?.previousConnector ?? null;
  const retrying = state.recovery !== null;
  const restoreLocal =
    !retrying || state.recovery?.failures.some((failure) => failure.startsWith("local agents:"));
  const restoreConnector =
    !retrying ||
    state.recovery?.failures.some((failure) => failure.startsWith("remote connector:"));
  if (restoreLocal && localAgentResults.length) {
    await revokeAgentAttachments(os.homedir(), localAgentResults as AttachResult[]).catch(
      (cause) => {
        failures.push(`local agents: ${cause instanceof Error ? cause.message : String(cause)}`);
      },
    );
  }
  if (restoreConnector) {
    await restoreRemoteAgentConnector(previousConnector as ConnectorConfig | null).catch(
      (cause) => {
        failures.push(
          `remote connector: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      },
    );
  }
  if (failures.length === 0) {
    try {
      await Effect.runPromise(clearOnboardingReceipt());
      return await readState();
    } catch (cause) {
      failures.push(`receipt: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  await Effect.runPromise(
    recordOnboardingRecovery({
      id: `recovery-${randomUUID()}`,
      operation: "revoke",
      failedAt: new Date().toISOString(),
      profileDigest: profileDigest(state.profile),
      failures,
      localAgentResults,
      previousConnector,
    }),
  ).catch(() => undefined);
  throw new AgentOnboardingError(
    500,
    `Enrollment revocation requires recovery: ${failures.join("; ")}`,
  );
}
