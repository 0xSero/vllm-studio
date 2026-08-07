import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { chmod, lstat, rename, unlink, writeFile } from "node:fs/promises";
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

function useDataDirectory(): string {
  const root = mkdtempSync(path.join(tmpdir(), "local-studio-connector-secrets-"));
  roots.push(root);
  process.env.LOCAL_STUDIO_DATA_DIR = root;
  return root;
}

const nodeConnectorFileSystem = { chmod, lstat, rename, unlink, writeFile };

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

  test("creates connector secrets owner-only in an existing permissive data directory", async () => {
    const root = useDataDirectory();
    const file = resolveConnectorsFilePath();
    chmodSync(root, 0o755);
    let initialTemporaryMode: number | null = null;

    await saveConnectors([connector("private-create", { env: { TOKEN: "private-sentinel" } })], {
      fileSystem: {
        ...nodeConnectorFileSystem,
        writeFile: async (target, data, options) => {
          await writeFile(target, data, options);
          initialTemporaryMode = statSync(target).mode & 0o777;
        },
      },
    });

    expect(initialTemporaryMode).toBe(0o600);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).toContain("private-sentinel");
  });

  test("does not promote connector secrets when permission enforcement fails", async () => {
    const root = useDataDirectory();
    const file = resolveConnectorsFilePath();
    const previous = JSON.stringify(
      { connectors: [connector("previous", { env: { TOKEN: "previous-sentinel" } })] },
      null,
      2,
    );
    writeFileSync(file, previous, { mode: 0o600 });
    chmodSync(root, 0o755);

    await expect(
      saveConnectors([connector("replacement", { env: { TOKEN: "replacement-sentinel" } })], {
        fileSystem: {
          ...nodeConnectorFileSystem,
          chmod: async (target, mode) => {
            if (target !== root) throw new Error("injected chmod failure");
            await chmod(target, mode);
          },
        },
      }),
    ).rejects.toThrow("injected chmod failure");

    expect(readFileSync(file, "utf8")).toBe(previous);
    expect(readFileSync(file, "utf8")).not.toContain("replacement-sentinel");
    expect(readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);

    await saveConnectors([connector("replacement", { env: { TOKEN: "replacement-sentinel" } })]);
    expect(readFileSync(file, "utf8")).toContain("replacement-sentinel");
    expect(readFileSync(file, "utf8")).not.toContain("previous-sentinel");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("rejects a temporary secret file that remains group-readable", async () => {
    const root = useDataDirectory();
    const file = resolveConnectorsFilePath();

    await expect(
      saveConnectors([connector("unsafe-mode", { env: { TOKEN: "unsafe-mode-sentinel" } })], {
        fileSystem: {
          ...nodeConnectorFileSystem,
          writeFile: (target, data, options) =>
            writeFile(target, data, { ...options, mode: 0o640 }),
          chmod: async (target, mode) => {
            if (target === root) await chmod(target, mode);
          },
        },
      }),
    ).rejects.toThrow("Connector file permissions are unsafe");

    expect(existsSync(file)).toBe(false);
    expect(readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  test("rejects a temporary secret file whose ownership changes", async () => {
    const root = useDataDirectory();
    const file = resolveConnectorsFilePath();
    let temporaryReads = 0;

    await expect(
      saveConnectors([connector("unsafe-owner", { env: { TOKEN: "unsafe-owner-sentinel" } })], {
        fileSystem: {
          ...nodeConnectorFileSystem,
          lstat: async (target) => {
            const metadata = await lstat(target);
            if (target === root || ++temporaryReads < 2) return metadata;
            return new Proxy(metadata, {
              get(current, property) {
                if (property === "uid") return current.uid + 1;
                const value = Reflect.get(current, property, current);
                return typeof value === "function" ? value.bind(current) : value;
              },
            });
          },
        },
      }),
    ).rejects.toThrow("Connector file permissions are unsafe");

    expect(existsSync(file)).toBe(false);
    expect(readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  test("fails closed where owner-only ACL enforcement is unavailable", async () => {
    const root = useDataDirectory();
    const file = resolveConnectorsFilePath();
    chmodSync(root, 0o755);

    await expect(
      saveConnectors([connector("windows-secret", { env: { TOKEN: "windows-sentinel" } })], {
        identity: { platform: "win32", uid: undefined },
      }),
    ).rejects.toThrow("owner-only ACL enforcement is unavailable");

    expect(existsSync(file)).toBe(false);
    expect(readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  test("promotes Windows connector secrets only through a verified ACL dependency", async () => {
    const root = useDataDirectory();
    const file = resolveConnectorsFilePath();
    const calls: string[] = [];

    await saveConnectors(
      [connector("windows-verified", { env: { TOKEN: "windows-verified-sentinel" } })],
      {
        identity: { platform: "win32", uid: undefined },
        windowsSecurity: {
          protect: async (target, kind) => {
            calls.push(`protect:${kind}`);
            await chmod(target, kind === "directory" ? 0o700 : 0o600);
          },
          verify: async (_target, kind) => {
            calls.push(`verify:${kind}`);
          },
        },
      },
    );

    expect(calls).toEqual(["protect:directory", "verify:directory", "protect:file", "verify:file"]);
    expect(readFileSync(file, "utf8")).toContain("windows-verified-sentinel");
    expect(readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  test("does not promote when the Windows ACL dependency rejects the temporary file", async () => {
    const root = useDataDirectory();
    const file = resolveConnectorsFilePath();
    const previous = JSON.stringify({ connectors: [connector("previous")] }, null, 2);
    writeFileSync(file, previous, { mode: 0o600 });

    await expect(
      saveConnectors(
        [connector("windows-rejected", { env: { TOKEN: "windows-rejected-sentinel" } })],
        {
          identity: { platform: "win32", uid: undefined },
          windowsSecurity: {
            protect: async (target, kind) => {
              if (kind === "file") throw new Error("injected ACL failure");
              await chmod(target, 0o700);
            },
            verify: async () => undefined,
          },
        },
      ),
    ).rejects.toThrow("injected ACL failure");

    expect(readFileSync(file, "utf8")).toBe(previous);
    expect(readFileSync(file, "utf8")).not.toContain("windows-rejected-sentinel");
    expect(readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  test("fails closed when POSIX ownership cannot be verified", async () => {
    const root = useDataDirectory();
    const file = resolveConnectorsFilePath();

    await expect(
      saveConnectors([connector("unknown-owner", { env: { TOKEN: "unknown-sentinel" } })], {
        identity: { platform: "linux", uid: undefined },
      }),
    ).rejects.toThrow("ownership verifier is unavailable");

    expect(existsSync(file)).toBe(false);
    expect(readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  test("rejects a symlinked connector data directory", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "local-studio-connector-link-"));
    roots.push(root);
    const target = path.join(root, "target");
    const link = path.join(root, "link");
    mkdirSync(target);
    symlinkSync(target, link, "dir");
    process.env.LOCAL_STUDIO_DATA_DIR = link;

    await expect(
      saveConnectors([connector("linked-secret", { env: { TOKEN: "linked-sentinel" } })]),
    ).rejects.toThrow("Connector directory is unsafe");

    expect(existsSync(path.join(target, "connectors.json"))).toBe(false);
  });

  test("atomically replaces a destination symlink without touching its target", async () => {
    const root = useDataDirectory();
    const file = resolveConnectorsFilePath();
    const external = path.join(root, "external.json");
    writeFileSync(external, "external-sentinel", { mode: 0o600 });
    symlinkSync(external, file);

    await saveConnectors([connector("replacement", { env: { TOKEN: "replacement-sentinel" } })]);

    expect(lstatSync(file).isSymbolicLink()).toBe(false);
    expect(readFileSync(file, "utf8")).toContain("replacement-sentinel");
    expect(readFileSync(external, "utf8")).toBe("external-sentinel");
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
