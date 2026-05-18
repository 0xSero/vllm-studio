import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import registerMcpPlugins from "../../../desktop/resources/pi-extensions/mcp-plugin";

type ToolRecord = { name?: unknown; execute?: unknown };
type StatusResult = { content: Array<{ text: string }> };

describe("mcp plugin extension", () => {
  it("marks a registered MCP server failed if the process exits later", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vllm-studio-mcp-"));
    const serverPath = path.join(dir, "fake-mcp.cjs");
    const configPath = path.join(dir, ".mcp.json");
    writeFileSync(serverPath, fakeMcpServerSource());
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          "fake-mcp": { command: process.execPath, args: [serverPath], cwd: "." },
        },
      }),
    );

    const previous = process.env.VLLM_STUDIO_MCP_PLUGIN_CONFIGS;
    process.env.VLLM_STUDIO_MCP_PLUGIN_CONFIGS = JSON.stringify([
      { pluginName: "fake-plugin", configPath },
    ]);
    try {
      const tools: ToolRecord[] = [];
      await registerMcpPlugins({
        registerTool(tool: ToolRecord) {
          tools.push(tool);
        },
      } as Parameters<typeof registerMcpPlugins>[0]);
      const statusTool = tools.find((tool) => tool.name === "mcp_plugin_status");
      expect(statusTool).toBeTruthy();
      expect(typeof statusTool?.execute).toBe("function");
      const text = await waitForStatusText(
        statusTool?.execute as () => Promise<StatusResult>,
        "fake-plugin/fake-mcp: failed",
      );
      expect(text).toContain("code=42");
    } finally {
      if (previous === undefined) delete process.env.VLLM_STUDIO_MCP_PLUGIN_CONFIGS;
      else process.env.VLLM_STUDIO_MCP_PLUGIN_CONFIGS = previous;
    }
  });

  it("registers Computer Use JSON-lines MCP tools", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vllm-studio-mcp-jsonl-"));
    const serverPath = path.join(dir, "computer-use-jsonl.cjs");
    const configPath = path.join(dir, ".mcp.json");
    writeFileSync(serverPath, fakeJsonLineMcpServerSource());
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          "computer-use": { command: process.execPath, args: [serverPath], cwd: "." },
        },
      }),
    );

    const previous = process.env.VLLM_STUDIO_MCP_PLUGIN_CONFIGS;
    process.env.VLLM_STUDIO_MCP_PLUGIN_CONFIGS = JSON.stringify([
      { pluginName: "computer-use", configPath },
    ]);
    try {
      const tools: ToolRecord[] = [];
      await registerMcpPlugins({
        registerTool(tool: ToolRecord) {
          tools.push(tool);
        },
      } as Parameters<typeof registerMcpPlugins>[0]);

      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["mcp_plugin_status", "computer-use_list_apps"]),
      );
    } finally {
      if (previous === undefined) delete process.env.VLLM_STUDIO_MCP_PLUGIN_CONFIGS;
      else process.env.VLLM_STUDIO_MCP_PLUGIN_CONFIGS = previous;
    }
  });
});

async function waitForStatusText(
  execute: () => Promise<StatusResult>,
  expected: string,
): Promise<string> {
  const deadline = Date.now() + 1000;
  let text = "";
  while (Date.now() < deadline) {
    const result = await execute();
    text = result.content[0]?.text ?? "";
    if (text.includes(expected)) return text;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  expect(text).toContain(expected);
  return text;
}

function fakeMcpServerSource() {
  return `
let buffer = Buffer.alloc(0);
function send(id, result) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result }), "utf8");
  process.stdout.write("Content-Length: " + body.length + "\\r\\n\\r\\n");
  process.stdout.write(body);
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const length = Number(/content-length:\\s*(\\d+)/i.exec(header)?.[1]);
    if (!Number.isFinite(length)) process.exit(2);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const message = JSON.parse(buffer.slice(bodyStart, bodyEnd).toString("utf8"));
    buffer = buffer.slice(bodyEnd);
    if (message.method === "initialize") {
      send(message.id, { protocolVersion: "2024-11-05", capabilities: {} });
    }
    if (message.method === "tools/list") {
      send(message.id, { tools: [{ name: "noop", inputSchema: { type: "object" } }] });
      setTimeout(() => process.exit(42), 20);
    }
  }
});
`;
}

function fakeJsonLineMcpServerSource() {
  return `
process.stdin.setEncoding("utf8");
let buffer = "";
function send(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf("\\n");
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") {
      send(message.id, { protocolVersion: "2024-11-05", capabilities: {} });
    }
    if (message.method === "tools/list") {
      send(message.id, { tools: [{ name: "list_apps", inputSchema: { type: "object" } }] });
    }
  }
});
`;
}
