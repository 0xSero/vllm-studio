import { describe, expect, test } from "bun:test";
import { GITHUB_MCP_TOOLS, githubMcpConnectorConfiguration } from "../src/connector-artifacts";
import type { ConnectorConfig } from "../src/connector-contract";
import { makeConnectorPool } from "../src/connector-pool";
import type { McpConnection, McpToolInfo } from "../src/mcp-client";

const tools: McpToolInfo[] = [
  {
    name: GITHUB_MCP_TOOLS[0],
    inputSchema: { type: "object" },
  },
];

function managedConnector(): ConnectorConfig {
  return githubMcpConnectorConfiguration({
    enabled: true,
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: "fixture-token" },
  });
}

function fakeConnection(onClose: () => void = () => undefined): McpConnection {
  return {
    listTools: async () => tools,
    callTool: async (name) => ({ name }),
    close: async () => onClose(),
  };
}

describe("connector pool verification", () => {
  test("runs one full GitHub verification for each spawned pooled connection", async () => {
    const connector = managedConnector();
    let verifications = 0;
    let spawns = 0;
    let closes = 0;
    const pool = makeConnectorPool({
      loadConnectors: async () => [connector],
      verifyGitHub: async () => {
        verifications += 1;
      },
      connect: () => {
        spawns += 1;
        return fakeConnection(() => {
          closes += 1;
        });
      },
    });

    expect(await pool.listConnectorTools(connector.id)).toEqual(tools);
    expect(await pool.listConnectorTools(connector.id)).toEqual(tools);
    expect(verifications).toBe(1);
    expect(spawns).toBe(1);

    await pool.closePooledConnection(connector.id);
    expect(closes).toBe(1);
    expect(await pool.listConnectorTools(connector.id)).toEqual(tools);
    expect(verifications).toBe(2);
    expect(spawns).toBe(2);
    await pool.closePooledConnection(connector.id);
  });

  test("rejects managed configuration drift before reusing a pooled connection", async () => {
    let connector = managedConnector();
    let verifications = 0;
    let spawns = 0;
    const pool = makeConnectorPool({
      loadConnectors: async () => [connector],
      verifyGitHub: async () => {
        verifications += 1;
      },
      connect: () => {
        spawns += 1;
        return fakeConnection();
      },
    });

    await pool.listConnectorTools(connector.id);
    connector = { ...connector, allowTools: ["unreviewed-tool"] };

    await expect(pool.listConnectorTools(connector.id)).rejects.toThrow(
      "GitHub connector configuration is invalid",
    );
    expect(verifications).toBe(1);
    expect(spawns).toBe(1);
    await pool.closePooledConnection(connector.id);
  });

  test("fully verifies each explicit GitHub probe immediately before connecting", async () => {
    const connector = managedConnector();
    const events: string[] = [];
    const pool = makeConnectorPool({
      verifyGitHub: async () => {
        events.push("verify");
      },
      connect: () => {
        events.push("connect");
        return fakeConnection(() => events.push("close"));
      },
    });

    expect(await pool.probeConnector(connector)).toMatchObject({ ok: true, tools });
    expect(events).toEqual(["verify", "connect", "close"]);
  });
});
