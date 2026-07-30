import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalAgentLifecycleExecutor } from "../src/local-agent-lifecycle-integration";
import type { AgentExecutionTarget, AgentTargetId } from "../src/agent-lifecycle-contract";

const fixtures: Record<AgentTargetId, { file: string; content: string }> = {
  pi: { file: ".pi/agent/models.json", content: '{"sentinel":"pi"}\n' },
  opencode: {
    file: ".config/opencode/opencode.json",
    content: '{"$schema":"https://opencode.ai/config.json","sentinel":"opencode"}\n',
  },
  droid: { file: ".factory/settings.json", content: '{"sentinel":"droid"}\n' },
  hermes: { file: ".hermes/config.yaml", content: "sentinel: hermes\n" },
  omp: { file: ".omp/agent/models.yml", content: "sentinel: omp\n" },
};

const target = (home: string, agentId: AgentTargetId): AgentExecutionTarget => ({
  id: `local-host:${agentId}`,
  agentId,
  machineId: "local-host",
  accessProfileId: "local-loopback",
  mode: "local",
  executionHome: home,
  inferenceEndpoint: "http://127.0.0.1:3000/api/agent/onboarding/inference/v1",
  credentialRef: "keyring:runtime:inference",
  modelId: "qwen3-next-80b-a3b-nvfp4",
  contextWindow: 32768,
  capabilities: ["config.read", "config.write", "config.restore", "inference.invoke"],
});

describe("real local agent lifecycle adapters", () => {
  for (const agentId of Object.keys(fixtures) as AgentTargetId[]) {
    test(`${agentId} applies, detects drift, and restores exact bytes`, async () => {
      const home = await mkdtemp(path.join(tmpdir(), `agent-lifecycle-${agentId}-`));
      const fixture = fixtures[agentId];
      const file = path.join(home, fixture.file);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, fixture.content, { mode: 0o600 });
      if (agentId === "omp") {
        await writeFile(path.join(home, ".omp/agent/config.yml"), "enabledModels: []\n", {
          mode: 0o600,
        });
      }
      const executor = new LocalAgentLifecycleExecutor();
      const desiredDigest = `sha256:${"a".repeat(64)}`;
      try {
        const mutations = await executor.apply(target(home, agentId), desiredDigest);
        expect(mutations.length).toBeGreaterThanOrEqual(2);
        for (const mutation of mutations) {
          if (mutation.backupRef) {
            expect((await stat(mutation.backupRef)).mode & 0o777).toBe(0o600);
          }
        }
        expect((await executor.inspect(target(home, agentId))).desiredDigest).toBe(desiredDigest);
        const configured = await readFile(file, "utf8");
        expect(configured).toContain("keyring:runtime:inference");
        expect(configured).not.toContain("LOCAL_STUDIO_AGENT_LIFECYCLE_TOKEN");
        await writeFile(file, `${configured}\n`, { mode: 0o600 });
        expect((await executor.inspect(target(home, agentId))).desiredDigest).toBeNull();
        const reconciled = await executor.apply(target(home, agentId), desiredDigest);
        expect(reconciled[0]?.backupRef).toBe(mutations[0]?.backupRef);
        await executor.restore(target(home, agentId), reconciled);
        expect(await readFile(file, "utf8")).toBe(fixture.content);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    });
  }

  test("rejects a symbolic-link configuration hierarchy before mutation", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "agent-lifecycle-symlink-home-"));
    const outside = await mkdtemp(path.join(tmpdir(), "agent-lifecycle-symlink-outside-"));
    await symlink(outside, path.join(home, ".pi"));
    const executor = new LocalAgentLifecycleExecutor();
    try {
      await expect(executor.apply(target(home, "pi"), `sha256:${"b".repeat(64)}`)).rejects.toThrow(
        "symbolic link",
      );
      expect(await readFile(path.join(outside, "sentinel"), "utf8").catch(() => null)).toBeNull();
    } finally {
      await rm(home, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
