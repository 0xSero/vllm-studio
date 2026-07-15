import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Effect } from "effect";
import {
  callConnectorTool,
  closePooledConnection,
  ConnectorToolDeniedError,
  listConnectorTools,
} from "../../services/agent-runtime/src/connector-pool";
import {
  connectorsRevisionSync,
  listConnectors,
  upsertConnector,
} from "../../services/agent-runtime/src/connectors-service";
import {
  listPluginRuntimeViews,
  refreshEnabledPluginConnectors,
  setPluginEnabled,
} from "../../services/agent-runtime/src/plugin-runtime";

const fakeServer = `
import readline from "node:readline";
const input = readline.createInterface({ input: process.stdin });
for await (const line of input) {
  const message = JSON.parse(line);
  if (typeof message.id !== "number") continue;
  let result = {};
  if (message.method === "initialize") {
    result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } };
  }
  if (message.method === "tools/list") {
    result = { tools: [
      { name: "inspect", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
      { name: "mutate", inputSchema: { type: "object" }, annotations: { readOnlyHint: false } }
    ] };
  }
  if (message.method === "tools/call") {
    result = { content: [{ type: "text", text: JSON.stringify({ tool: message.params.name, cwd: process.cwd() }) }] };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");
}
`;

async function createPlugin(
  root: string,
  name: string,
  mcpPath = "./.mcp.json",
  version = "1.0.0",
) {
  const bundle = path.join(root, name, version);
  await mkdir(path.join(bundle, ".codex-plugin"), { recursive: true });
  await writeFile(
    path.join(bundle, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name,
      version,
      mcpServers: mcpPath,
      interface: { displayName: name === "computer-use" ? "Computer Use" : name },
    }),
  );
  return bundle;
}

test("plugin runtime activates only declared read-only tools and refreshes connector state", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-runtime-"));
  const dataDir = path.join(root, "data");
  const pluginRoot = path.join(root, "plugins");
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  context.after(async () => {
    closePooledConnection("plugin-computer-use-computer-use");
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  const bundle = await createPlugin(pluginRoot, "computer-use");
  await writeFile(path.join(bundle, "server.mjs"), fakeServer);
  await writeFile(
    path.join(bundle, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        "computer-use": {
          command: process.execPath,
          args: ["./server.mjs"],
          cwd: ".",
        },
      },
    }),
  );
  const sources = [{ label: "Test", dir: pluginRoot, priority: 1 }];

  const initial = await Effect.runPromise(listPluginRuntimeViews(sources));
  assert.equal(initial[0]?.tools.state, "available");
  const initialRevision = connectorsRevisionSync();

  const activated = await Effect.runPromise(setPluginEnabled("computer-use", true, sources));
  assert.equal(activated.plugins[0]?.tools.state, "enabled");
  assert.equal(activated.plugins[0]?.tools.allowedToolCount, 1);
  assert.notEqual(connectorsRevisionSync(), initialRevision);

  const connector = (await listConnectors())[0];
  assert.equal(connector?.cwd, await realpath(bundle));
  assert.deepEqual(connector?.allowTools, ["inspect"]);
  assert.deepEqual(connector?.origin, {
    kind: "plugin",
    id: "computer-use",
    version: "1.0.0",
    binding: "computer-use",
  });

  await upsertConnector({
    id: "plugin-computer-use-computer-use",
    name: "Computer Use",
    transport: "stdio",
    command: process.execPath,
    args: [path.join(bundle, "server.mjs")],
    enabled: true,
  });
  const roundTripped = (await listConnectors())[0];
  assert.equal(roundTripped?.cwd, await realpath(bundle));
  assert.deepEqual(roundTripped?.allowTools, ["inspect"]);
  assert.equal(roundTripped?.origin?.id, "computer-use");

  const tools = await listConnectorTools("plugin-computer-use-computer-use");
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["inspect"],
  );
  await assert.rejects(
    () => callConnectorTool("plugin-computer-use-computer-use", "mutate", {}),
    ConnectorToolDeniedError,
  );
  const result = await callConnectorTool("plugin-computer-use-computer-use", "inspect", {});
  assert.match(JSON.stringify(result), /tool.*inspect/);

  await rm(path.join(bundle, "server.mjs"));
  const unavailable = await Effect.runPromise(listPluginRuntimeViews(sources));
  assert.equal(unavailable[0]?.tools.state, "invalid");
  assert.match(unavailable[0]?.tools.reason ?? "", /Computer Use/);
  await writeFile(path.join(bundle, "server.mjs"), fakeServer);

  const deactivated = await Effect.runPromise(setPluginEnabled("computer-use", false, sources));
  assert.equal(deactivated.plugins[0]?.tools.state, "disabled");
  assert.equal((await listConnectors())[0]?.enabled, false);
});

test("plugin runtime rejects manifest paths that escape the bundle", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-escape-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const bundle = await createPlugin(root, "unsafe", "../escape.json");
  await writeFile(
    path.join(path.dirname(bundle), "escape.json"),
    JSON.stringify({ mcpServers: {} }),
  );
  const plugins = await Effect.runPromise(
    listPluginRuntimeViews([{ label: "Test", dir: root, priority: 1 }]),
  );
  assert.equal(plugins[0]?.tools.state, "invalid");
  assert.match(plugins[0]?.tools.reason ?? "", /escapes its bundle/);
});

test("plugin runtime safely migrates enabled connectors after a bundle update", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-plugin-update-"));
  const dataDir = path.join(root, "data");
  const pluginRoot = path.join(root, "plugins");
  const previousDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
  process.env.LOCAL_STUDIO_DATA_DIR = dataDir;
  context.after(async () => {
    closePooledConnection("plugin-computer-use-computer-use");
    if (previousDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
    else process.env.LOCAL_STUDIO_DATA_DIR = previousDataDir;
    await rm(root, { recursive: true, force: true });
  });

  const original = await createPlugin(pluginRoot, "computer-use");
  await writeFile(path.join(original, "server.mjs"), fakeServer);
  await writeFile(
    path.join(original, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        "computer-use": { command: process.execPath, args: ["./server.mjs"], cwd: "." },
      },
    }),
  );
  const sources = [{ label: "Test", dir: pluginRoot, priority: 1 }];
  await Effect.runPromise(setPluginEnabled("computer-use", true, sources));

  const updated = await createPlugin(pluginRoot, "computer-use", "./.mcp.json", "1.1.0");
  await writeFile(path.join(updated, "server.mjs"), fakeServer);
  await writeFile(
    path.join(updated, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        "computer-use": { command: process.execPath, args: ["./server.mjs"], cwd: "." },
      },
    }),
  );

  await Effect.runPromise(refreshEnabledPluginConnectors(sources));
  const plugins = await Effect.runPromise(listPluginRuntimeViews(sources));
  const connector = (await listConnectors())[0];
  assert.equal(plugins[0]?.tools.state, "enabled");
  assert.equal(connector?.origin?.version, "1.1.0");
  assert.equal(connector?.cwd, await realpath(updated));
  assert.deepEqual(connector?.allowTools, ["inspect"]);
});

test("only the bundled Chatterbox plugin receives the local speech capability", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-studio-speech-plugin-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const bundle = await createPlugin(root, "chatterbox-voice");
  await writeFile(
    path.join(bundle, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "chatterbox-voice",
      version: "99.0.0",
      apps: "./.app.json",
    }),
  );
  await writeFile(
    path.join(bundle, ".app.json"),
    JSON.stringify({
      apps: {
        "chatterbox-voice": {
          adapter: "local-studio-controller",
          capability: "speech",
          actions: ["synthesize"],
        },
      },
    }),
  );

  const untrusted = await Effect.runPromise(
    listPluginRuntimeViews([{ label: "Test", dir: root, priority: 99 }]),
  );
  assert.equal(untrusted[0]?.hostCapability, undefined);
  assert.equal(untrusted[0]?.tools.state, "none");

  const bundledRoot = path.resolve(import.meta.dirname, "../desktop/resources/plugins");
  const bundled = await Effect.runPromise(
    listPluginRuntimeViews([{ label: "Local Studio", dir: bundledRoot, priority: 1 }]),
  );
  const chatterbox = bundled.find((plugin) => plugin.id === "chatterbox-voice");
  assert.deepEqual(chatterbox?.hostCapability, {
    adapter: "local-studio-controller",
    capability: "speech",
    actions: ["synthesize"],
  });
  assert.equal(chatterbox?.tools.state, "none");

  const activation = await Effect.runPromise(
    setPluginEnabled("chatterbox-voice", true, [
      { label: "Local Studio", dir: bundledRoot, priority: 1 },
    ]),
  );
  assert.deepEqual(activation.connectorIds, []);
});
