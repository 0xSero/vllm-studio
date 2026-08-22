import { createRigsApi } from "./rigs";
import { createApiCore, type RequestOptions } from "./core";
import { createLogsApi } from "./logs";
import { createRecipesApi } from "./recipes";
import { createStudioApi } from "./studio";
import { createSystemApi } from "./system";
import {
  WorkersPayloadSchema,
  type SessionMetadata,
  type SessionMetadataPayload,
} from "@local-studio/contracts/federation";
import { Schema } from "effect";

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
    getWorkers: async (options?: RequestOptions) =>
      Schema.decodeUnknownSync(WorkersPayloadSchema)(
        await core.request<unknown>("/studio/workers", { retries: 0, ...options }),
      ),
    getSessionMetadata: (): Promise<SessionMetadataPayload> =>
      core.request("/studio/sessions", { retries: 0 }),
    upsertSessionMetadata: (metadata: SessionMetadata): Promise<{ success: boolean }> =>
      core.request(`/studio/sessions/${encodeURIComponent(metadata.session_id)}`, {
        method: "PUT",
        retries: 0,
        body: JSON.stringify(metadata),
      }),
    healthPoll: (timeoutMs?: number) => core.healthPoll(timeoutMs),
  };
}
