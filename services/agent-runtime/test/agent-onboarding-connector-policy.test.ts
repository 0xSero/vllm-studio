import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ONBOARDING_REMOTE_AGENT_ALLOW_TOOLS } from "../src/agent-onboarding-policy";
import { callConnectorTool, ConnectorToolDeniedError } from "../src/connector-pool";
import { listConnectors, upsertConnector } from "../src/connectors-service";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "onboarding-connector-policy-"));
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  await writeFile(path.join(dataDir, "api-settings.json"), "{}");
});

afterEach(async () => {
  delete process.env.LOCAL_STUDIO_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("C2 onboarding remote connector policy", () => {
  test("publishes only the read-only directory bootstrap capability", async () => {
    await upsertConnector({
      id: "onboarding-remote-agent",
      name: "Remote agent",
      transport: "stdio",
      command: "node",
      args: ["ssh-remote.mjs"],
      env: { SSH_HOST: "scientist@compute-node" },
      allowTools: [...ONBOARDING_REMOTE_AGENT_ALLOW_TOOLS],
      origin: {
        kind: "onboarding",
        id: "agent-onboarding",
        binding: "remote-agent",
      },
      enabled: true,
    });
    const connector = (await listConnectors()).find(
      (candidate) => candidate.id === "onboarding-remote-agent",
    );
    expect(connector?.allowTools).toEqual(["list_dir"]);
    expect(connector?.origin?.id).toBe("agent-onboarding");
  });

  test.each(["run_command", "read_file", "write_file"])(
    "denies remote mutation or content access tool %s before connection",
    async (tool) => {
      await upsertConnector({
        id: "onboarding-remote-agent",
        name: "Remote agent",
        transport: "stdio",
        command: "node",
        args: ["ssh-remote.mjs"],
        env: { SSH_HOST: "scientist@compute-node" },
        allowTools: [...ONBOARDING_REMOTE_AGENT_ALLOW_TOOLS],
        origin: {
          kind: "onboarding",
          id: "agent-onboarding",
          binding: "remote-agent",
        },
        enabled: true,
      });
      await expect(callConnectorTool("onboarding-remote-agent", tool, {})).rejects.toBeInstanceOf(
        ConnectorToolDeniedError,
      );
    },
  );
});
