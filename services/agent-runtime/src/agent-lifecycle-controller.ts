import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Effect, Schema } from "effect";
import { resolveDataDir } from "./data-dir";
import {
  AgentLifecycleProfileSchema,
  AgentLifecycleReceiptSchema,
  AgentLifecycleRecoverySchema,
  agentLifecycleProfileDigest,
  migrateAgentLifecycleProfile,
  type AgentCapability,
  type AgentConfigMutation,
  type AgentExecutionTarget,
  type AgentLifecycleProfile,
  type AgentLifecycleReceipt,
  type AgentLifecycleRecovery,
} from "./agent-lifecycle-contract";
import {
  AgentLifecycleError,
  applyAgentLifecycle,
  planAgentLifecycle,
  recoverAgentLifecycle,
  revokeAgentLifecycle,
  type AgentExecutorResolver,
  type AgentTargetExecutor,
} from "./agent-lifecycle-service";

const StoredLifecycleSchema = Schema.Struct({
  version: Schema.Literal(1),
  profile: Schema.NullOr(AgentLifecycleProfileSchema),
  receipt: Schema.NullOr(AgentLifecycleReceiptSchema),
  recovery: Schema.NullOr(AgentLifecycleRecoverySchema),
  updatedAt: Schema.String,
});

const PlanInputSchema = Schema.Struct({
  profile: Schema.Unknown,
  locality: Schema.Struct({
    machineId: Schema.String,
    accessProfileId: Schema.String,
    executionHome: Schema.String,
    inferenceEndpoint: Schema.String,
    credentialRef: Schema.String,
  }),
});

export type AgentLifecycleIntegration = {
  resolve(target: AgentExecutionTarget): Promise<{
    machineReady: boolean;
    accessReady: boolean;
    executor: AgentTargetExecutor;
  }>;
};

type StoredLifecycle = typeof StoredLifecycleSchema.Type;

const digest = (value: Uint8Array | string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const storedFile = () => path.join(resolveDataDir(), "agent-lifecycle-state.json");
export const localFixtureHome = () => path.join(resolveDataDir(), "agent-lifecycle-fixture");

const emptyState = (): StoredLifecycle => ({
  version: 1,
  profile: null,
  receipt: null,
  recovery: null,
  updatedAt: new Date(0).toISOString(),
});

const readState = async (): Promise<StoredLifecycle> => {
  if (!existsSync(storedFile())) return emptyState();
  return Schema.decodeUnknownSync(StoredLifecycleSchema, {
    onExcessProperty: "error",
  })(JSON.parse(await readFile(storedFile(), "utf8")));
};

const writeState = async (state: StoredLifecycle): Promise<void> => {
  const file = storedFile();
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  await chmod(file, 0o600);
};

const fixturePath = (target: AgentExecutionTarget) =>
  path.join(target.executionHome, `${encodeURIComponent(target.id)}.json`);

const fixtureCapabilities: readonly AgentCapability[] = [
  "config.read",
  "config.write",
  "config.restore",
  "inference.invoke",
];

export class LocalFixtureAgentExecutor implements AgentTargetExecutor {
  async inspect(target: AgentExecutionTarget) {
    try {
      const parsed = JSON.parse(await readFile(fixturePath(target), "utf8")) as {
        desiredDigest?: unknown;
      };
      return {
        desiredDigest: typeof parsed.desiredDigest === "string" ? parsed.desiredDigest : null,
        capabilities: fixtureCapabilities,
      };
    } catch {
      return { desiredDigest: null, capabilities: fixtureCapabilities };
    }
  }

  async apply(target: AgentExecutionTarget, desiredDigest: string) {
    await mkdir(target.executionHome, { recursive: true, mode: 0o700 });
    const file = fixturePath(target);
    const existed = existsSync(file);
    const previous = existed ? await readFile(file) : null;
    const backupRef = existed ? `${file}.backup-${randomUUID()}` : undefined;
    if (backupRef && previous) {
      await writeFile(backupRef, previous, { mode: 0o600 });
      await chmod(backupRef, 0o600);
    }
    const payload = JSON.stringify({
      agentId: target.agentId,
      machineId: target.machineId,
      accessProfileId: target.accessProfileId,
      inferenceEndpoint: target.inferenceEndpoint,
      credentialRef: target.credentialRef,
      modelId: target.modelId,
      contextWindow: target.contextWindow,
      desiredDigest,
    });
    const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, payload, { mode: 0o600 });
    await rename(temporary, file);
    await chmod(file, 0o600);
    return [
      {
        path: file,
        operation: existed ? ("updated" as const) : ("created" as const),
        ...(backupRef ? { backupRef, beforeDigest: digest(previous!) } : {}),
        afterDigest: digest(payload),
      },
    ];
  }

  async restore(_target: AgentExecutionTarget, mutations: readonly AgentConfigMutation[]) {
    for (const mutation of [...mutations].reverse()) {
      if (mutation.operation === "created") {
        await rm(mutation.path, { force: true });
      } else {
        if (!mutation.backupRef) throw new Error("Backup is unavailable");
        await copyFile(mutation.backupRef, mutation.path);
        await chmod(mutation.path, 0o600);
        await rm(mutation.backupRef, { force: true });
      }
    }
  }
}

export const localFixtureIntegration = (): AgentLifecycleIntegration => ({
  resolve: async (target) => {
    const fixtureHome = path.resolve(localFixtureHome());
    const executionHome = path.resolve(target.executionHome);
    if (
      target.mode !== "local" ||
      target.machineId !== "local-host" ||
      target.accessProfileId !== "local-loopback" ||
      executionHome !== fixtureHome
    ) {
      throw new AgentLifecycleError(503, "Agent target has no configured integration resolver");
    }
    return {
      machineReady: true,
      accessReady: true,
      executor: new LocalFixtureAgentExecutor(),
    };
  },
});

const resolver =
  (integration: AgentLifecycleIntegration): AgentExecutorResolver =>
  async (target) => {
    const resolved = await integration.resolve(target);
    if (!resolved.machineReady) {
      throw new AgentLifecycleError(409, `Machine is not ready for agent target "${target.id}"`);
    }
    if (!resolved.accessReady) {
      throw new AgentLifecycleError(409, `Access is not ready for agent target "${target.id}"`);
    }
    return resolved.executor;
  };

let controllerAccess = Promise.resolve();

const exclusive = <A>(operation: () => Promise<A>): Promise<A> => {
  const result = controllerAccess.then(operation);
  controllerAccess = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

export class AgentLifecycleController {
  constructor(
    private readonly integration: AgentLifecycleIntegration = localFixtureIntegration(),
  ) {}

  get(): Promise<StoredLifecycle> {
    return readState();
  }

  plan(input: unknown): Promise<StoredLifecycle & { actions: readonly string[] }> {
    return exclusive(async () => {
      const parsed = Schema.decodeUnknownSync(PlanInputSchema, {
        onExcessProperty: "error",
      })(input);
      const profile = migrateAgentLifecycleProfile(parsed.profile, parsed.locality);
      const planned = await Effect.runPromise(
        planAgentLifecycle(profile, resolver(this.integration)),
      );
      const current = await readState();
      if (
        current.receipt &&
        current.receipt.profileDigest !== agentLifecycleProfileDigest(profile)
      ) {
        throw new AgentLifecycleError(409, "Revoke the active agent lifecycle before replacement");
      }
      const state = {
        version: 1 as const,
        profile,
        receipt: current.receipt,
        recovery: null,
        updatedAt: new Date().toISOString(),
      };
      await writeState(state);
      return { ...state, actions: planned.map((item) => `${item.action}:${item.target.id}`) };
    });
  }

  apply(): Promise<StoredLifecycle> {
    return exclusive(async () => {
      const state = await readState();
      if (!state.profile) throw new AgentLifecycleError(409, "Agent lifecycle plan is required");
      if (state.recovery)
        throw new AgentLifecycleError(409, "Agent lifecycle recovery is required");
      try {
        const receipt = await Effect.runPromise(
          applyAgentLifecycle(
            state.profile,
            resolver(this.integration),
            state.receipt ?? undefined,
          ),
        );
        const next = { ...state, receipt, recovery: null, updatedAt: new Date().toISOString() };
        await writeState(next);
        return next;
      } catch (error) {
        if (error instanceof AgentLifecycleError && error.recovery) {
          await writeState({
            ...state,
            recovery: error.recovery,
            updatedAt: new Date().toISOString(),
          });
        }
        throw error;
      }
    });
  }

  revoke(): Promise<StoredLifecycle> {
    return exclusive(async () => {
      const state = await readState();
      if (!state.profile || !state.receipt) return state;
      try {
        await Effect.runPromise(
          revokeAgentLifecycle(state.profile, state.receipt, resolver(this.integration)),
        );
        const next = {
          ...state,
          receipt: null,
          recovery: null,
          updatedAt: new Date().toISOString(),
        };
        await writeState(next);
        return next;
      } catch (error) {
        if (error instanceof AgentLifecycleError && error.recovery) {
          await writeState({
            ...state,
            recovery: error.recovery,
            updatedAt: new Date().toISOString(),
          });
        }
        throw error;
      }
    });
  }

  recover(): Promise<StoredLifecycle> {
    return exclusive(async () => {
      const state = await readState();
      if (!state.profile || !state.recovery) {
        throw new AgentLifecycleError(409, "Agent lifecycle recovery is not required");
      }
      await Effect.runPromise(
        recoverAgentLifecycle(state.profile, state.recovery, resolver(this.integration)),
      );
      const next = { ...state, receipt: null, recovery: null, updatedAt: new Date().toISOString() };
      await writeState(next);
      return next;
    });
  }
}
