import { createRigsApi } from "./rigs";
import { createApiCore } from "./core";
import { createLogsApi } from "./logs";
import { createRecipesApi } from "./recipes";
import { createStudioApi } from "./studio";
import { createSpeechApi } from "./speech";
import { createSystemApi } from "./system";
import { createWorkbenchApi } from "./workbench";
import { createEnvironmentApi } from "./environment";

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
    ...createRigsApi(core),
    ...createSpeechApi(core),
    ...createWorkbenchApi(core),
    ...createEnvironmentApi(core),
    healthPoll: (timeoutMs?: number) => core.healthPoll(timeoutMs),
  };
}
