// Durable Google OAuth credentials for MCP servers that need Google OAuth
// material (e.g. workspace/Gmail MCP servers that read Google client,
// refresh-token, and access-token values from their process env).
//
// We store the user's OAuth client id/secret plus the long-lived refresh token
// under the data dir, then mint a fresh access token on demand. The OAuth env is
// injected into the MCP server's `.mcp.json` right before a turn starts.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDataDir } from "@/lib/data-dir";

export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
// Refresh a little before the real expiry so a turn never starts with a token
// that dies mid-flight.
const REFRESH_SKEW_MS = 120_000;

export type GoogleCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken: string;
  accessTokenExpiresAt: number;
  email: string;
  scopes: string[];
  updatedAt: string;
};

export type GoogleStatus = {
  hasCredentials: boolean;
  configuredByApp: boolean;
  connected: boolean;
  email: string;
  scopes: string[];
  accessTokenExpiresAt: number;
};

type GoogleClientCredentials = {
  clientId: string;
  clientSecret: string;
  configuredByApp: boolean;
};

function credentialsPath(): string {
  return path.join(resolveDataDir(), "oauth", "google.json");
}

async function readRaw(): Promise<Partial<GoogleCredentials>> {
  try {
    return JSON.parse(await readFile(credentialsPath(), "utf8")) as Partial<GoogleCredentials>;
  } catch {
    return {};
  }
}

function appGoogleClientCredentials(): GoogleClientCredentials | null {
  const clientId =
    process.env.VLLM_STUDIO_GOOGLE_OAUTH_CLIENT_ID?.trim() ||
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    "";
  const clientSecret =
    process.env.VLLM_STUDIO_GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim() ||
    "";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, configuredByApp: true };
}

async function readEffectiveClient(): Promise<GoogleClientCredentials | null> {
  const appClient = appGoogleClientCredentials();
  if (appClient) return appClient;
  const creds = await readRaw();
  if (!creds.clientId || !creds.clientSecret) return null;
  return { clientId: creds.clientId, clientSecret: creds.clientSecret, configuredByApp: false };
}

async function writeRaw(creds: Partial<GoogleCredentials>): Promise<void> {
  const filePath = credentialsPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = JSON.stringify({ ...creds, updatedAt: new Date().toISOString() }, null, 2);
  await writeFile(filePath, `${payload}\n`, "utf8");
  try {
    await chmod(filePath, 0o600);
  } catch {
    // best-effort on platforms without POSIX perms
  }
}

export async function getGoogleStatus(): Promise<GoogleStatus> {
  const creds = await readRaw();
  const appClient = appGoogleClientCredentials();
  const hasLocalCredentials = Boolean(creds.clientId && creds.clientSecret);
  return {
    hasCredentials: Boolean(appClient) || hasLocalCredentials,
    configuredByApp: Boolean(appClient),
    connected: Boolean(creds.refreshToken),
    email: creds.email ?? "",
    scopes: creds.scopes ?? [],
    accessTokenExpiresAt: creds.accessTokenExpiresAt ?? 0,
  };
}

export async function saveGoogleClient(clientId: string, clientSecret: string): Promise<void> {
  const existing = await readRaw();
  await writeRaw({ ...existing, clientId: clientId.trim(), clientSecret: clientSecret.trim() });
}

export async function disconnectGoogle(): Promise<void> {
  const existing = await readRaw();
  await writeRaw({
    clientId: existing.clientId ?? "",
    clientSecret: existing.clientSecret ?? "",
    refreshToken: "",
    accessToken: "",
    accessTokenExpiresAt: 0,
    email: "",
    scopes: [],
  });
}

export async function buildGoogleAuthUrl(redirectUri: string, state: string): Promise<string> {
  const client = await readEffectiveClient();
  if (!client) {
    throw new Error("Google OAuth is not configured for this app.");
  }
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

function decodeIdTokenEmail(idToken: string | undefined): string {
  if (!idToken) return "";
  const segment = idToken.split(".")[1];
  if (!segment) return "";
  try {
    const json = Buffer.from(segment, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { email?: string };
    return payload.email ?? "";
  } catch {
    return "";
  }
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await response.json()) as TokenResponse;
  if (!response.ok || data.error) {
    throw new Error(
      data.error_description || data.error || `Token request failed (${response.status}).`,
    );
  }
  return data;
}

export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<void> {
  const [creds, client] = await Promise.all([readRaw(), readEffectiveClient()]);
  if (!client) {
    throw new Error("Missing Google OAuth client credentials.");
  }
  const data = await postToken(
    new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  );
  if (!data.refresh_token) {
    throw new Error("Google did not return a refresh token. Revoke prior access and try again.");
  }
  await writeRaw({
    ...creds,
    refreshToken: data.refresh_token,
    accessToken: data.access_token ?? "",
    accessTokenExpiresAt: Date.now() + (data.expires_in ?? 0) * 1000,
    email: decodeIdTokenEmail(data.id_token),
    scopes: data.scope ? data.scope.split(" ") : GOOGLE_OAUTH_SCOPES,
  });
}

export async function getFreshGoogleCredentials(): Promise<{
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
} | null> {
  const [creds, client] = await Promise.all([readRaw(), readEffectiveClient()]);
  if (!creds.refreshToken || !client) return null;

  const expiresAt = creds.accessTokenExpiresAt ?? 0;
  if (creds.accessToken && Date.now() < expiresAt - REFRESH_SKEW_MS) {
    return {
      clientId: client.clientId,
      clientSecret: client.clientSecret,
      refreshToken: creds.refreshToken,
      accessToken: creds.accessToken,
      expiresAt,
    };
  }

  const data = await postToken(
    new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: "refresh_token",
    }),
  );
  const accessToken = data.access_token ?? "";
  const nextExpiresAt = Date.now() + (data.expires_in ?? 0) * 1000;
  await writeRaw({
    ...creds,
    accessToken,
    accessTokenExpiresAt: nextExpiresAt,
  });
  return {
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    refreshToken: creds.refreshToken,
    accessToken,
    expiresAt: nextExpiresAt,
  };
}
