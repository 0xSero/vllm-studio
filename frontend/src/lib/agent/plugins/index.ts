// Public entry point for the Codex plugin module. Importers should pull
// discovery + types from here; plugin-discovery.ts re-exports the back-compat
// surface (discoverPlugins = discoverPluginsSync) separately.

export { SOURCES, discoverPluginsAsync, discoverPluginsSync } from "./registry";
export * from "./types";
