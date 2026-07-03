// Connector registry: the single owner of `<dataDir>/connectors.json`.
// A connector is an MCP server entry (mcp.json-compatible shape), so any
// server from the public MCP ecosystem drops in unchanged.

import { chmod, readFile, rename, writeFile } from "fs/promises";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { resolveDataDir } from "./data-dir";

export interface ConnectorConfig {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface ConnectorView extends Omit<ConnectorConfig, "env" | "headers"> {
  env?: Record<string, string>;
  headers?: Record<string, string>;
  secret_keys: string[];
}

const MASK = "••••••••";
/** Env/header keys that carry secrets and are masked in views. */
const SECRET_KEY_PATTERN = /token|key|secret|password|auth/i;

export function resolveConnectorsFilePath(): string {
  return join(resolveDataDir(), "connectors.json");
}

const CONNECTOR_ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export const isValidConnectorId = (id: string): boolean => CONNECTOR_ID_PATTERN.test(id);

export async function listConnectors(): Promise<ConnectorConfig[]> {
  const file = resolveConnectorsFilePath();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as {
      connectors?: ConnectorConfig[];
    };
    return Array.isArray(parsed.connectors) ? parsed.connectors : [];
  } catch (error) {
    console.error(`[Connectors] Failed to read ${file}:`, error);
    return [];
  }
}

export async function saveConnectors(connectors: ConnectorConfig[]): Promise<void> {
  resolveDataDir();
  const file = resolveConnectorsFilePath();
  const payload = JSON.stringify({ connectors }, null, 2);
  const tempFile = `${file}.tmp-${process.pid}`;
  await writeFile(tempFile, payload, "utf-8");
  await chmod(tempFile, 0o600).catch(() => undefined);
  await rename(tempFile, file);
}

export async function upsertConnector(connector: ConnectorConfig): Promise<ConnectorConfig[]> {
  const connectors = await listConnectors();
  const index = connectors.findIndex((entry) => entry.id === connector.id);
  const existing = index === -1 ? null : connectors[index];
  // Masked secret values round-tripped from the UI mean "keep what's stored".
  const merged: ConnectorConfig = {
    ...connector,
    env: mergeSecrets(connector.env, existing?.env),
    headers: mergeSecrets(connector.headers, existing?.headers),
  };
  if (index === -1) connectors.push(merged);
  else connectors[index] = merged;
  await saveConnectors(connectors);
  return connectors;
}

export async function removeConnector(id: string): Promise<ConnectorConfig[]> {
  const connectors = (await listConnectors()).filter((entry) => entry.id !== id);
  await saveConnectors(connectors);
  return connectors;
}

function mergeSecrets(
  incoming: Record<string, string> | undefined,
  stored: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!incoming) return incoming;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    result[key] = value === MASK && stored?.[key] ? stored[key] : value;
  }
  return result;
}

const maskRecord = (
  record: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (!record) return record;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      SECRET_KEY_PATTERN.test(key) && value ? MASK : value,
    ]),
  );
};

export function toConnectorView(connector: ConnectorConfig): ConnectorView {
  return {
    ...connector,
    env: maskRecord(connector.env),
    headers: maskRecord(connector.headers),
    secret_keys: [
      ...Object.keys(connector.env ?? {}),
      ...Object.keys(connector.headers ?? {}),
    ].filter((key) => SECRET_KEY_PATTERN.test(key)),
  };
}

export async function enabledConnectors(): Promise<ConnectorConfig[]> {
  return (await listConnectors()).filter((connector) => connector.enabled);
}

/** Sync check used during session assembly (which is a sync path). */
export function hasEnabledConnectorsSync(): boolean {
  const file = resolveConnectorsFilePath();
  if (!existsSync(file)) return false;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
      connectors?: ConnectorConfig[];
    };
    return Boolean(parsed.connectors?.some((connector) => connector.enabled));
  } catch {
    return false;
  }
}
