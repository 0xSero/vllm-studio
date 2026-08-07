import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Schema } from "effect";
import {
  CONNECTOR_MASK_TOKEN,
  ConnectorHttpUrlSchema,
  type ConnectorConfig,
} from "../src/connector-contract";
import {
  ConnectorConfigurationError,
  listConnectors,
  resolveConnectorsFilePath,
  saveConnectors,
  toConnectorView,
  upsertConnectorInput,
  upsertConnectors,
} from "../src/connectors-service";
import { googleWorkspaceConnector } from "../src/google-workspace-adapter";

const originalDataDirectory = process.env.LOCAL_STUDIO_DATA_DIR;
const roots: string[] = [];

afterEach(() => {
  if (originalDataDirectory === undefined) delete process.env.LOCAL_STUDIO_DATA_DIR;
  else process.env.LOCAL_STUDIO_DATA_DIR = originalDataDirectory;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function useDataDirectory(): void {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-connector-secrets-"));
  roots.push(root);
  process.env.LOCAL_STUDIO_DATA_DIR = root;
}

const connector = (id: string, overrides: Partial<ConnectorConfig> = {}): ConnectorConfig => ({
  id,
  name: id,
  transport: "http",
  url: `https://${id}.example.test/mcp`,
  enabled: true,
  ...overrides,
});

const masks = (...keys: string[]): Record<string, string> =>
  Object.fromEntries(keys.map((key) => [key, CONNECTOR_MASK_TOKEN]));
const prototypeSecret = (value: string): Record<string, string> =>
  Object.fromEntries([["__proto__", value]]);

async function expectConfigurationError(
  operation: Promise<unknown>,
  forbidden?: string,
): Promise<void> {
  try {
    await operation;
    throw new Error("Expected connector configuration to be rejected");
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectorConfigurationError);
    const message = error instanceof Error ? error.message : "";
    expect(message).toBe("Connector configuration is invalid");
    if (forbidden) expect(message).not.toContain(forbidden);
  }
}

describe("connector secret boundaries", () => {
  test("masks every configured value with sorted location-aware metadata", () => {
    const view = toConnectorView(
      connector("view-secrets", {
        env: {
          zeta: "credential-sentinel",
          Cookie: "cookie-sentinel",
          API_TOKEN: "token-sentinel",
          EMPTY: "",
        },
        headers: { SESSION: "session-sentinel", Cookie: "cookie-sentinel", EMPTY: "" },
      }),
    );

    expect(view.env).toEqual(masks("zeta", "Cookie", "API_TOKEN", "EMPTY"));
    expect(view.headers).toEqual(masks("SESSION", "Cookie", "EMPTY"));
    expect(view.secret_keys).toEqual({
      env: ["API_TOKEN", "Cookie", "EMPTY", "zeta"],
      headers: ["Cookie", "EMPTY", "SESSION"],
    });
    expect(JSON.stringify(view)).not.toMatch(
      /cookie-sentinel|session-sentinel|credential-sentinel|token-sentinel/,
    );
  });

  test("preserves masks only at the same stored location and key", async () => {
    useDataDirectory();
    const id = "merge-secrets";
    await upsertConnectors([
      connector(id, {
        env: {
          CREDENTIAL: "env-sentinel",
          EMPTY: "",
          SHARED: "shared-env-sentinel",
          DELETE_ME: "delete-env",
        },
        headers: {
          Cookie: "header-sentinel",
          SHARED: "shared-header-sentinel",
          DELETE_ME: "delete-header",
        },
      }),
    ]);

    await upsertConnectorInput({
      id,
      name: "Renamed connector",
      transport: "http",
      url: `https://${id}.example.test/mcp`,
      env: masks("CREDENTIAL", "EMPTY", "SHARED"),
      headers: masks("Cookie", "SHARED"),
      enabled: false,
    });
    const [preserved] = await listConnectors();
    expect(preserved?.name).toBe("Renamed connector");
    expect(preserved?.env).toEqual({
      CREDENTIAL: "env-sentinel",
      EMPTY: "",
      SHARED: "shared-env-sentinel",
    });
    expect(preserved?.headers).toEqual({
      Cookie: "header-sentinel",
      SHARED: "shared-header-sentinel",
    });
    expect(preserved?.enabled).toBe(false);
    expect(readFileSync(resolveConnectorsFilePath(), "utf8")).not.toContain(CONNECTOR_MASK_TOKEN);

    const before = readFileSync(resolveConnectorsFilePath(), "utf8");
    await expectConfigurationError(
      upsertConnectorInput({
        id,
        transport: "http",
        url: `https://${id}.example.test/mcp`,
        env: { UNKNOWN: CONNECTOR_MASK_TOKEN },
      }),
    );
    expect(readFileSync(resolveConnectorsFilePath(), "utf8")).toBe(before);

    await expectConfigurationError(
      upsertConnectorInput({
        id,
        transport: "http",
        url: `https://${id}.example.test/mcp`,
        headers: { CREDENTIAL: CONNECTOR_MASK_TOKEN },
      }),
    );
    expect(readFileSync(resolveConnectorsFilePath(), "utf8")).toBe(before);
  });

  test("preserves managed connector metadata through settings updates", async () => {
    useDataDirectory();
    const managed = googleWorkspaceConnector("gmail", true);
    await upsertConnectors([managed]);
    await upsertConnectorInput({
      id: managed.id,
      name: managed.name,
      transport: managed.transport,
      url: managed.url,
      allowTools: managed.allowTools,
      enabled: false,
    });

    expect(await listConnectors()).toEqual([{ ...managed, enabled: false }]);
  });

  test("preserves prototype-named secrets through raw and masked settings writes", async () => {
    useDataDirectory();
    const id = "prototype-secrets";
    const envSentinel = "prototype-env-sentinel";
    const headerSentinel = "prototype-header-sentinel";
    const input = {
      id,
      transport: "http" as const,
      url: `https://${id}.example.test/mcp`,
      env: prototypeSecret(envSentinel),
      headers: prototypeSecret(headerSentinel),
    };

    await upsertConnectorInput(input);
    const storedAfterRaw = (await listConnectors())[0];
    if (!storedAfterRaw) throw new Error("Expected stored connector");
    expect(storedAfterRaw.env).toEqual(prototypeSecret(envSentinel));
    expect(storedAfterRaw.headers).toEqual(prototypeSecret(headerSentinel));
    expect(Object.hasOwn(storedAfterRaw.env ?? {}, "__proto__")).toBe(true);
    expect(Object.hasOwn(storedAfterRaw.headers ?? {}, "__proto__")).toBe(true);

    const view = toConnectorView(storedAfterRaw);
    expect(view.env).toEqual(prototypeSecret(CONNECTOR_MASK_TOKEN));
    expect(view.headers).toEqual(prototypeSecret(CONNECTOR_MASK_TOKEN));
    expect(view.secret_keys).toEqual({ env: ["__proto__"], headers: ["__proto__"] });
    await upsertConnectorInput({ ...input, env: view.env, headers: view.headers });

    const storedAfterMask = (await listConnectors())[0];
    expect(storedAfterMask?.env).toEqual(prototypeSecret(envSentinel));
    expect(storedAfterMask?.headers).toEqual(prototypeSecret(headerSentinel));
    const file = readFileSync(resolveConnectorsFilePath(), "utf8");
    expect(file).toContain('"__proto__"');
    expect(file).toContain(envSentinel);
    expect(file).toContain(headerSentinel);
    expect(file).not.toContain(CONNECTOR_MASK_TOKEN);
  });

  test("rejects reserved masks at raw and persisted boundaries", async () => {
    useDataDirectory();
    const invalid = connector("raw-mask", { env: { CREDENTIAL: CONNECTOR_MASK_TOKEN } });
    await expectConfigurationError(upsertConnectors([invalid]));
    await expectConfigurationError(saveConnectors([invalid]));

    const file = resolveConnectorsFilePath();
    writeFileSync(file, JSON.stringify({ connectors: [invalid] }));
    await expectConfigurationError(listConnectors());
    expect(readFileSync(file, "utf8")).toContain(CONNECTOR_MASK_TOKEN);
  });

  test("accepts only absolute HTTP URLs without syntactic userinfo", async () => {
    const decode = Schema.decodeUnknownSync(ConnectorHttpUrlSchema);
    for (const url of [
      "http://localhost:9911/mcp",
      "https://connector.example.test/path/@scope?email=agent@example.test#@fragment",
    ])
      expect(decode(url)).toBe(url);
    for (const url of [
      "connector.example.test/mcp",
      "ftp://connector.example.test/mcp",
      "https://user:password@connector.example.test/mcp",
      "https://@connector.example.test/mcp",
      "https://:@connector.example.test/mcp",
    ])
      expect(() => decode(url)).toThrow();

    useDataDirectory();
    const credentialUrl = "https://synthetic-user:synthetic-password@example.test/mcp";
    await expectConfigurationError(
      upsertConnectors([connector("invalid-url", { url: credentialUrl })]),
      credentialUrl,
    );

    const file = resolveConnectorsFilePath();
    writeFileSync(
      file,
      JSON.stringify({ connectors: [connector("persisted-userinfo", { url: credentialUrl })] }),
    );
    await expectConfigurationError(listConnectors(), credentialUrl);
  });
});
