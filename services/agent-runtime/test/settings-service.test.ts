import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  controllerCredentialStorageStatus,
  readControllerCredential,
  writeControllerCredential,
} from "../src/controller-credential-store";
import { applySettingsUpdate, getApiSettings, saveApiSettings } from "../src/settings-service";

const directories: string[] = [];
const original = {
  dataDirectory: process.env.LOCAL_STUDIO_DATA_DIR,
  credentialKey: process.env.LOCAL_STUDIO_CONTROLLER_CREDENTIAL_KEY,
  sharedKey: process.env.LOCAL_STUDIO_SHARED_SECRET_KEY,
  nodeEnv: process.env.NODE_ENV,
  desktop: process.env.LOCAL_STUDIO_DESKTOP,
};
const originalSend = Object.getOwnPropertyDescriptor(process, "send");
const originalConnected = Object.getOwnPropertyDescriptor(process, "connected");

const restore = (name: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
};

afterEach(async () => {
  restore("LOCAL_STUDIO_DATA_DIR", original.dataDirectory);
  restore("LOCAL_STUDIO_CONTROLLER_CREDENTIAL_KEY", original.credentialKey);
  restore("LOCAL_STUDIO_SHARED_SECRET_KEY", original.sharedKey);
  restore("NODE_ENV", original.nodeEnv);
  restore("LOCAL_STUDIO_DESKTOP", original.desktop);
  if (originalSend) Object.defineProperty(process, "send", originalSend);
  if (originalConnected) Object.defineProperty(process, "connected", originalConnected);
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const directory = async (): Promise<string> => {
  const value = await mkdtemp(path.join(tmpdir(), "local-studio-settings-security-"));
  directories.push(value);
  process.env.LOCAL_STUDIO_DATA_DIR = value;
  process.env.LOCAL_STUDIO_CONTROLLER_CREDENTIAL_KEY = "7".repeat(64);
  return value;
};

describe("controller credential persistence", () => {
  test("migrates plaintext settings into encrypted storage and survives restart reads", async () => {
    const dataDirectory = await directory();
    const backendUrl = "https://controller.example.test";
    const secret = "controller-secret-not-plaintext";
    await writeFile(
      path.join(dataDirectory, "api-settings.json"),
      JSON.stringify({
        backendUrl,
        apiKey: secret,
        voiceUrl: "",
        voiceModel: "whisper-large-v3-turbo",
      }),
      { mode: 0o600 },
    );
    expect((await getApiSettings()).apiKey).toBe(secret);
    const metadata = await readFile(path.join(dataDirectory, "api-settings.json"), "utf8");
    expect(metadata).not.toContain(secret);
    expect(metadata).not.toContain('"apiKey"');
    const blobs = await readdir(path.join(dataDirectory, "controller-credentials"));
    const encrypted = await Promise.all(
      blobs
        .filter((name) => name.endsWith(".bin"))
        .map((name) => readFile(path.join(dataDirectory, "controller-credentials", name))),
    );
    expect(encrypted.some((value) => value.includes(Buffer.from(secret)))).toBe(false);
    expect(await readControllerCredential(backendUrl)).toBe(secret);
    expect((await getApiSettings()).apiKey).toBe(secret);
  });

  test("keeps credentials isolated by normalized controller target", async () => {
    await directory();
    await writeControllerCredential("https://one.example.test", "first-secret");
    await writeControllerCredential("https://two.example.test", "second-secret");
    expect(await readControllerCredential("https://one.example.test")).toBe("first-secret");
    expect(await readControllerCredential("https://two.example.test")).toBe("second-secret");
  });

  test("does not copy the active credential when switching controller targets", async () => {
    await directory();
    await saveApiSettings({
      backendUrl: "https://one.example.test",
      apiKey: "first-secret",
      voiceUrl: "",
      voiceModel: "whisper-large-v3-turbo",
    });
    await writeControllerCredential("https://two.example.test", "second-secret");
    const switched = await applySettingsUpdate({
      backendUrl: "https://two.example.test",
      apiKey: "••••••••",
    });
    expect(switched.apiKey).toBe("second-secret");
    expect(await readControllerCredential("https://one.example.test")).toBe("first-secret");
  });

  test("fails closed after credential-key rotation instead of returning ciphertext", async () => {
    await directory();
    await saveApiSettings({
      backendUrl: "https://controller.example.test",
      apiKey: "rotation-secret",
      voiceUrl: "",
      voiceModel: "whisper-large-v3-turbo",
    });
    process.env.LOCAL_STUDIO_CONTROLLER_CREDENTIAL_KEY = "8".repeat(64);
    await expect(readControllerCredential("https://controller.example.test")).rejects.toThrow();
    await expect(getApiSettings()).rejects.toThrow();
  });

  test("requires an externally supplied key in shared production deployments", async () => {
    const dataDirectory = await directory();
    delete process.env.LOCAL_STUDIO_CONTROLLER_CREDENTIAL_KEY;
    delete process.env.LOCAL_STUDIO_SHARED_SECRET_KEY;
    delete process.env.LOCAL_STUDIO_DESKTOP;
    process.env.NODE_ENV = "production";
    process.env.LOCAL_STUDIO_DATA_DIR = dataDirectory;
    await expect(
      writeControllerCredential("https://controller.example.test", "shared-secret"),
    ).rejects.toThrow("required for shared deployments");
    expect(controllerCredentialStorageStatus()).toEqual({
      kind: "unavailable",
      durable: false,
      detail: "A deployment-owned controller credential key is required.",
    });
  });

  test("reports deployment-owned encrypted persistence without exposing key material", async () => {
    await directory();
    expect(controllerCredentialStorageStatus()).toEqual({
      kind: "deployment-encrypted",
      durable: true,
      detail: "Controller credentials are encrypted with a deployment-owned key.",
    });
  });

  test("migrates desktop credentials into native IPC storage and removes stale file copies", async () => {
    const dataDirectory = await directory();
    const backendUrl = "https://desktop.example.test";
    await writeControllerCredential(backendUrl, "desktop-secret");
    const native = new Map<string, string>();
    Object.defineProperty(process, "connected", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process, "send", {
      configurable: true,
      value: (message: {
        channel: string;
        id: string;
        operation: "read" | "write" | "delete";
        key: string;
        value?: string;
      }) => {
        const value = native.get(message.key);
        if (message.operation === "write" && message.value !== undefined) {
          native.set(message.key, message.value);
        }
        if (message.operation === "delete") native.delete(message.key);
        queueMicrotask(() => {
          process.emit("message", {
            channel: "local-studio:oauth-vault:response",
            id: message.id,
            ok: true,
            ...(message.operation === "read" && value !== undefined ? { value } : {}),
          });
        });
        return true;
      },
    });
    process.env.LOCAL_STUDIO_DESKTOP = "1";
    expect(await readControllerCredential(backendUrl)).toBe("desktop-secret");
    expect([...native.values()]).toEqual(["desktop-secret"]);
    expect(
      (await readdir(path.join(dataDirectory, "controller-credentials"))).some((entry) =>
        entry.endsWith(".bin"),
      ),
    ).toBe(false);

    delete process.env.LOCAL_STUDIO_DESKTOP;
    await writeControllerCredential(backendUrl, "stale-copy");
    process.env.LOCAL_STUDIO_DESKTOP = "1";
    expect(await readControllerCredential(backendUrl)).toBe("desktop-secret");
    expect(
      (await readdir(path.join(dataDirectory, "controller-credentials"))).some((entry) =>
        entry.endsWith(".bin"),
      ),
    ).toBe(false);
    await writeControllerCredential(backendUrl, "");
    expect(native.size).toBe(0);
    expect(await readControllerCredential(backendUrl)).toBe("");
  });
});
