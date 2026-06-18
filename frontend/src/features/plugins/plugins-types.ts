// Plugin/MCP types re-exported from their canonical modules.
//
// These were previously duplicated full definitions. The canonical homes are:
//   - McpServer     ≡ PluginRow   → features/agent/mcp/discovery.ts
//   - CatalogueEntry ≡ McpCatalogueEntry → features/agent/mcp/types.ts
//   - RegistrySource ≡ McpRegistrySource → features/agent/mcp/registry-sources.ts
// The aliases below preserve the plugins-feature import surface.

export type { PluginRow as McpServer } from "@/features/agent/mcp/discovery";
export type { McpCatalogueEntry as CatalogueEntry } from "@/features/agent/mcp/types";
export type { McpRegistrySource as RegistrySource } from "@/features/agent/mcp/registry-sources";

export type ServersPayload = {
  servers?: import("@/features/agent/mcp/discovery").PluginRow[];
  plugins?: import("@/features/agent/mcp/discovery").PluginRow[];
  catalogue?: import("@/features/agent/mcp/types").McpCatalogueEntry[];
  error?: string;
};

export type RegistryPayload = {
  source: "official";
  sourceUrl: string;
  registries?: import("@/features/agent/mcp/registry-sources").McpRegistrySource[];
  entries: import("@/features/agent/mcp/types").McpCatalogueEntry[];
  warnings?: string[];
  error?: string;
};
