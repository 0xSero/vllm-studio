import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createConfig } from "../src/config/env";
import { savePersistedConfig } from "../src/config/persisted-config";

const keys = [
  "LOCAL_STUDIO_DATA_DIR",
  "LOCAL_STUDIO_KUBERAY_API_URL",
  "LOCAL_STUDIO_KUBERAY_TOKEN_FILE",
  "LOCAL_STUDIO_KUBERAY_CA_FILE",
] as const;
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const directories: string[] = [];

afterEach(() => {
  for (const key of keys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "environment-config-"));
  directories.push(directory);
  return directory;
};

describe("environment Kubernetes configuration", () => {
  test("preserves trusted environment credentials while validating the endpoint", () => {
    const directory = temporaryDirectory();
    const trustedToken = join(directory, "trusted-environment.token");
    writeFileSync(trustedToken, "workload-token", { mode: 0o600 });
    process.env["LOCAL_STUDIO_DATA_DIR"] = directory;
    process.env["LOCAL_STUDIO_KUBERAY_API_URL"] = " https://cluster.internal:6443/ ";
    process.env["LOCAL_STUDIO_KUBERAY_TOKEN_FILE"] = trustedToken;

    const config = createConfig();

    expect(config.kuberay_api_url).toBe("https://cluster.internal:6443");
    expect(config.kuberay_token_file).toBe(resolve(trustedToken));
  });

  test("loads a persisted controller credential reference after restart", () => {
    const directory = temporaryDirectory();
    const credentialRoot = join(directory, "credentials");
    const tokenFile = join(credentialRoot, "cluster.token");
    mkdirSync(credentialRoot, { recursive: true });
    writeFileSync(tokenFile, "workload-token", { mode: 0o600 });
    savePersistedConfig(directory, {
      kubernetes_connection: {
        enabled: true,
        api_url: "https://cluster.internal",
        token_file: "controller:cluster.token",
        ca_file: null,
      },
    });
    process.env["LOCAL_STUDIO_DATA_DIR"] = directory;
    delete process.env["LOCAL_STUDIO_KUBERAY_API_URL"];
    delete process.env["LOCAL_STUDIO_KUBERAY_TOKEN_FILE"];
    delete process.env["LOCAL_STUDIO_KUBERAY_CA_FILE"];

    const config = createConfig();

    expect(config.kuberay_api_url).toBe("https://cluster.internal");
    expect(config.kuberay_token_file).toBe(realpathSync(tokenFile));
  });

  test("fails loudly on secret-bearing environment endpoints", () => {
    const directory = temporaryDirectory();
    process.env["LOCAL_STUDIO_DATA_DIR"] = directory;
    process.env["LOCAL_STUDIO_KUBERAY_API_URL"] =
      "https://operator:secret@cluster.internal";

    expect(() => createConfig()).toThrow("must not contain user information");
  });
});
