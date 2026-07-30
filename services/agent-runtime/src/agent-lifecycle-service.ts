import { randomUUID } from "node:crypto";
import path from "node:path";
import { Effect, Schema } from "effect";
import {
  AgentLifecycleReceiptSchema,
  AgentLifecycleRecoverySchema,
  AgentTargetReceiptSchema,
  agentLifecycleProfileDigest,
  agentTargetDesiredDigest,
  validateAgentLifecycleProfile,
  type AgentCapability,
  type AgentConfigMutation,
  type AgentExecutionTarget,
  type AgentLifecycleProfile,
  type AgentLifecycleReceipt,
  type AgentLifecycleRecovery,
  type AgentTargetReceipt,
} from "./agent-lifecycle-contract";

export class AgentLifecycleError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly recovery: AgentLifecycleRecovery | null = null,
  ) {
    super(message);
  }
}

export class AgentTargetApplyError extends Error {
  constructor(
    message: string,
    readonly mutations: readonly AgentConfigMutation[],
  ) {
    super(message);
  }
}

export type AgentTargetInspection = {
  desiredDigest: string | null;
  capabilities: readonly AgentCapability[];
};

export interface AgentTargetExecutor {
  inspect(target: AgentExecutionTarget): Promise<AgentTargetInspection>;
  apply(
    target: AgentExecutionTarget,
    desiredDigest: string,
  ): Promise<readonly AgentConfigMutation[]>;
  restore(target: AgentExecutionTarget, mutations: readonly AgentConfigMutation[]): Promise<void>;
}

export type AgentExecutorResolver = (
  target: AgentExecutionTarget,
) => Promise<AgentTargetExecutor> | AgentTargetExecutor;

export type AgentLifecyclePlanItem = {
  target: AgentExecutionTarget;
  desiredDigest: string;
  action: "apply" | "unchanged";
};

const requiredCapabilities: readonly AgentCapability[] = [
  "config.read",
  "config.write",
  "config.restore",
  "inference.invoke",
];
let lifecycleAccess = Promise.resolve();

const exclusive = <A>(operation: () => Promise<A>): Promise<A> => {
  const result = lifecycleAccess.then(operation);
  lifecycleAccess = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const run = <A>(
  operation: () => Promise<A>,
  fallback: string,
): Effect.Effect<A, AgentLifecycleError> =>
  Effect.tryPromise({
    try: operation,
    catch: (error) =>
      error instanceof AgentLifecycleError
        ? error
        : new AgentLifecycleError(500, error instanceof Error ? error.message : fallback),
  });

const assertCapabilities = (
  target: AgentExecutionTarget,
  available: readonly AgentCapability[],
): void => {
  const granted = new Set(target.capabilities);
  const observed = new Set(available);
  const missing = requiredCapabilities.filter(
    (capability) => !granted.has(capability) || !observed.has(capability),
  );
  if (missing.length) {
    throw new AgentLifecycleError(
      403,
      `Agent target "${target.id}" is denied capabilities: ${missing.join(", ")}`,
    );
  }
};

export function planAgentLifecycle(
  input: AgentLifecycleProfile,
  resolveExecutor: AgentExecutorResolver,
): Effect.Effect<readonly AgentLifecyclePlanItem[], AgentLifecycleError> {
  return run(async () => {
    const profile = validateAgentLifecycleProfile(input);
    const planned: AgentLifecyclePlanItem[] = [];
    for (const target of profile.targets) {
      const desiredDigest = agentTargetDesiredDigest(target);
      const inspection = await (await resolveExecutor(target)).inspect(target);
      assertCapabilities(target, inspection.capabilities);
      planned.push({
        target,
        desiredDigest,
        action: inspection.desiredDigest === desiredDigest ? "unchanged" : "apply",
      });
    }
    return planned;
  }, "Failed to plan agent lifecycle");
}

const recovery = (
  operation: "apply" | "revoke",
  profileDigest: string,
  pending: readonly AgentTargetReceipt[],
  failures: readonly string[],
): AgentLifecycleRecovery =>
  Schema.decodeUnknownSync(AgentLifecycleRecoverySchema)({
    id: `agent-recovery-${randomUUID()}`,
    operation,
    profileDigest,
    failedAt: new Date().toISOString(),
    pending,
    failures,
  });

const validateReceiptTarget = (target: AgentExecutionTarget, receipt: AgentTargetReceipt): void => {
  if (
    receipt.machineId !== target.machineId ||
    receipt.accessProfileId !== target.accessProfileId ||
    receipt.desiredDigest !== agentTargetDesiredDigest(target)
  ) {
    throw new AgentLifecycleError(409, `Agent receipt scope is invalid for "${target.id}"`);
  }
  const home = `${path.resolve(target.executionHome)}${path.sep}`;
  for (const mutation of receipt.mutations) {
    if (!path.resolve(mutation.path).startsWith(home)) {
      throw new AgentLifecycleError(409, `Agent mutation path escapes "${target.id}" home`);
    }
    if (mutation.operation === "updated" && (!mutation.backupRef || !mutation.beforeDigest)) {
      throw new AgentLifecycleError(409, `Agent update is not restorable for "${target.id}"`);
    }
    if (
      !/^sha256:[a-f0-9]{64}$/.test(mutation.afterDigest) ||
      (mutation.beforeDigest && !/^sha256:[a-f0-9]{64}$/.test(mutation.beforeDigest)) ||
      (mutation.backupRef &&
        (mutation.backupRef.length > 1024 || /[\u0000-\u001f\u007f]/.test(mutation.backupRef)))
    ) {
      throw new AgentLifecycleError(409, `Agent mutation evidence is invalid for "${target.id}"`);
    }
  }
};

async function restoreTargets(
  targets: ReadonlyMap<string, AgentExecutionTarget>,
  receipts: readonly AgentTargetReceipt[],
  resolveExecutor: AgentExecutorResolver,
): Promise<{ pending: AgentTargetReceipt[]; failures: string[] }> {
  const pending: AgentTargetReceipt[] = [];
  const failures: string[] = [];
  for (const receipt of [...receipts].reverse()) {
    if (receipt.status === "unchanged") continue;
    const target = targets.get(receipt.targetId);
    if (!target) {
      pending.unshift(receipt);
      failures.push(`${receipt.targetId}: target is absent from the active profile`);
      continue;
    }
    validateReceiptTarget(target, receipt);
    try {
      await (await resolveExecutor(target)).restore(target, receipt.mutations);
    } catch (error) {
      pending.unshift(receipt);
      failures.push(`${receipt.targetId}: restoration failed`);
    }
  }
  return { pending, failures };
}

const targetReceipt = (
  target: AgentExecutionTarget,
  desiredDigest: string,
  mutations: readonly AgentConfigMutation[],
): AgentTargetReceipt => {
  const receipt = Schema.decodeUnknownSync(AgentTargetReceiptSchema, {
    onExcessProperty: "error",
  })({
    targetId: target.id,
    machineId: target.machineId,
    accessProfileId: target.accessProfileId,
    desiredDigest,
    status: mutations.length > 0 ? "applied" : "unchanged",
    mutations,
  });
  validateReceiptTarget(target, receipt);
  return receipt;
};

async function applyPlanItem(
  item: AgentLifecyclePlanItem,
  priorReceipt: AgentLifecycleReceipt | null,
  resolveExecutor: AgentExecutorResolver,
): Promise<AgentTargetReceipt> {
  const prior = priorReceipt?.targets.find((entry) => entry.targetId === item.target.id);
  if (prior) validateReceiptTarget(item.target, prior);
  if (item.action === "unchanged") {
    return targetReceipt(item.target, item.desiredDigest, prior?.mutations ?? []);
  }
  const mutations = await (
    await resolveExecutor(item.target)
  ).apply(item.target, item.desiredDigest);
  return targetReceipt(item.target, item.desiredDigest, mutations);
}

async function executePlan(
  plan: readonly AgentLifecyclePlanItem[],
  priorReceipt: AgentLifecycleReceipt | null,
  resolveExecutor: AgentExecutorResolver,
): Promise<AgentTargetReceipt[]> {
  const receipts: AgentTargetReceipt[] = [];
  for (const item of plan) {
    try {
      receipts.push(await applyPlanItem(item, priorReceipt, resolveExecutor));
    } catch (error) {
      if (error instanceof AgentTargetApplyError && error.mutations.length) {
        receipts.push(targetReceipt(item.target, item.desiredDigest, error.mutations));
      }
      throw Object.assign(error instanceof Error ? error : new Error("apply failed"), {
        receipts,
      });
    }
  }
  return receipts;
}

export function applyAgentLifecycle(
  input: AgentLifecycleProfile,
  resolveExecutor: AgentExecutorResolver,
  priorReceiptInput?: AgentLifecycleReceipt,
): Effect.Effect<AgentLifecycleReceipt, AgentLifecycleError> {
  return run(
    () =>
      exclusive(async () => {
        const profile = validateAgentLifecycleProfile(input);
        const profileDigest = agentLifecycleProfileDigest(profile);
        const priorReceipt = priorReceiptInput
          ? Schema.decodeUnknownSync(AgentLifecycleReceiptSchema)(priorReceiptInput)
          : null;
        if (priorReceipt && priorReceipt.profileDigest !== profileDigest) {
          throw new AgentLifecycleError(
            409,
            "Prior agent receipt does not match the active profile",
          );
        }
        const plan = await Effect.runPromise(planAgentLifecycle(profile, resolveExecutor));
        const targetMap = new Map(profile.targets.map((target) => [target.id, target]));
        let receipts: AgentTargetReceipt[] = [];
        try {
          receipts = await executePlan(plan, priorReceipt, resolveExecutor);
        } catch (error) {
          if (error instanceof Error && "receipts" in error && Array.isArray(error.receipts)) {
            receipts = error.receipts as AgentTargetReceipt[];
          }
          const rollback = await restoreTargets(targetMap, receipts, resolveExecutor);
          const failures = ["apply failed", ...rollback.failures];
          const evidence =
            rollback.pending.length > 0
              ? recovery("apply", profileDigest, rollback.pending, failures)
              : null;
          throw new AgentLifecycleError(
            evidence ? 500 : 409,
            evidence ? "Agent apply requires recovery" : "Agent apply rolled back",
            evidence,
          );
        }
        return Schema.decodeUnknownSync(AgentLifecycleReceiptSchema, {
          onExcessProperty: "error",
        })({
          id: `agent-lifecycle-${randomUUID()}`,
          profileDigest,
          appliedAt: new Date().toISOString(),
          targets: receipts,
        });
      }),
    "Failed to apply agent lifecycle",
  );
}

export function revokeAgentLifecycle(
  input: AgentLifecycleProfile,
  receiptInput: AgentLifecycleReceipt,
  resolveExecutor: AgentExecutorResolver,
): Effect.Effect<void, AgentLifecycleError> {
  return run(
    () =>
      exclusive(async () => {
        const profile = validateAgentLifecycleProfile(input);
        const receipt = Schema.decodeUnknownSync(AgentLifecycleReceiptSchema)(receiptInput);
        const profileDigest = agentLifecycleProfileDigest(profile);
        if (receipt.profileDigest !== profileDigest) {
          throw new AgentLifecycleError(409, "Agent receipt does not match the active profile");
        }
        const targetMap = new Map(profile.targets.map((target) => [target.id, target]));
        const result = await restoreTargets(targetMap, receipt.targets, resolveExecutor);
        if (result.failures.length) {
          throw new AgentLifecycleError(
            500,
            "Agent revoke requires recovery",
            recovery("revoke", profileDigest, result.pending, result.failures),
          );
        }
      }),
    "Failed to revoke agent lifecycle",
  );
}

export function recoverAgentLifecycle(
  input: AgentLifecycleProfile,
  recoveryInput: AgentLifecycleRecovery,
  resolveExecutor: AgentExecutorResolver,
): Effect.Effect<void, AgentLifecycleError> {
  return run(
    () =>
      exclusive(async () => {
        const profile = validateAgentLifecycleProfile(input);
        const evidence = Schema.decodeUnknownSync(AgentLifecycleRecoverySchema)(recoveryInput);
        const profileDigest = agentLifecycleProfileDigest(profile);
        if (evidence.profileDigest !== profileDigest) {
          throw new AgentLifecycleError(409, "Agent recovery does not match the active profile");
        }
        const targetMap = new Map(profile.targets.map((target) => [target.id, target]));
        const result = await restoreTargets(targetMap, evidence.pending, resolveExecutor);
        if (result.failures.length) {
          throw new AgentLifecycleError(
            500,
            "Agent recovery remains incomplete",
            recovery(evidence.operation, profileDigest, result.pending, result.failures),
          );
        }
      }),
    "Failed to recover agent lifecycle",
  );
}
