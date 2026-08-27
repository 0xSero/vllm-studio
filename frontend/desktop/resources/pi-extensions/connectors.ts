// Connector bridge extension for Local Studio.
//
// At session start it asks the frontend for the tool inventory of every
// enabled connector (MCP servers configured in Settings → Connectors) and
// registers each MCP tool as `<connectorId>_<toolName>`. Tool calls proxy
// through the frontend's pooled MCP connections, so one stdio server serves
// every session.
//
// Loaded by pi-runtime only when at least one connector is enabled.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Schema } from "effect";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

type ConnectorCallDetails = {
  connectorId: string;
  tool: string;
  failed?: boolean;
  error?: string;
};

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: ConnectorCallDetails;
};

const JsonSchema: Schema.Codec<Json, Json> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.mutable(Schema.Array(JsonSchema)),
    Schema.Record(Schema.String, JsonSchema),
  ]),
);
const JsonObjectSchema = Schema.Record(Schema.String, JsonSchema);
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

const textResult = (text: string, details: ConnectorCallDetails): ToolResult => ({
  content: [{ type: "text", text }],
  details,
});

/** Render an MCP tools/call result (content blocks) as plain text. */
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
): Promise<ToolResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const response = await fetch(`${FRONTEND_BASE}/api/agent/connectors/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connector_id: connectorId, tool, args }),
      signal: controller.signal,
    });
    const payload = Schema.decodeUnknownSync(CallResponseSchema)(await response.json());
    if (!response.ok || !payload.ok) {
      return textResult(`${connectorId}/${tool} failed: ${payload.error ?? response.status}`, {
        connectorId,
        tool,
        failed: true,
      });
    }
    return textResult(renderMcpResult(payload.result), { connectorId, tool });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return textResult(`${connectorId}/${tool} failed: ${message}`, {
      connectorId,
      tool,
      error: message,
      failed: true,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export default async function connectorsExtension(pi: ExtensionAPI): Promise<void> {
  let inventory: readonly InventoryConnector[] = [];
  try {
    const response = await fetch(`${FRONTEND_BASE}/api/agent/connectors/call`, {
      signal: AbortSignal.timeout(30_000),
    });
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
        // MCP tools carry their own JSON Schema; pass it through untyped.
        parameters: Type.Unsafe<JsonObject>(tool.inputSchema ?? { type: "object", properties: {} }),
        async execute(_id, params, signal) {
          return callConnectorTool(connector.id, tool.name, params ?? {}, signal);
        },
      });
    }
  }
}
