import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderConfigInput } from "../../../frontend/node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js";
import {
  fauxProvider,
  type FauxProviderHandle,
} from "../../../frontend/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/faux.js";

export {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "../../../frontend/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/faux.js";
export type { FauxProviderHandle };

export const MOCK_API = "local-studio-mock";
export const MOCK_PROVIDER_NAME = "mock";
export const MOCK_PROVIDER_ID = `user-pi-${MOCK_PROVIDER_NAME}`;
export const MOCK_MODEL_RAW_ID = "mock-model";
export const MOCK_MODEL_ID = `${MOCK_PROVIDER_ID}/${MOCK_MODEL_RAW_ID}`;

const MOCK_CONTEXT_WINDOW = 1_000_000;
const MOCK_MODEL_LIMIT = 1_000_000;

declare global {
  var localStudioMockProviderConfigs: Map<string, ProviderConfigInput> | undefined;
}

function mockProviderConfigs(): Map<string, ProviderConfigInput> {
  return (globalThis.localStudioMockProviderConfigs ??= new Map());
}

function mockProviderConfig(handle: FauxProviderHandle): ProviderConfigInput {
  return {
    name: "Mock Model",
    apiKey: "mock-key",
    api: handle.api,
    streamSimple: handle.provider.streamSimple,
    models: handle.models.map((model) => ({
      id: model.id,
      name: model.name,
      api: model.api,
      baseUrl: model.baseUrl,
      reasoning: model.reasoning,
      thinkingLevelMap: model.thinkingLevelMap,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      headers: model.headers,
      compat: model.compat,
    })),
  };
}

export function registerMockModel(key: string): FauxProviderHandle {
  const handle = fauxProvider({
    api: MOCK_API,
    provider: MOCK_PROVIDER_ID,
    models: [
      {
        id: MOCK_MODEL_RAW_ID,
        name: "Mock Model",
        reasoning: false,
        input: ["text"],
        contextWindow: MOCK_CONTEXT_WINDOW,
        maxTokens: MOCK_MODEL_LIMIT,
      },
    ],
  });
  mockProviderConfigs().set(key, mockProviderConfig(handle));
  return handle;
}

export function unregisterMockModel(key: string): void {
  mockProviderConfigs().delete(key);
}

export async function writeMockModelConfig(home: string): Promise<void> {
  const agentDir = path.join(home, ".pi", "agent");
  await mkdir(agentDir, { recursive: true });
  const config = {
    providers: {
      [MOCK_PROVIDER_NAME]: {
        baseUrl: "http://127.0.0.1:1",
        apiKey: "mock-key",
        api: MOCK_API,
        models: [
          {
            id: MOCK_MODEL_RAW_ID,
            name: "Mock Model",
            reasoning: false,
            input: ["text"],
            contextWindow: MOCK_CONTEXT_WINDOW,
            maxTokens: MOCK_MODEL_LIMIT,
          },
        ],
      },
    },
  };
  await writeFile(path.join(agentDir, "models.json"), JSON.stringify(config, null, 2), "utf-8");
}

export async function writeMockModelExtension(directory: string, key: string): Promise<string> {
  const file = path.join(directory, "mock-model-extension.mjs");
  const source = [
    "export default function registerMockModel(pi) {",
    "  const configs = globalThis.localStudioMockProviderConfigs;",
    `  const config = configs?.get(${JSON.stringify(key)});`,
    '  if (!config) throw new Error("Missing Local Studio mock provider");',
    `  pi.registerProvider(${JSON.stringify(MOCK_PROVIDER_ID)}, config);`,
    "}",
  ].join("\n");
  await writeFile(file, source, "utf-8");
  return file;
}
