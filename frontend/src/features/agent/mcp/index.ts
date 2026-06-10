// Public entry point for the MCP server module.
export { discoverMcpServers, type PluginRow } from "@/features/agent/mcp/discovery";
export { MCP_CATALOGUE, findCatalogueEntry } from "@/features/agent/mcp/catalogue";
export {
  listStoredServers,
  upsertServer,
  removeServer,
  setServerEnabled,
  setServerTags,
  serverConfigPath,
} from "@/features/agent/mcp/store";
export type { McpServerDef, McpServerEntry, McpServerSource, McpCatalogueEntry } from "@/features/agent/mcp/types";
