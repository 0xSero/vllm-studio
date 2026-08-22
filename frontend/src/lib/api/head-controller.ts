import { createApiClient } from "./create-api-client";
import { getControllerApiKey, normalizeControllerUrl } from "./controllers";
import { Schema } from "effect";

export const HEAD_CONNECTION_STORAGE_KEY = "local-studio.head-controller";
export const HEAD_CONNECTION_CHANGED_EVENT = "local-studio:head-controller-changed";

export interface HeadConnection {
  name: string;
  url: string;
}

const HeadConnectionSchema = Schema.Struct({ name: Schema.String, url: Schema.String });

const parseHeadConnection = (value: unknown): HeadConnection | null => {
  try {
    const decoded = Schema.decodeUnknownSync(HeadConnectionSchema)(value);
    const url = normalizeControllerUrl(decoded.url);
    return url ? { name: decoded.name.trim() || "Studio Head", url } : null;
  } catch {
    return null;
  }
};

export const getHeadConnection = (): HeadConnection | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(HEAD_CONNECTION_STORAGE_KEY);
    return raw ? parseHeadConnection(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

export const setHeadConnection = (connection: HeadConnection): HeadConnection => {
  const next = parseHeadConnection(connection);
  if (!next) throw new Error("The Head controller URL is invalid");
  window.localStorage.setItem(HEAD_CONNECTION_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(HEAD_CONNECTION_CHANGED_EVENT, { detail: next }));
  window.dispatchEvent(new Event("storage"));
  return next;
};

export const clearHeadConnection = (): void => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(HEAD_CONNECTION_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(HEAD_CONNECTION_CHANGED_EVENT, { detail: null }));
  window.dispatchEvent(new Event("storage"));
};

export const createHeadApiClient = (connection = getHeadConnection()) => {
  if (!connection) throw new Error("Connect a Studio Head first");
  return createApiClient({
    baseUrl: "/api/proxy",
    useProxy: true,
    backendUrlOverride: connection.url,
    apiKeyOverride: getControllerApiKey(connection.url),
  });
};

export const headProxyHeaders = (connection = getHeadConnection()): Record<string, string> => {
  if (!connection) throw new Error("Connect a Studio Head first");
  const headers: Record<string, string> = {
    "X-Backend-Url": connection.url,
    "X-Backend-Strict": "1",
  };
  const apiKey = getControllerApiKey(connection.url);
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  else headers["X-Backend-Suppress-Auth"] = "1";
  return headers;
};
