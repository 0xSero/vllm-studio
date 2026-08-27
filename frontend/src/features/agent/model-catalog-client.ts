import { Schema } from "effect";
import { ModelCatalogResponseSchema } from "@local-studio/contracts/model-catalog";
import { agentModelsFromCatalog, type CatalogAgentModel } from "@/features/agent/models";
import { safeJson } from "@/features/agent/safe-json";
import { getControllerApiKey, normalizeControllerUrl } from "@/lib/api/controllers";
import { getHeadConnection } from "@/lib/api/head-controller";

const HeadRoutingConnectionSchema = Schema.Struct({
  connected: Schema.Boolean,
  url: Schema.NullOr(Schema.String),
  hasApiKey: Schema.Boolean,
});

const decodeHeadRoutingConnection = Schema.decodeUnknownSync(HeadRoutingConnectionSchema);
const decodeModelCatalog = Schema.decodeUnknownSync(ModelCatalogResponseSchema);

async function ensureHeadRoutingConnection(): Promise<void> {
  const head = getHeadConnection();
  if (!head) return;
  const targetUrl = normalizeControllerUrl(head.url);
  const apiKey = getControllerApiKey(head.url);
  const currentResponse = await fetch("/api/proxy/api/agent/head-connection", {
    cache: "no-store",
  });
  const current = currentResponse.ok
    ? decodeHeadRoutingConnection(await safeJson<unknown>(currentResponse))
    : null;
  if (
    current?.connected &&
    normalizeControllerUrl(current.url ?? "") === targetUrl &&
    (current.hasApiKey || !apiKey)
  ) {
    return;
  }
  const response = await fetch("/api/proxy/api/agent/head-connection", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: head.name, url: targetUrl, apiKey }),
  });
  if (!response.ok) throw new Error("Failed to synchronize the Studio Head model route");
  decodeHeadRoutingConnection(await safeJson<unknown>(response));
}

export async function loadAgentModelCatalog(): Promise<CatalogAgentModel[]> {
  await ensureHeadRoutingConnection();
  const response = await fetch("/api/agent/models", { cache: "no-store" });
  const payload = await safeJson<unknown>(response);
  if (!response.ok) throw new Error("Failed to load models");
  return agentModelsFromCatalog(decodeModelCatalog(payload));
}
