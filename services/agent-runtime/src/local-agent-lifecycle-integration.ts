import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Schema } from "effect";
import {
  AgentConfigMutationSchema,
  type AgentConfigMutation,
  type AgentExecutionTarget,
} from "./agent-lifecycle-contract";
import {
  AgentLifecycleError,
  AgentTargetApplyError,
  type AgentTargetExecutor,
} from "./agent-lifecycle-service";
import type { AgentLifecycleIntegration } from "./agent-lifecycle-controller";
import { attachModelToAgents } from "./local-agents";

const capabilities = ["config.read", "config.write", "config.restore", "inference.invoke"] as const;
const decodeMutations = Schema.decodeUnknownSync(Schema.Array(AgentConfigMutationSchema), {
  onExcessProperty: "error",
});
const decodeMutation = Schema.decodeUnknownSync(AgentConfigMutationSchema, {
  onExcessProperty: "error",
});

const digest = (value: Uint8Array | string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const markerPath = (target: AgentExecutionTarget) =>
  path.join(target.executionHome, ".local-studio", "agent-lifecycle", `${target.agentId}.json`);

const assertWithinHome = (home: string, file: string) => {
  const root = `${path.resolve(home)}${path.sep}`;
  if (!path.resolve(file).startsWith(root)) {
    throw new AgentLifecycleError(409, "Agent configuration path escapes execution home");
  }
};

const assertPathHierarchy = async (home: string, file: string) => {
  assertWithinHome(home, file);
  const resolvedHome = path.resolve(home);
  if ((await lstat(resolvedHome)).isSymbolicLink()) {
    throw new AgentLifecycleError(409, "Agent execution home must not be a symbolic link");
  }
  const relative = path.relative(resolvedHome, path.resolve(file));
  let cursor = resolvedHome;
  for (const segment of relative.split(path.sep)) {
    cursor = path.join(cursor, segment);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) {
        throw new AgentLifecycleError(409, "Agent configuration path contains a symbolic link");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      break;
    }
  }
};

const candidatePaths = (target: AgentExecutionTarget): string[] => {
  const home = target.executionHome;
  if (target.agentId === "pi") return [path.join(home, ".pi", "agent", "models.json")];
  if (target.agentId === "opencode") {
    return [
      path.join(home, ".config", "opencode", "opencode.json"),
      path.join(home, ".opencode", "config.json"),
    ];
  }
  if (target.agentId === "droid") return [path.join(home, ".factory", "settings.json")];
  if (target.agentId === "hermes") return [path.join(home, ".hermes", "config.yaml")];
  return [
    path.join(home, ".omp", "agent", "models.yml"),
    path.join(home, ".omp", "agent", "models.json"),
    path.join(home, ".omp", "agent", "config.yml"),
  ];
};

const readDigest = async (file: string): Promise<string | null> => {
  try {
    return digest(await readFile(file));
  } catch {
    return null;
  }
};

const backup = async (file: string): Promise<string | undefined> => {
  try {
    await stat(file);
  } catch {
    return undefined;
  }
  const destination = `${file}.backup-${randomUUID()}`;
  await copyFile(file, destination);
  await chmod(destination, 0o600);
  return destination;
};

const writeMarker = async (
  target: AgentExecutionTarget,
  desiredDigest: string,
  configDigests: Readonly<Record<string, string>>,
  baseline: readonly AgentConfigMutation[],
  priorMarker?: AgentConfigMutation,
): Promise<AgentConfigMutation> => {
  const file = markerPath(target);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const beforeDigest = await readDigest(file);
  const backupRef = await backup(file);
  const content = `${JSON.stringify({ desiredDigest, configDigests, baseline }, null, 2)}\n`;
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, content, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
  await chmod(file, 0o600);
  const current: AgentConfigMutation = {
    path: file,
    operation: beforeDigest ? "updated" : "created",
    ...(backupRef && beforeDigest ? { backupRef, beforeDigest } : {}),
    afterDigest: digest(content),
  };
  if (!priorMarker) return current;
  if (current.backupRef) await rm(current.backupRef, { force: true });
  return { ...priorMarker, afterDigest: current.afterDigest };
};

const restoreMutation = async (mutation: AgentConfigMutation): Promise<void> => {
  if (mutation.operation === "created") {
    await rm(mutation.path, { force: true });
    return;
  }
  if (!mutation.backupRef) throw new Error("Agent backup is unavailable");
  if ((await lstat(mutation.backupRef)).isSymbolicLink()) {
    throw new Error("Agent backup must not be a symbolic link");
  }
  await rename(mutation.backupRef, mutation.path);
  await chmod(mutation.path, 0o600);
};

export class LocalAgentLifecycleExecutor implements AgentTargetExecutor {
  async inspect(target: AgentExecutionTarget) {
    try {
      const marker = JSON.parse(await readFile(markerPath(target), "utf8")) as {
        desiredDigest?: unknown;
        configDigests?: unknown;
      };
      if (
        typeof marker.desiredDigest !== "string" ||
        !marker.configDigests ||
        typeof marker.configDigests !== "object"
      ) {
        return { desiredDigest: null, capabilities };
      }
      for (const [file, expected] of Object.entries(marker.configDigests)) {
        if (typeof expected !== "string" || (await readDigest(file)) !== expected) {
          return { desiredDigest: null, capabilities };
        }
      }
      return { desiredDigest: marker.desiredDigest, capabilities };
    } catch {
      return { desiredDigest: null, capabilities };
    }
  }

  async apply(target: AgentExecutionTarget, desiredDigest: string) {
    for (const candidate of candidatePaths(target)) {
      await assertPathHierarchy(target.executionHome, candidate);
    }
    await assertPathHierarchy(target.executionHome, markerPath(target));
    let priorBaseline: readonly AgentConfigMutation[] = [];
    let priorMarker: AgentConfigMutation | undefined;
    try {
      const marker = JSON.parse(await readFile(markerPath(target), "utf8")) as {
        baseline?: unknown;
        marker?: unknown;
      };
      if (Array.isArray(marker.baseline)) priorBaseline = decodeMutations(marker.baseline);
      if (marker.marker && typeof marker.marker === "object") {
        priorMarker = decodeMutation(marker.marker);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new AgentLifecycleError(409, "Agent lifecycle marker is invalid");
      }
    }
    const [result] = await attachModelToAgents({
      home: target.executionHome,
      targets: [target.agentId],
      model: {
        modelId: target.modelId,
        displayName: target.modelId,
        baseUrl: target.inferenceEndpoint,
        apiKey: target.credentialRef,
        contextWindow: target.contextWindow,
        reasoning: true,
        images: false,
      },
    });
    if (!result?.ok) {
      throw new AgentLifecycleError(
        409,
        result?.error || `Agent "${target.agentId}" is unavailable`,
      );
    }
    const paths = [
      { configPath: result.configPath, backupPath: result.backupPath },
      ...(result.extraUpdates ?? []),
    ];
    const mutations: AgentConfigMutation[] = [];
    const configDigests: Record<string, string> = {};
    for (const item of paths) {
      await assertPathHierarchy(target.executionHome, item.configPath);
      if (item.backupPath) await assertPathHierarchy(target.executionHome, item.backupPath);
      const afterDigest = await readDigest(item.configPath);
      if (!afterDigest) throw new Error(`Agent configuration was not written: ${item.configPath}`);
      configDigests[item.configPath] = afterDigest;
      const beforeDigest = item.backupPath ? await readDigest(item.backupPath) : null;
      const current: AgentConfigMutation = {
        path: item.configPath,
        operation: item.backupPath ? "updated" : "created",
        ...(item.backupPath && beforeDigest ? { backupRef: item.backupPath, beforeDigest } : {}),
        afterDigest,
      };
      const baseline = priorBaseline.find((mutation) => mutation.path === item.configPath);
      if (baseline) {
        if (current.backupRef) await rm(current.backupRef, { force: true });
        mutations.push({ ...baseline, afterDigest });
      } else {
        mutations.push(current);
      }
    }
    try {
      const markerMutation = await writeMarker(
        target,
        desiredDigest,
        configDigests,
        mutations,
        priorMarker,
      );
      const markerFile = markerPath(target);
      const markerContent = JSON.parse(await readFile(markerFile, "utf8")) as Record<
        string,
        unknown
      >;
      markerContent.marker = markerMutation;
      const temporary = `${markerFile}.tmp-${process.pid}-${randomUUID()}`;
      const content = `${JSON.stringify(markerContent, null, 2)}\n`;
      await writeFile(temporary, content, { mode: 0o600 });
      await rename(temporary, markerFile);
      await chmod(markerFile, 0o600);
      mutations.push({ ...markerMutation, afterDigest: digest(content) });
    } catch (error) {
      throw new AgentTargetApplyError(
        error instanceof Error ? error.message : "Agent lifecycle marker failed",
        mutations,
      );
    }
    return mutations;
  }

  async restore(target: AgentExecutionTarget, mutations: readonly AgentConfigMutation[]) {
    for (const mutation of [...mutations].reverse()) {
      await assertPathHierarchy(target.executionHome, mutation.path);
      if (mutation.backupRef) {
        await assertPathHierarchy(target.executionHome, mutation.backupRef);
      }
      await restoreMutation(mutation);
    }
  }
}

export const productionLocalAgentIntegration = (): AgentLifecycleIntegration => ({
  resolve: async (target) => {
    if (target.mode !== "local") {
      throw new AgentLifecycleError(503, `Agent target "${target.id}" requires remote transport`);
    }
    return {
      machineReady: true,
      accessReady: true,
      executor: new LocalAgentLifecycleExecutor(),
    };
  },
});
