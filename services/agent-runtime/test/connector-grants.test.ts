import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectorConfig } from "../src/connector-contract";
import {
  filterAllowedConnectorTools,
  assertConnectorToolAllowed,
  ConnectorToolDeniedError,
} from "../src/connector-pool";
import {
  catalogConnectorConfiguration,
  connectorToolPermissions,
  connectorToolRisk,
} from "../src/connector-policy";
import {
  hasEnabledConnectorsSync,
  listConnectors,
  resolveConnectorsFilePath,
  saveConnectors,
} from "../src/connectors-service";
import type { McpToolInfo } from "../src/mcp-client";
import { applyReviewedConnectorInventory } from "../src/plugin-runtime";

const originalDataDir = process.env.LOCAL_STUDIO_DATA_DIR;
const temporaryDirectories: string[] = [];

afterEach(() => {
  if (originalDataDir === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDir;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const connector = (overrides: Partial<ConnectorConfig> = {}): ConnectorConfig => ({
  id: "custom",
  name: "Custom",
  transport: "http",
  url: "http://127.0.0.1:3999/mcp",
  enabled: true,
  ...overrides,
});

const tool = (name: string, readOnlyHint = false): McpToolInfo =>
  ({
    name,
    inputSchema: { type: "object" },
    ...(readOnlyHint ? { annotations: { readOnlyHint: true } } : {}),
  }) as McpToolInfo;

const useTemporaryData = (): void => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-connector-grants-"));
  temporaryDirectories.push(directory);
  process.env.LOCAL_STUDIO_DATA_DIR = directory;
};

describe("connector grants", () => {
  test("disables persisted connectors whose grant was not explicitly reviewed", async () => {
    useTemporaryData();
    await saveConnectors([connector()]);
    expect(await listConnectors()).toEqual([
      expect.objectContaining({ allowTools: [], permissionReviewed: false, enabled: false }),
    ]);

    writeFileSync(resolveConnectorsFilePath(), JSON.stringify({ connectors: [connector()] }), {
      mode: 0o600,
    });
    expect(hasEnabledConnectorsSync()).toBe(false);
  });

  test("filters inventory and execution through the same explicit allowlist", () => {
    const reviewed = connector({
      allowTools: ["read"],
      permissionReviewed: true,
    });
    expect(filterAllowedConnectorTools(reviewed, [tool("read"), tool("write")])).toEqual([
      tool("read"),
    ]);
    expect(() => assertConnectorToolAllowed(reviewed, "read")).not.toThrow();
    expect(() => assertConnectorToolAllowed(reviewed, "write")).toThrow(ConnectorToolDeniedError);
    expect(filterAllowedConnectorTools(connector(), [tool("read")])).toEqual([]);
  });

  test("uses first-party catalog risk instead of connector annotations", () => {
    const github = catalogConnectorConfiguration(
      connector({
        id: "github",
        name: "GitHub",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "synthetic" },
        url: undefined,
        allowTools: ["get_issue", "create_issue", "unknown"],
        permissionReviewed: true,
      }),
      "github",
    );
    expect(connectorToolRisk(github, "get_issue")).toBe("read");
    expect(connectorToolRisk(github, "create_issue")).toBe("mutating");
    expect(connectorToolRisk(github, "unknown")).toBe("critical");
    expect(connectorToolPermissions(github, [tool("unknown", true)])[0]).toEqual({
      name: "unknown",
      risk: "critical",
      granted: true,
      default_granted: false,
    });
    expect(() =>
      catalogConnectorConfiguration({ ...github, permissionReviewed: false }, "github"),
    ).toThrow(/Review and save/);
  });

  test("stages unreviewed plugin tools even when they claim to be read-only", () => {
    const plugin = connector({
      origin: { kind: "plugin", id: "sample", version: "1", binding: "mcp" },
    });
    expect(applyReviewedConnectorInventory(plugin, [tool("observe", true)])).toEqual(
      expect.objectContaining({ allowTools: [], permissionReviewed: false, enabled: false }),
    );
    const reviewed = { ...plugin, allowTools: ["observe"], permissionReviewed: true };
    expect(applyReviewedConnectorInventory(reviewed, [tool("observe")]).enabled).toBe(true);
    expect(() => applyReviewedConnectorInventory(reviewed, [tool("other")])).toThrow(
      /approved tool inventory changed/,
    );
  });
});
