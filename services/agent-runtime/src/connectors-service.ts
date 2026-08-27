import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "fs/promises";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { resolveDataDir } from "./data-dir";
import { Schema } from "effect";
import {
  ConnectorsFileSchema,
  type ConnectorConfig,
  type ConnectorView,
} from "./connector-contract";
import {
  GOOGLE_MCP_PREVIEW_ENV,
  GOOGLE_WORKSPACE_BINDINGS,
  googleWorkspaceAuthAccount,
  googleWorkspaceConnectorId,
  googleWorkspaceConnectorIdentity,
  googleWorkspaceEndpoint,
  googleWorkspaceTransport,
  isGoogleWorkspaceEndpoint,
  legacyGoogleWorkspaceService,
  type GoogleWorkspaceIdentity,
} from "./google-workspace-binding";

export {
  type ConnectorAuthReference,
  type ConnectorConfig,
  type ConnectorOrigin,
  type ConnectorView,
} from "./connector-contract";

const MASK = "••••••••";
const SECRET_KEY_PATTERN = /token|key|secret|password|auth/i;

export const isSecretConnectorKey = (
  key: string,
  flags: Readonly<Record<string, boolean>> | undefined,
): boolean => flags?.[key] ?? SECRET_KEY_PATTERN.test(key);
let connectorAccess = Promise.resolve();

function withConnectorAccess<A>(operation: () => Promise<A>): Promise<A> {
  const result = connectorAccess.then(operation);
  connectorAccess = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function claimsGoogleWorkspace(connector: ConnectorConfig): boolean {
  return (
    googleWorkspaceConnectorIdentity(connector.id) !== null ||
    legacyGoogleWorkspaceService(connector.id) !== null ||
    connector.auth?.provider === "google-workspace" ||
    connector.origin?.binding === "google-workspace"
  );
}

export function googleWorkspaceConnector(
  identity: GoogleWorkspaceIdentity,
  email: string,
  enabled: boolean,
): ConnectorConfig {
  const binding = GOOGLE_WORKSPACE_BINDINGS[identity.service];
  const transport = googleWorkspaceTransport(process.env[GOOGLE_MCP_PREVIEW_ENV]);
  return {
    id: googleWorkspaceConnectorId(identity.service, identity.accountKey),
    name: email ? `${binding.name} · ${email}` : binding.name,
    transport: "http",
    url: googleWorkspaceEndpoint(identity.service, transport),
    auth: {
      type: "oauth",
      provider: "google-workspace",
      account: googleWorkspaceAuthAccount(identity),
    },
    allowTools: [...binding.observeTools],
    origin: {
      kind: "account-adapter",
      id: googleWorkspaceAuthAccount(identity),
      binding: "google-workspace",
    },
    enabled,
  };
}

function legacyGoogleWorkspaceConnector(
  connector: ConnectorConfig,
  service: GoogleWorkspaceIdentity["service"],
): ConnectorConfig {
  return {
    id: connector.id,
    name: `${GOOGLE_WORKSPACE_BINDINGS[service].name} (sign in again)`,
    transport: "http",
    url: GOOGLE_WORKSPACE_BINDINGS[service].mcpEndpoint,
    allowTools: [],
    origin: { kind: "account-adapter", id: service, binding: "google-workspace" },
    enabled: false,
  };
}

function matchesManagedIdentity(
  connector: ConnectorConfig,
  identity: GoogleWorkspaceIdentity,
): boolean {
  const account = googleWorkspaceAuthAccount(identity);
  return (
    connector.transport === "http" &&
    isGoogleWorkspaceEndpoint(identity.service, connector.url ?? "") &&
    connector.auth?.type === "oauth" &&
    connector.auth.provider === "google-workspace" &&
    connector.auth.account === account &&
    connector.origin?.kind === "account-adapter" &&
    connector.origin.id === account &&
    connector.origin.binding === "google-workspace"
  );
}

function hasOnlyManagedFields(connector: ConnectorConfig): boolean {
  return !(
    connector.command ||
    connector.cwd ||
    connector.args?.length ||
    connector.env ||
    connector.headers
  );
}

function matchesManagedTools(
  connector: ConnectorConfig,
  identity: GoogleWorkspaceIdentity,
): boolean {
  const tools = GOOGLE_WORKSPACE_BINDINGS[identity.service].observeTools;
  return (
    connector.allowTools?.length === tools.length &&
    tools.every((tool, index) => connector.allowTools?.[index] === tool)
  );
}

export function protectManagedConnector(connector: ConnectorConfig): ConnectorConfig {
  if (!claimsGoogleWorkspace(connector)) return connector;
  const legacyService = legacyGoogleWorkspaceService(connector.id);
  if (legacyService) return legacyGoogleWorkspaceConnector(connector, legacyService);
  const identity = googleWorkspaceConnectorIdentity(connector.id);
  if (
    !identity ||
    !matchesManagedIdentity(connector, identity) ||
    !hasOnlyManagedFields(connector) ||
    !matchesManagedTools(connector, identity)
  ) {
    throw new Error(`Managed Google Workspace connector "${connector.id}" is immutable`);
  }
  return {
    ...googleWorkspaceConnector(identity, "", connector.enabled),
    name: connector.name,
  };
}

export function resolveConnectorsFilePath(): string {
  return join(resolveDataDir(), "connectors.json");
}

const CONNECTOR_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export const isValidConnectorId = (id: string): boolean => CONNECTOR_ID_PATTERN.test(id);

export const connectorToolPrefix = (id: string): string => id.replace(/-/g, "_");

export async function listConnectors(): Promise<ConnectorConfig[]> {
  const file = resolveConnectorsFilePath();
  if (!existsSync(file)) return [];
  try {
    const parsed = Schema.decodeUnknownSync(ConnectorsFileSchema)(
      JSON.parse(await readFile(file, "utf-8")),
    );
    return (parsed.connectors ?? []).map(protectManagedConnector);
  } catch {
    throw new Error("Connector configuration is invalid");
  }
}

async function writeConnectors(connectors: ConnectorConfig[]): Promise<void> {
  resolveDataDir();
  const file = resolveConnectorsFilePath();
  const payload = JSON.stringify({ connectors: connectors.map(protectManagedConnector) }, null, 2);
  const tempFile = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(tempFile, payload, "utf-8");
  await chmod(tempFile, 0o600).catch(() => undefined);
  await rename(tempFile, file);
}

export function saveConnectors(connectors: ConnectorConfig[]): Promise<void> {
  return withConnectorAccess(() => writeConnectors(connectors));
}

export async function upsertConnector(connector: ConnectorConfig): Promise<ConnectorConfig[]> {
  return upsertConnectors([connector]);
}

function mergedConnectorSecrets(
  connector: ConnectorConfig,
  existing: ConnectorConfig | undefined,
): Pick<ConnectorConfig, "env" | "headers" | "envSecret" | "headerSecret"> {
  return {
    env: mergeSecrets(connector.env, existing?.env, existing?.envSecret),
    headers: mergeSecrets(connector.headers, existing?.headers, existing?.headerSecret),
    envSecret: connector.envSecret ?? existing?.envSecret,
    headerSecret: connector.headerSecret ?? existing?.headerSecret,
  };
}

function mergeConnector(
  connector: ConnectorConfig,
  existing: ConnectorConfig | undefined,
): ConnectorConfig {
  return {
    ...connector,
    ...mergedConnectorSecrets(connector, existing),
    cwd: connector.cwd ?? existing?.cwd,
    allowTools: "allowTools" in connector ? connector.allowTools : existing?.allowTools,
    origin: connector.origin ?? existing?.origin,
    auth: connector.auth ?? existing?.auth,
  };
}

export function upsertConnectors(incoming: ConnectorConfig[]): Promise<ConnectorConfig[]> {
  return withConnectorAccess(async () => {
    const connectors = await listConnectors();
    for (const candidate of incoming) {
      const connector = protectManagedConnector(candidate);
      const index = connectors.findIndex((entry) => entry.id === connector.id);
      const merged = mergeConnector(connector, connectors[index]);
      if (index === -1) connectors.push(merged);
      else connectors[index] = merged;
    }
    await writeConnectors(connectors);
    return connectors;
  });
}

export function removeConnector(id: string): Promise<ConnectorConfig[]> {
  if (googleWorkspaceConnectorIdentity(id)) {
    return Promise.reject(
      new Error(`Managed Google Workspace connector "${id}" cannot be removed`),
    );
  }
  return withConnectorAccess(async () => {
    const connectors = (await listConnectors()).filter((entry) => entry.id !== id);
    await writeConnectors(connectors);
    return connectors;
  });
}

function mergeSecrets(
  incoming: Record<string, string> | undefined,
  stored: Record<string, string> | undefined,
  storedFlags: Readonly<Record<string, boolean>> | undefined,
): Record<string, string> | undefined {
  if (!incoming) return incoming;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    result[key] =
      value === MASK && stored?.[key] && isSecretConnectorKey(key, storedFlags)
        ? stored[key]
        : value;
  }
  return result;
}

const maskRecord = (
  record: Record<string, string> | undefined,
  flags: Readonly<Record<string, boolean>> | undefined,
): Record<string, string> | undefined => {
  if (!record) return record;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      isSecretConnectorKey(key, flags) && value ? MASK : value,
    ]),
  );
};

export function toConnectorView(connector: ConnectorConfig): ConnectorView {
  return {
    ...connector,
    env: maskRecord(connector.env, connector.envSecret),
    headers: maskRecord(connector.headers, connector.headerSecret),
    secret_keys: [
      ...Object.keys(connector.env ?? {}).filter((key) =>
        isSecretConnectorKey(key, connector.envSecret),
      ),
      ...Object.keys(connector.headers ?? {}).filter((key) =>
        isSecretConnectorKey(key, connector.headerSecret),
      ),
    ],
  };
}

export async function enabledConnectors(): Promise<ConnectorConfig[]> {
  return (await listConnectors()).filter((connector) => connector.enabled);
}

export function hasEnabledConnectorsSync(): boolean {
  const file = resolveConnectorsFilePath();
  if (!existsSync(file)) return false;
  try {
    const parsed = Schema.decodeUnknownSync(ConnectorsFileSchema)(
      JSON.parse(readFileSync(file, "utf-8")),
    );
    return Boolean(parsed.connectors?.some((connector) => connector.enabled));
  } catch {
    return false;
  }
}

export function connectorsRevisionSync(): string {
  const file = resolveConnectorsFilePath();
  try {
    const info = statSync(file);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return "none";
  }
}
