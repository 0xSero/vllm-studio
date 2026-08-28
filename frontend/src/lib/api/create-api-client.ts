import { createRigsApi } from "./rigs";
import { createApiCore } from "./core";
import { createLogsApi } from "./logs";
import { createRecipesApi } from "./recipes";
import { createStudioApi } from "./studio";
import { createRegistryApi } from "./registry";
import { createSystemApi } from "./system";

export function createApiClient(params: {
  baseUrl: string;
  useProxy: boolean;
  backendUrlOverride?: string;
  apiKeyOverride?: string;
}) {
  const core = createApiCore(params);
  return {
    ...createSystemApi(core),
    ...createRecipesApi(core),
    ...createLogsApi(core),
    ...createStudioApi(core),
    ...createRegistryApi(core),
    ...createRigsApi(core),
    healthPoll: (timeoutMs?: number) => core.healthPoll(timeoutMs),
  };
}
