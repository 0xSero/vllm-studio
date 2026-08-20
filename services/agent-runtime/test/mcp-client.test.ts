import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { connectMcp } from "../src/mcp-client";

const roots: string[] = [];

function restoreWritable(entryPath: string): void {
  if (!existsSync(entryPath)) return;
  const stats = statSync(entryPath);
  if (stats.isDirectory()) {
    chmodSync(entryPath, 0o700);
    readdirSync(entryPath).forEach((name) => restoreWritable(path.join(entryPath, name)));
  } else {
    chmodSync(entryPath, 0o600);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    restoreWritable(root);
    rmSync(root, { recursive: true, force: true });
  }
});

describe("MCP client shutdown", () => {
  test("retries a timed-out stdio exit wait until the transport closes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "local-studio-mcp-close-"));
    roots.push(root);
    const server = path.join(root, "server.cjs");
    writeFileSync(
      server,
      `const { spawn } = require("node:child_process");
const readline = require("node:readline");
spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 5000)"], { stdio: ["ignore", "inherit", "inherit"] });
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1.0.0" } } }) + "\\n");
  if (request.method === "tools/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }) + "\\n");
});
input.on("close", () => process.exit(0));`,
    );
    const connection = connectMcp({
      transport: "stdio",
      command: process.execPath,
      args: [server],
    });
    expect(await connection.listTools()).toEqual([]);
    await expect(connection.close()).rejects.toThrow(/did not exit/);
    await expect(connection.close()).resolves.toBeUndefined();
    await expect(connection.close()).resolves.toBeUndefined();
  }, 10_000);
});
