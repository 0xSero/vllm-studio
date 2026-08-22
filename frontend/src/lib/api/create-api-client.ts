import { createRigsApi } from "./rigs";
import { createApiCore, type RequestOptions } from "./core";
import { createLogsApi } from "./logs";
import { createRecipesApi } from "./recipes";
import { createStudioApi } from "./studio";
import { createSystemApi } from "./system";
import {
  InferenceUsageAckSchema,
  InferenceUsageBatchSchema,
  WorkersPayloadSchema,
  type InferenceUsageEvent,
  type SessionMetadata,
  type SessionMetadataPayload,
} from "@local-studio/contracts/federation";
import { Schema } from "effect";

export function createApiClient(params: {
  baseUrl: string;
  useProxy: boolean;
  backendUrlOverride?: string;
  apiKeyOverride?: string;
  workerId?: string;
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
    getUsageOutbox: async (): Promise<readonly InferenceUsageEvent[]> =>
      Schema.decodeUnknownSync(InferenceUsageBatchSchema)(
        await core.request<unknown>("/studio/usage/outbox?limit=100", { retries: 0 }),
      ).events,
    ingestUsageEvents: async (events: readonly InferenceUsageEvent[]): Promise<readonly string[]> =>
      Schema.decodeUnknownSync(InferenceUsageAckSchema)(
        await core.request<unknown>("/studio/usage/events", {
          method: "POST",
          retries: 0,
          body: JSON.stringify({ events }),
        }),
      ).event_ids,
    acknowledgeUsageEvents: (eventIds: readonly string[]): Promise<{ success: boolean }> =>
      core.request("/studio/usage/outbox/ack", {
        method: "POST",
        retries: 0,
        body: JSON.stringify({ event_ids: eventIds }),
      }),
    healthPoll: (timeoutMs?: number) => core.healthPoll(timeoutMs),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
