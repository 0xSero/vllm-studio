import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Schema } from "effect";
import {
  requestJson,
  JsonObjectSchema,
  JsonSchema,
  result,
  type Json,
  type JsonObject,
  type ToolResult,
} from "./first-party-tool.ts";

type ConnectorCallDetails = {
  connectorId: string;
  tool: string;
  failed?: boolean;
  error?: string;
};

const InventoryToolSchema = Schema.Struct({
  name: Schema.String,
  description: Schema.optional(Schema.String),
  inputSchema: Schema.optional(JsonObjectSchema),
});
const InventoryConnectorSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tools: Schema.Array(InventoryToolSchema),
  error: Schema.optional(Schema.String),
});
type InventoryConnector = typeof InventoryConnectorSchema.Type;

const InventoryResponseSchema = Schema.Struct({
  connectors: Schema.optional(Schema.Array(InventoryConnectorSchema)),
});
const CallResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  result: Schema.optional(JsonSchema),
  error: Schema.optional(Schema.String),
});
const McpResultSchema = Schema.Struct({
  content: Schema.Array(
    Schema.Struct({ type: Schema.optional(Schema.String), text: Schema.optional(Schema.String) }),
  ),
});

const FRONTEND_BASE = process.env.LOCAL_STUDIO_FRONTEND_BASE ?? "http://127.0.0.1:3000";
const CALL_TIMEOUT_MS = 120_000;

function modelId(): string {
  return process.env.LOCAL_STUDIO_MODEL_ID ?? "";
}

const renderMcpResult = (result: Json | undefined): string => {
  const parsed = Schema.decodeUnknownOption(McpResultSchema)(result);
  if (parsed._tag === "Some") {
    const texts = parsed.value.content
      .map((block) => (block.type === "text" && block.text ? block.text : JSON.stringify(block)))
      .join("\n");
    return texts || "(empty result)";
  }
  return JSON.stringify(result ?? null);
};

async function callConnectorTool(
  connectorId: string,
  tool: string,
  args: JsonObject,
  signal: AbortSignal | undefined,
): Promise<ToolResult<ConnectorCallDetails>> {
  try {
    const response = await requestJson(
      `${FRONTEND_BASE}/api/agent/connectors/call`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connector_id: connectorId, tool, args, model_id: modelId() }),
      },
      signal,
      CALL_TIMEOUT_MS,
    );
    const payload = Schema.decodeUnknownSync(CallResponseSchema)(response.body);
    if (!response.ok || !payload.ok) {
      return result<ConnectorCallDetails>(
        `${connectorId}/${tool} failed: ${payload.error ?? response.status}`,
        {
          connectorId,
          tool,
          failed: true,
        },
      );
    }
    return result<ConnectorCallDetails>(renderMcpResult(payload.result), { connectorId, tool });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result<ConnectorCallDetails>(`${connectorId}/${tool} failed: ${message}`, {
      connectorId,
      tool,
      error: message,
      failed: true,
    });
  }
}

export default async function connectorsExtension(pi: ExtensionAPI): Promise<void> {
  let inventory: readonly InventoryConnector[] = [];
  try {
    const response = await fetch(
      `${FRONTEND_BASE}/api/agent/connectors/call?model_id=${encodeURIComponent(modelId())}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    const payload = Schema.decodeUnknownSync(InventoryResponseSchema)(await response.json());
    inventory = payload.connectors ?? [];
  } catch {
    return;
  }

  for (const connector of inventory) {
    for (const tool of connector.tools) {
      const qualifiedName = `${connector.id.replace(/-/g, "_")}_${tool.name.replace(/[^A-Za-z0-9_]/g, "_")}`;
      pi.registerTool({
        name: qualifiedName,
        label: `${connector.name}: ${tool.name}`,
        description: tool.description || `${tool.name} via the ${connector.name} connector`,
        parameters: Type.Unsafe<JsonObject>(tool.inputSchema ?? { type: "object", properties: {} }),
        async execute(_id, params, signal) {
          return callConnectorTool(connector.id, tool.name, params ?? {}, signal);
        },
      });
    }
  }
}
