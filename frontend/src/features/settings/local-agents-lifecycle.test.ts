import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { attachModelToAgents, revokeAgentAttachments } from "./local-agents";

let home = "";

const model = {
  modelId: "qwen3-next-80b-a3b-nvfp4",
  displayName: "Qwen",
  baseUrl: "http://127.0.0.1:3000/api/agent/onboarding/inference/v1",
  apiKey: "local-studio-keyring",
  contextWindow: 131072,
  maxTokens: 131072,
  reasoning: true,
  images: false,
};

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "local-agent-lifecycle-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe("local agent onboarding lifecycle", () => {
  test("restores the original config from backup on revoke", async () => {
    const directory = path.join(home, ".pi", "agent");
    const configPath = path.join(directory, "models.json");
    await mkdir(directory, { recursive: true });
    const original = JSON.stringify({ providers: {}, retained: "operator-value" }, null, 2);
    await writeFile(configPath, original, { mode: 0o600 });

    const results = await attachModelToAgents({ home, targets: ["pi"], model });
    assert.equal(results[0]?.ok, true);
    assert.ok(results[0]?.backupPath);
    assert.notEqual(await readFile(configPath, "utf8"), original);

    await revokeAgentAttachments(home, results);
    assert.equal(await readFile(configPath, "utf8"), original);
  });

  test("removes an onboarding-created config on revoke", async () => {
    await mkdir(path.join(home, ".pi"), { recursive: true });
    const results = await attachModelToAgents({ home, targets: ["pi"], model });
    assert.equal(results[0]?.action, "created-file");
    await revokeAgentAttachments(home, results);
    await assert.rejects(readFile(results[0]!.configPath, "utf8"), { code: "ENOENT" });
  });

  test("refuses receipt paths that escape the enrolled home", async () => {
    await assert.rejects(
      revokeAgentAttachments(home, [
        {
          agent: "pi",
          ok: true,
          configPath: path.join(tmpdir(), "outside-models.json"),
        },
      ]),
      /escapes home/,
    );
  });
});
