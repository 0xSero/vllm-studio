import {
  refreshPiModels,
  type PiControllerModelsRequest,
} from "../pi-runtime-models";
import { jsonTask } from "./helpers";

function parseControllers(value: unknown): PiControllerModelsRequest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.url !== "string" || !record.url.trim()) return [];
    return [{
      url: record.url,
      ...(typeof record.apiKey === "string" ? { apiKey: record.apiKey } : {}),
      ...(typeof record.name === "string" ? { name: record.name } : {}),
    }];
  });
}

export async function handleAgentModels(request?: Request): Promise<Response> {
  return jsonTask(
    async () => {
      const body = request
        ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
        : {};
      return refreshPiModels(parseControllers(body.controllers));
    },
    ({ models }) => ({ provider: "local-studio", models }),
    { fallback: "Failed to load /v1/models", status: 502 },
  );
}
