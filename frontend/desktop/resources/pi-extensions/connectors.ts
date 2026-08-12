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
import { bridgeJson, textResult, type ToolResult } from "./bridge.ts";

const CALL_TIMEOUT_MS = 120_000;

interface InventoryTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface InventoryConnector {
  id: string;
  name: string;
  tools: InventoryTool[];
  error?: string;
}

/** Render an MCP tools/call result (content blocks) as plain text. */
const renderMcpResult = (result: unknown): string => {
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { content?: unknown[] }).content)
  ) {
    const blocks = (result as { content: Array<{ type?: string; text?: string }> }).content;
    const texts = blocks
      .map((block) => (block.type === "text" && block.text ? block.text : JSON.stringify(block)))
      .join("\n");
    return texts || "(empty result)";
  }
  return JSON.stringify(result ?? null);
};

async function callConnectorTool(
  connectorId: string,
  tool: string,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<ToolResult> {
  try {
    const { response, body } = await bridgeJson<{
      ok?: boolean;
      result?: unknown;
      error?: string;
    }>(
      "/api/agent/connectors/call",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connector_id: connectorId, tool, args }),
      },
      signal,
      CALL_TIMEOUT_MS,
    );
    const payload = body ?? {};
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
  }
}

export default async function connectorsExtension(pi: ExtensionAPI): Promise<void> {
  let inventory: InventoryConnector[] = [];
  try {
    const { body } = await bridgeJson<{ connectors?: InventoryConnector[] }>(
      "/api/agent/connectors/call",
      {},
      undefined,
      30_000,
    );
    inventory = body?.connectors ?? [];
  } catch {
    // Frontend unreachable or no connectors — register nothing.
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
        parameters: Type.Unsafe<Record<string, unknown>>(
          tool.inputSchema ?? { type: "object", properties: {} },
        ),
        async execute(_id, params, signal) {
          return callConnectorTool(
            connector.id,
            tool.name,
            (params ?? {}) as Record<string, unknown>,
            signal,
          );
        },
      });
    }
  }
}
