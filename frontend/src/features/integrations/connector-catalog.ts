import type { McpCatalogEntry } from "@shared/agent/connector-contract";
import {
  oauthConnectorProvider,
  type OAuthConnectorAuthDefinition,
} from "@shared/agent/oauth-connector-contract";

export type CatalogEntry = Omit<McpCatalogEntry, "command" | "args"> & {
  command: string;
  args: readonly string[];
  auth?: OAuthConnectorAuthDefinition;
};

const remoteOAuthDefinition = (provider: string): OAuthConnectorAuthDefinition => ({
  kind: "oauth-pkce",
  clientIdEnv: provider === "x-api" ? "LOCAL_STUDIO_X_CLIENT_ID" : "",
  tokenUrl: "",
  scopes: [],
  tokenEnv: "",
  identityUrl: "",
  identityField: "",
  createClientUrl:
    provider === "x-api" ? "https://developer.x.com/en/portal/projects-and-apps" : "",
  setupHint:
    provider === "x-api"
      ? "Create an OAuth 2.0 public client with a localhost callback, then paste its public Client ID."
      : "",
});

export const hydrateConnectorCatalog = (entries: readonly McpCatalogEntry[]): CatalogEntry[] =>
  entries.map((entry) => {
    const provider = entry.authProvider ? oauthConnectorProvider(entry.authProvider) : null;
    const hydrated = { ...entry, command: entry.command ?? "", args: entry.args ?? [] };
    if (provider) return { ...hydrated, auth: provider.auth };
    return entry.authProvider
      ? { ...hydrated, auth: remoteOAuthDefinition(entry.authProvider) }
      : hydrated;
  });

export function renderCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args]
    .filter((part) => part.length > 0)
    .map((part) => (/\s|["'\\$`]/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

export function renderCatalogCommand(entry: CatalogEntry): string {
  if (entry.transport === "builtin") return "Built into Local Studio";
  if (entry.transport === "http") return entry.url ?? "HTTP endpoint not set";
  if (entry.runtime?.kind === "node") {
    return renderCommandLine("npx", [
      "--yes",
      "--package",
      `${entry.runtime.package}@${entry.runtime.version}`,
      entry.runtime.executable,
      ...(entry.args ?? []),
    ]);
  }
  if (entry.runtime?.kind === "python") {
    return renderCommandLine("uvx", [
      ...(entry.runtime.with ?? []).flatMap((requirement) => ["--with", requirement]),
      "--from",
      `${entry.runtime.package}==${entry.runtime.version}`,
      entry.runtime.executable,
      ...(entry.args ?? []),
    ]);
  }
  return renderCommandLine(entry.command ?? "", entry.args ?? []);
}
