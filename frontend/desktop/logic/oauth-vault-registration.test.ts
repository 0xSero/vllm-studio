import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

const appServer = source("./app-server.ts");
const agentRuntimeServer = source("./agent-runtime-server.ts");
const vault = source("./oauth-vault.ts");

describe("desktop onboarding vault wiring", () => {
  test("marks the runtime as a desktop secure-storage client", () => {
    assert.match(agentRuntimeServer, /LOCAL_STUDIO_DESKTOP: "1"/);
  });

  test("registers the vault before runtime readiness in dev and packaged startup", () => {
    const registrations = appServer.match(
      /onSpawn: \(child\) => registerOAuthVault\(child, DESKTOP_CONFIG\.userDataDir\)/g,
    );
    assert.equal(registrations?.length, 2);
    assert.match(agentRuntimeServer, /options\.onSpawn\?\.\(child\)/);
    assert.match(
      agentRuntimeServer,
      /options\.onSpawn\?\.\(child\)[\s\S]*await waitForAgentRuntime\(child/,
    );
  });

  test("uses rotating asynchronous native storage and rejects Linux plaintext fallback", () => {
    assert.match(vault, /safeStorage\.isAsyncEncryptionAvailable\(\)/);
    assert.match(vault, /safeStorage\.encryptStringAsync/);
    assert.match(vault, /safeStorage\.decryptStringAsync/);
    assert.match(vault, /decrypted\.shouldReEncrypt/);
    assert.match(vault, /getSelectedStorageBackend\(\) === "basic_text"/);
  });
});
