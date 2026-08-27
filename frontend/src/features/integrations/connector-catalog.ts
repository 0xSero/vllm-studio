import type { ConnectorView, McpCatalogEntry } from "@shared/agent/connector-contract";
import {
  oauthConnectorProvider,
  type OAuthConnectorAuthDefinition,
} from "@shared/agent/oauth-connector-contract";

export const SSH_SERVER_PLACEHOLDER = "{{LOCAL_STUDIO_CONTROLLER}}";

export type CatalogEntry = Omit<McpCatalogEntry, "command" | "args"> & {
  command: string;
  args: readonly string[];
  auth?: OAuthConnectorAuthDefinition;
};

export const hydrateConnectorCatalog = (entries: readonly McpCatalogEntry[]): CatalogEntry[] =>
  entries.map((entry) => {
    const provider = entry.authProvider ? oauthConnectorProvider(entry.authProvider) : null;
    const hydrated = { ...entry, command: entry.command ?? "", args: entry.args ?? [] };
    return provider ? { ...hydrated, auth: provider.auth } : hydrated;
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

export function renderConnectorCommand(connector: ConnectorView): string {
  if (connector.transport === "http") return connector.url ?? "HTTP endpoint not set";
  if (connector.runtime?.kind === "node") {
    return renderCommandLine("npx", [
      "--yes",
      "--package",
      `${connector.runtime.package}@${connector.runtime.version}`,
      connector.runtime.executable,
      ...(connector.args ?? []),
    ]);
  }
  if (connector.runtime?.kind === "python") {
    return renderCommandLine("uvx", [
      ...(connector.runtime.with ?? []).flatMap((requirement) => ["--with", requirement]),
      "--from",
      `${connector.runtime.package}==${connector.runtime.version}`,
      connector.runtime.executable,
      ...(connector.args ?? []),
    ]);
  }
  return renderCommandLine(connector.command ?? "", connector.args ?? []);
}
