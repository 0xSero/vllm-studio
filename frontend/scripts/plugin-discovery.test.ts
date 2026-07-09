import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Effect } from "effect";
import { discoverPlugins } from "../../services/agent-runtime/src/plugin-discovery";

async function writePlugin(
  root: string,
  name: string,
  version: string,
  fields: Record<string, unknown> = {},
) {
  const directory = path.join(root, name, version, ".codex-plugin");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "plugin.json"),
    JSON.stringify({ name, version, ...fields }),
    "utf8",
  );
}

test("plugin discovery validates, deduplicates, and describes Codex manifests", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugins-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await writePlugin(root, "gmail", "1.0.0", { skills: "./skills", apps: "./.app.json" });
  await writePlugin(root, "gmail", "1.2.0", {
    skills: "./skills",
    apps: "./.app.json",
    interface: { displayName: "Gmail", shortDescription: "Manage mail" },
  });
  await writePlugin(root, "computer-use", "1.0.0", { mcpServers: "./.mcp.json" });

  const plugins = await Effect.runPromise(
    discoverPlugins([{ label: "Test", dir: root, priority: 1 }]),
  );

  assert.equal(plugins.length, 2);
  assert.deepEqual(plugins[0], {
    id: "computer-use",
    name: "computer-use",
    displayName: "computer-use",
    version: "1.0.0",
    description: "",
    category: "Other",
    source: "Test",
    capabilities: [],
    provides: { skills: false, mcpServers: true, apps: false },
  });
  assert.equal(plugins[1]?.displayName, "Gmail");
  assert.equal(plugins[1]?.version, "1.2.0");
  assert.deepEqual(plugins[1]?.provides, { skills: true, mcpServers: false, apps: true });
});
