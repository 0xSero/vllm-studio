// Injects freshly minted OAuth credentials into the materialized `.mcp.json` of
// MCP servers that need them, right before a turn starts the runtime.
//
// Some Google MCP servers only read OAuth values from their env at spawn time,
// so we rewrite those env values and return a fingerprint that changes whenever
// the access token is refreshed. Including that fingerprint in the runtime start
// options forces a runtime restart (and thus an MCP server respawn) once the
// previous token has actually expired, while leaving the runtime untouched
// within a token's validity window.

import { readFile, writeFile } from "node:fs/promises";
import { listStoredServers, serverConfigPath } from "@/features/agent/mcp/store";
import { getFreshGoogleCredentials } from "./google-store";

const GOOGLE_ENV_KEY = "GOOGLE_ACCESS_TOKEN";
const GOOGLE_CLIENT_ID_ENV_KEY = "GOOGLE_CLIENT_ID";
const GOOGLE_CLIENT_SECRET_ENV_KEY = "GOOGLE_CLIENT_SECRET";
const GOOGLE_REFRESH_TOKEN_ENV_KEY = "GOOGLE_REFRESH_TOKEN";
const MANAGED_GOOGLE_ENV_KEYS = new Set([
  GOOGLE_CLIENT_ID_ENV_KEY,
  GOOGLE_CLIENT_SECRET_ENV_KEY,
  GOOGLE_REFRESH_TOKEN_ENV_KEY,
  GOOGLE_ENV_KEY,
]);

type McpConfigFile = {
  mcpServers?: Record<string, { env?: Record<string, string> }>;
};

async function patchServerToken(
  id: string,
  serverName: string,
  env: Record<string, string>,
): Promise<void> {
  const configPath = serverConfigPath(id);
  let parsed: McpConfigFile;
  try {
    parsed = JSON.parse(await readFile(configPath, "utf8")) as McpConfigFile;
  } catch {
    return;
  }
  const server = parsed.mcpServers?.[serverName];
  if (!server) return;
  server.env = { ...server.env, ...env };
  await writeFile(configPath, JSON.stringify(parsed, null, 2), "utf8");
}

function hasManagedGoogleEnv(env: Record<string, string> | undefined): boolean {
  return Object.keys(env ?? {}).some((key) => MANAGED_GOOGLE_ENV_KEYS.has(key));
}

/**
 * Refresh and inject managed OAuth tokens for enabled servers. Returns a
 * fingerprint string that changes only when a token is refreshed, so callers
 * can fold it into the runtime fingerprint. Returns "" when nothing is managed.
 */
export async function applyManagedOauthTokens(): Promise<string> {
  const googleServers = listStoredServers().filter(
    (entry) => entry.enabled && hasManagedGoogleEnv(entry.def.env),
  );
  if (googleServers.length === 0) return "";

  let fresh: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    accessToken: string;
    expiresAt: number;
  } | null;
  try {
    fresh = await getFreshGoogleCredentials();
  } catch {
    return "";
  }
  if (!fresh || !fresh.accessToken) return "";

  const env = {
    [GOOGLE_CLIENT_ID_ENV_KEY]: fresh.clientId,
    [GOOGLE_CLIENT_SECRET_ENV_KEY]: fresh.clientSecret,
    [GOOGLE_REFRESH_TOKEN_ENV_KEY]: fresh.refreshToken,
    [GOOGLE_ENV_KEY]: fresh.accessToken,
  };

  for (const entry of googleServers) {
    await patchServerToken(entry.def.id, entry.def.name, env);
  }
  return `google:${fresh.expiresAt}`;
}
