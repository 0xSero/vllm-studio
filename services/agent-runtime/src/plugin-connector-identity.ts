import { createHash } from "node:crypto";
import type { ConnectorConfig } from "./connector-contract";

const sortedEntries = (record: Record<string, string> | undefined): [string, string][] =>
  Object.entries(record ?? {}).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

export function pluginConnectorConfigurationDigest(connector: ConnectorConfig): string {
  const identity = JSON.stringify([
    "local-studio-plugin-connector-v1",
    connector.id,
    connector.transport,
    connector.command ?? null,
    connector.args ?? [],
    sortedEntries(connector.env),
    connector.cwd ?? null,
    connector.url ?? null,
    sortedEntries(connector.headers),
    connector.auth ? [connector.auth.type, connector.auth.provider, connector.auth.account] : null,
  ]);
  return `sha256:${createHash("sha256").update(identity).digest("hex")}`;
}

export function connectorExecutionConfigurationDigest(connector: ConnectorConfig): string {
  const origin = connector.origin;
  const identity = JSON.stringify([
    "local-studio-connector-execution-v1",
    pluginConnectorConfigurationDigest(connector),
    connector.enabled,
    connector.allowTools ?? null,
    origin
      ? [
          origin.kind,
          origin.id,
          origin.version ?? null,
          origin.binding ?? null,
          origin.artifactDigest ?? null,
          origin.configurationDigest ?? null,
          origin.snapshotDigest ?? null,
          origin.runtimeDigest ?? null,
          origin.sourceDigest ?? null,
        ]
      : null,
  ]);
  return `sha256:${createHash("sha256").update(identity).digest("hex")}`;
}
