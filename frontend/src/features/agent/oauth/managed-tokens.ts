// Injects freshly minted OAuth credentials into the materialized `.mcp.json` of
// MCP servers that need them, right before a turn starts the runtime.
//
// Some MCP servers only read OAuth values from their env at spawn time, so we
// rewrite those env values and return a fingerprint that changes whenever a
// token is refreshed. Including that fingerprint in the runtime start options
// forces a runtime restart (and thus an MCP server respawn) once the previous
// token has actually expired, while leaving the runtime untouched within a
// token's validity window.
//
// This is provider-agnostic: every provider in the OAuth registry is applied to
// any enabled server whose env declares that provider's managed env keys.

import { readFile, writeFile } from "node:fs/promises";
import { listStoredServers, serverConfigPath } from "@/features/agent/mcp/store";
import { OAUTH_PROVIDERS, providerForEnvKeys, type OAuthProvider } from "./oauth-providers";
import { getFreshOAuthCredentials, type FreshOAuthCredentials } from "./oauth-store";

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

function envForProvider(
  provider: OAuthProvider,
  fresh: FreshOAuthCredentials,
): Record<string, string> {
  const { accessToken, clientId, clientSecret, refreshToken } = provider.envMapping;
  const env: Record<string, string> = { [accessToken]: fresh.accessToken };
  if (clientId) env[clientId] = fresh.clientId;
  if (clientSecret) env[clientSecret] = fresh.clientSecret;
  if (refreshToken) env[refreshToken] = fresh.refreshToken;
  return env;
}

/**
 * Refresh and inject managed OAuth tokens for enabled servers across every
 * connected provider. Returns a fingerprint string that changes only when a
 * token is refreshed, so callers can fold it into the runtime fingerprint.
 * Returns "" when nothing is managed/connected.
 */
export async function applyManagedOauthTokens(): Promise<string> {
  const enabledServers = listStoredServers().filter((entry) => entry.enabled);
  if (enabledServers.length === 0) return "";

  const fingerprints: string[] = [];

  for (const provider of OAUTH_PROVIDERS) {
    const servers = enabledServers.filter(
      (entry) => providerForEnvKeys(entry.def.env)?.id === provider.id,
    );
    if (servers.length === 0) continue;

    let fresh: FreshOAuthCredentials | null;
    try {
      fresh = await getFreshOAuthCredentials(provider.id);
    } catch {
      continue;
    }
    if (!fresh || !fresh.accessToken) continue;

    const env = envForProvider(provider, fresh);
    for (const entry of servers) {
      await patchServerToken(entry.def.id, entry.def.name, env);
    }
    fingerprints.push(`${provider.id}:${fresh.expiresAt}`);
  }

  return fingerprints.join("|");
}
