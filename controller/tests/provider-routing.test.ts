import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  normalizeOpenAIBaseUrl,
  openAIEndpoint,
  providerChatEndpoint,
  providerModelsEndpoint,
} from "../../shared/agent/openai-endpoint";
import { loadPersistedConfig } from "../src/config/persisted-config";
import { discoverScientificModelCatalog } from "../src/modules/workbench/service";
import { buildChatCompletionsStreamResponse } from "../src/modules/proxy/chat-completions-stream";
import {
  discoverProviderModels,
  isReservedProviderId,
  resolveProviderModelRoute,
} from "../src/services/provider-routing";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("OpenAI-compatible endpoint normalization", () => {
  test.each([
    "http://example.test",
    "http://example.test/",
    "http://example.test/v1",
    "http://example.test/v1/",
  ])("normalizes %s to one API version segment", (value) => {
    expect(normalizeOpenAIBaseUrl(value)).toBe("http://example.test/v1");
    expect(openAIEndpoint(value, "models")).toBe("http://example.test/v1/models");
    expect(openAIEndpoint(value, "chat/completions")).toBe(
      "http://example.test/v1/chat/completions",
    );
  });

  test("preserves a gateway prefix while adding one API version segment", () => {
    expect(openAIEndpoint("https://gateway.test/ai/v1/", "responses")).toBe(
      "https://gateway.test/ai/v1/responses",
    );
  });

  test("collapses repeated terminal API version segments", () => {
    expect(openAIEndpoint("https://gateway.test/ai/v1/v1/", "models")).toBe(
      "https://gateway.test/ai/v1/models",
    );
  });

  test("rejects embedded credentials and unsupported protocols", () => {
    expect(() => normalizeOpenAIBaseUrl("ssh://example.test")).toThrow();
    expect(() => normalizeOpenAIBaseUrl("https://user:pass@example.test")).toThrow();
  });

  test("routes OpenAI and Azure chat paths by provider path style", () => {
    expect(providerChatEndpoint("https://gateway.test/openai", "model-a", "openai", undefined)).toBe(
      "https://gateway.test/openai/v1/chat/completions",
    );
    expect(providerChatEndpoint("https://gateway.test/openai", "model-a", "azure", "2024-10-21")).toBe(
      "https://gateway.test/openai/deployments/model-a/chat/completions?api-version=2024-10-21",
    );
    expect(providerChatEndpoint("https://gateway.test/openai/v1", "model-a", "azure", undefined)).toBe(
      "https://gateway.test/openai/deployments/model-a/chat/completions?api-version=2024-10-21",
    );
    expect(providerChatEndpoint("https://gateway.test/openai", "model a/b", "azure", "2024-10-21")).toBe(
      "https://gateway.test/openai/deployments/model%20a%2Fb/chat/completions?api-version=2024-10-21",
    );
  });

  test("routes OpenAI and Azure model discovery paths by provider path style", () => {
    expect(providerModelsEndpoint("https://gateway.test/openai", "openai", undefined)).toBe(
      "https://gateway.test/openai/v1/models",
    );
    expect(providerModelsEndpoint("https://gateway.test/openai", undefined, undefined)).toBe(
      "https://gateway.test/openai/v1/models",
    );
    expect(providerModelsEndpoint("https://gateway.test/openai", "azure", "2024-10-21")).toBe(
      "https://gateway.test/openai/deployments?api-version=2024-10-21",
    );
    expect(providerModelsEndpoint("https://gateway.test/openai/v1", "azure", undefined)).toBe(
      "https://gateway.test/openai/deployments?api-version=2024-10-21",
    );
  });
});

describe("provider routing", () => {
  test("routes an enabled keyless provider without an authorization value", () => {
    const route = resolveProviderModelRoute("tensorprime/model-a", {
      providers: [
        {
          id: "tensorprime",
          name: "TensorPrime",
          base_url: "http://api.test/v1/",
          enabled: true,
          authentication: { type: "none" },
        },
      ],
    });
    expect(route).toMatchObject({
      kind: "remote",
      provider: "tensorprime",
      modelId: "model-a",
      config: { baseUrl: "http://api.test/v1" },
    });
  });

  test("fails closed for unknown, disabled, and unresolved credential providers", () => {
    const providers = [
      {
        id: "disabled",
        name: "Disabled",
        base_url: "http://disabled.test",
        enabled: false,
        authentication: { type: "none" as const },
      },
      {
        id: "locked",
        name: "Locked",
        base_url: "http://locked.test",
        enabled: true,
        authentication: { type: "api_key" as const },
      },
    ];
    expect(resolveProviderModelRoute("missing/model-a", { providers }).kind).toBe("unavailable");
    expect(resolveProviderModelRoute("disabled/model-a", { providers }).kind).toBe("unavailable");
    expect(resolveProviderModelRoute("locked/model-a", { providers }).kind).toBe("unavailable");
    expect(resolveProviderModelRoute("model-a", { providers }).kind).toBe("local");
  });

  test("keeps a matched local recipe local when its model id contains a slash", () => {
    expect(resolveProviderModelRoute("org/model-a", {}, true)).toEqual({
      kind: "local",
      provider: "openai",
      modelId: "model-a",
    });
  });

  test("reserves the local provider identifier case-insensitively", () => {
    expect(isReservedProviderId("openai")).toBe(true);
    expect(isReservedProviderId(" OpenAI ")).toBe(true);
    expect(isReservedProviderId("tensorprime")).toBe(false);
  });
});

describe("keyless discovery and streaming", () => {
  test("discovers models without an Authorization header", async () => {
    let observedUrl = "";
    let observedAuthorization: string | null = "missing";
    let observedRedirect: RequestRedirect | undefined;
    const result = await Effect.runPromise(
      discoverProviderModels(
        {
          id: "tensorprime",
          name: "TensorPrime",
          base_url: "http://api.test/v1",
          enabled: true,
          authentication: { type: "none" },
        },
        async (input, init) => {
          observedUrl = String(input);
          observedAuthorization = new Headers(init?.headers).get("authorization");
          observedRedirect = init?.redirect;
          return Response.json({ data: [{ id: "model-a" }] });
        },
      ),
    );
    expect(observedUrl).toBe("http://api.test/v1/models");
    expect(observedAuthorization).toBeNull();
    expect(observedRedirect).toBe("error");
    expect(result).toEqual({ provider: "tensorprime", models: [{ id: "model-a" }] });
  });

  test("discovers models from the Azure deployments endpoint when path_style is azure", async () => {
    let observedUrl = "";
    const result = await Effect.runPromise(
      discoverProviderModels(
        {
          id: "azure-prod",
          name: "Azure Production",
          base_url: "https://myresource.openai.azure.com/openai",
          enabled: true,
          authentication: { type: "none" },
          path_style: "azure",
          api_version: "2024-10-21",
        },
        async (input) => {
          observedUrl = String(input);
          return Response.json({ data: [{ id: "dep-gpt-4" }, { id: "dep-gpt-35" }] });
        },
      ),
    );
    expect(observedUrl).toBe(
      "https://myresource.openai.azure.com/openai/deployments?api-version=2024-10-21",
    );
    expect(result).toEqual({
      provider: "azure-prod",
      models: [{ id: "dep-gpt-4" }, { id: "dep-gpt-35" }],
    });
  });

  test("uses the same normalized keyless endpoint for scientific admission", async () => {
    let observedUrl = "";
    let observedAuthorization: string | null = "missing";
    let observedRedirect: RequestRedirect | undefined;
    const catalog = await Effect.runPromise(
      discoverScientificModelCatalog(
        [
          {
            id: "tensorprime",
            name: "TensorPrime",
            base_url: "http://api.test/",
            enabled: true,
            authentication: { type: "none" },
          },
        ],
        async (input, init) => {
          observedUrl = String(input);
          observedAuthorization = new Headers(init?.headers).get("authorization");
          observedRedirect = init?.redirect;
          return Response.json({ data: [{ id: "model-a" }] });
        },
      ),
    );
    expect(observedUrl).toBe("http://api.test/v1/models");
    expect(observedAuthorization).toBeNull();
    expect(observedRedirect).toBe("error");
    expect(catalog.get("tensorprime")).toEqual(new Set(["model-a"]));
  });

  test("streams a keyless provider response from the normalized chat endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let observedUrl = "";
    let observedAuthorization: string | null = "missing";
    let observedRedirect: RequestRedirect | undefined;
    globalThis.fetch = (async (input, init) => {
      observedUrl = String(input);
      observedAuthorization = new Headers(init?.headers).get("authorization");
      observedRedirect = init?.redirect;
      return new Response(
        'data: {"id":"c","choices":[{"index":0,"delta":{"content":"4"}}]}\n\ndata: [DONE]\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch;
    try {
      const response = buildChatCompletionsStreamResponse({
        upstreamUrl: openAIEndpoint("http://api.test/v1/", "chat/completions"),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "model-a", stream: true }),
        clientSignal: new AbortController().signal,
        matchedRecipe: null,
        sourceHeader: null,
        sessionId: null,
        recordedModel: "model-a",
        recordedProvider: "tensorprime",
        requestStart: performance.now(),
        requestProvider: "tensorprime",
        providerRouting: {
          baseUrl: "http://api.test/v1",
          provider: {
            id: "tensorprime",
            name: "TensorPrime",
            base_url: "http://api.test/v1",
            enabled: true,
            authentication: { type: "none" },
          },
        },
        context: {
          logger: {
            error: () => undefined,
            warn: () => undefined,
          },
          stores: {},
        } as never,
        keepaliveIntervalMs: 60_000,
      });
      const body = await response.text();
      expect(observedUrl).toBe("http://api.test/v1/chat/completions");
      expect(observedAuthorization).toBeNull();
      expect(observedRedirect).toBe("error");
      expect(body).toContain('"content":"4"');
      expect(body).toContain("data: [DONE]");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("legacy provider migration", () => {
  test("maps records with keys to api_key and empty records to none", () => {
    const directory = mkdtempSync(join(tmpdir(), "local-studio-provider-"));
    temporaryDirectories.push(directory);
    writeFileSync(
      join(directory, "studio-settings.json"),
      JSON.stringify({
        providers: [
          {
            id: "keyed",
            name: "Keyed",
            base_url: "http://127.0.0.1:8101",
            api_key: "secret",
            enabled: true,
          },
          {
            id: "keyless",
            name: "Keyless",
            base_url: "http://127.0.0.1:8102",
            api_key: "",
            enabled: true,
          },
        ],
      }),
    );
    const providers = loadPersistedConfig(directory).providers ?? [];
    const authentication = providers[0]?.authentication;
    expect(authentication?.type).toBe("api_key");
    if (authentication?.type !== "api_key") throw new Error("Expected API-key migration");
    expect(authentication.secret_ref).toMatch(/^provider:keyed:api-key:[a-f0-9]{32}$/u);
    expect(providers[1]?.authentication).toEqual({ type: "none" });
  });
});
