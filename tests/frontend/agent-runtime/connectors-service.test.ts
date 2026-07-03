import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "connectors-test-"));
  process.env.LOCAL_STUDIO_DATA_DIR = dir;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("connectors service", () => {
  test("crud round-trip with secret masking and merge", async () => {
    const service = await import("@local-studio/agent-runtime/connectors-service");

    expect(await service.listConnectors()).toEqual([]);
    expect(service.hasEnabledConnectorsSync()).toBe(false);

    await service.upsertConnector({
      id: "github",
      name: "GitHub",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_secret123456" },
      enabled: true,
    });

    const view = service.toConnectorView((await service.listConnectors())[0]!);
    expect(view.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("••••••••");
    expect(view.secret_keys).toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(service.hasEnabledConnectorsSync()).toBe(true);

    // Round-tripping the masked value keeps the stored secret.
    await service.upsertConnector({
      id: "github",
      name: "GitHub renamed",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: "••••••••" },
      enabled: false,
    });
    const stored = (await service.listConnectors())[0]!;
    expect(stored.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_secret123456");
    expect(stored.name).toBe("GitHub renamed");
    expect(service.hasEnabledConnectorsSync()).toBe(false);

    await service.removeConnector("github");
    expect(await service.listConnectors()).toEqual([]);
  });

  test("connector id validation", async () => {
    const { isValidConnectorId } = await import(
      "@local-studio/agent-runtime/connectors-service"
    );
    expect(isValidConnectorId("github")).toBe(true);
    expect(isValidConnectorId("computer-pop-os")).toBe(true);
    expect(isValidConnectorId("Bad Id!")).toBe(false);
    expect(isValidConnectorId("")).toBe(false);
  });
});
