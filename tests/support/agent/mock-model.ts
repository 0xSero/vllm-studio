// Scripted mock model for the server-side agent runtime tests.
//
// Hook choice (investigated against the published 0.78.1 API):
// `@earendil-works/pi-ai` ships a first-party faux provider
// (`registerFauxProvider` in dist/providers/faux.js, exported from the package
// root). It registers a real `ApiProvider` in pi-ai's api-registry — the exact
// registry the production stream path uses: the coding-agent SDK builds its
// Agent with `streamFn -> streamSimple(model, ...) -> getApiProvider(model.api)`
// (see pi-coding-agent dist/core/sdk.js). Queued `AssistantMessage`s are then
// re-streamed as genuine start/text_delta/toolcall_delta/done events through
// the real AgentSession machinery, including real tool execution between
// turns. No module mocking, no monkey-patching: this is the same mechanism
// pi's own test suite scripts models with.
//
// IMPORTANT: pi-coding-agent has a NESTED copy of pi-ai
// (frontend/node_modules/@earendil-works/pi-coding-agent/node_modules/...).
// The api-registry is module-scoped state, so the faux provider must be
// registered in that nested instance — importing the top-level
// frontend/node_modules/@earendil-works/pi-ai would register into a registry
// the SDK never consults. Hence the explicit deep relative import below.
//
// Model routing: our runtime resolves models through `refreshPiModels()`,
// which merges "user pi" providers from `$HOME/.pi/agent/models.json` — the
// only provider source whose `api` field passes through verbatim (controller
// providers are hardcoded to `openai-completions`). `writeMockModelConfig()`
// writes a provider named "mock" with `api: "local-studio-mock"` into the
// (tmpdir-overridden) HOME, so the ModelRegistry builds a Model whose `api`
// dispatches to the faux provider registered here. Fully production-path:
// settings -> controller fetch -> models.json -> ModelRegistry.find -> faux.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  registerFauxProvider,
  type FauxProviderRegistration,
} from "../../../frontend/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/faux.js";

export {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "../../../frontend/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/faux.js";
export type { FauxProviderRegistration };

/** `api` id the faux stream implementation is registered under. */
export const MOCK_API = "local-studio-mock";
/** Provider name inside `$HOME/.pi/agent/models.json`. */
export const MOCK_PROVIDER_NAME = "mock";
/** Qualified provider id after refreshPiModels() merges user-pi providers. */
export const MOCK_PROVIDER_ID = `user-pi-${MOCK_PROVIDER_NAME}`;
/** Raw model id as the registry sees it. */
export const MOCK_MODEL_RAW_ID = "mock-model";
/** Model id the runtime API accepts (AgentModel.id for user-pi providers). */
export const MOCK_MODEL_ID = `${MOCK_PROVIDER_ID}/${MOCK_MODEL_RAW_ID}`;

// Generous limits: metadata only (the faux stream never truncates), and we
// never impose output caps in test fixtures.
const MOCK_CONTEXT_WINDOW = 1_000_000;
const MOCK_MAX_TOKENS = 1_000_000;

/**
 * Register the scripted model's stream implementation in the SDK's pi-ai
 * api-registry. Queue turns with `registration.setResponses([...])` using the
 * `fauxAssistantMessage`/`fauxText`/`fauxToolCall` helpers re-exported above.
 * Call `registration.unregister()` in test cleanup.
 */
export function registerMockModel(): FauxProviderRegistration {
  return registerFauxProvider({
    api: MOCK_API,
    provider: MOCK_PROVIDER_ID,
    models: [
      {
        id: MOCK_MODEL_RAW_ID,
        name: "Mock Model",
        reasoning: false,
        input: ["text"],
        contextWindow: MOCK_CONTEXT_WINDOW,
        maxTokens: MOCK_MAX_TOKENS,
      },
    ],
  });
}

/**
 * Write `$home/.pi/agent/models.json` so `refreshPiModels()` surfaces the
 * mock model as a user-pi provider whose `api` routes to the faux provider.
 */
export async function writeMockModelConfig(home: string): Promise<void> {
  const agentDir = path.join(home, ".pi", "agent");
  await mkdir(agentDir, { recursive: true });
  const config = {
    providers: {
      [MOCK_PROVIDER_NAME]: {
        // Never contacted: the faux stream short-circuits before any HTTP.
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
            maxTokens: MOCK_MAX_TOKENS,
          },
        ],
      },
    },
  };
  await writeFile(path.join(agentDir, "models.json"), JSON.stringify(config, null, 2), "utf-8");
}
