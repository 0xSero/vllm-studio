import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import {
  CONTROLLERS_STORAGE_KEY,
  getControllerApiKey,
  getControllerCredentialPersistence,
  loadSavedControllers,
  removeControllerCredential,
  saveSavedControllers,
} from "@/lib/api/controllers";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

const storage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
};

const browser = (): Storage => {
  const localStorage = storage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage,
      dispatchEvent: () => true,
      setTimeout: (callback: () => void) => {
        callback();
        return 1;
      },
    },
  });
  globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 204 }))) as typeof fetch;
  return localStorage;
};

afterEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
  });
  globalThis.fetch = originalFetch;
});

describe("browser controller credentials", () => {
  test("stores controller metadata without persisting a new API key", () => {
    const localStorage = browser();
    const secret = "browser-secret-must-not-persist";
    const saved = saveSavedControllers([
      { url: "https://controller.example.test", apiKey: secret, name: "Primary" },
    ]);
    assert.equal(saved[0]?.hasApiKey, true);
    assert.equal(localStorage.getItem(CONTROLLERS_STORAGE_KEY)?.includes(secret), false);
    assert.equal(getControllerApiKey("https://controller.example.test"), secret);
  });

  test("scrubs a legacy plaintext key during load while preserving its runtime lease", () => {
    const localStorage = browser();
    const secret = "legacy-browser-secret";
    localStorage.setItem(
      CONTROLLERS_STORAGE_KEY,
      JSON.stringify([{ url: "https://legacy.example.test", apiKey: secret }]),
    );
    const loaded = loadSavedControllers();
    assert.equal(loaded[0]?.hasApiKey, true);
    assert.equal(localStorage.getItem(CONTROLLERS_STORAGE_KEY)?.includes(secret), false);
    assert.equal(getControllerApiKey("https://legacy.example.test"), secret);
  });

  test("surfaces a failed durable credential write without persisting plaintext", async () => {
    const localStorage = browser();
    globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 500 }))) as typeof fetch;
    const url = "https://failed.example.test";
    saveSavedControllers([{ url, apiKey: "runtime-only-secret" }]);
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
    assert.equal(getControllerCredentialPersistence(url)?.state, "failed");
    assert.equal(
      localStorage.getItem(CONTROLLERS_STORAGE_KEY)?.includes("runtime-only-secret"),
      false,
    );
  });

  test("removes runtime and durable credentials when controller metadata is deleted", async () => {
    browser();
    const requests: unknown[] = [];
    globalThis.fetch = (async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)) as unknown);
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const url = "https://removed.example.test";
    saveSavedControllers([{ url, apiKey: "removed-secret" }]);
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    removeControllerCredential(url);
    for (let index = 0; index < 4; index += 1) await Promise.resolve();
    assert.equal(getControllerApiKey(url), "");
    assert.equal(getControllerCredentialPersistence(url)?.state, "removed");
    assert.deepEqual(requests.at(-1), { backendUrl: url, apiKey: "" });
  });
});
