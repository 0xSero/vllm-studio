// Public entry point for the MCP server module.
export { discoverMcpServers, isBuiltinServerId, type PluginRow } from "./discovery";
export { MCP_CATALOGUE, findCatalogueEntry } from "./catalogue";
export {
  listStoredServers,
  upsertServer,
  removeServer,
  setServerEnabled,
  serverConfigPath,
  ensureMaterialized,
  disabledBuiltinIds,
} from "./store";
export type { McpServerDef, McpServerEntry, McpServerSource, McpCatalogueEntry } from "./types";
