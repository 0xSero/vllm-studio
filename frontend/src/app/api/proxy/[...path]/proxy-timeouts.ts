const DEFAULT_UPSTREAM_TIMEOUT_MS = 5_000;
const DOWNLOAD_UPSTREAM_TIMEOUT_MS = 120_000;
const SYSTEM_UPSTREAM_TIMEOUT_MS = 20_000;
const CHAT_COMPLETION_UPSTREAM_TIMEOUT_MS = 600_000;
const SSE_CONNECT_TIMEOUT_MS = 5_000;

export function getUpstreamTimeoutMs(path: string[], method = "GET"): number {
  const route = path.join("/");
  if (method === "POST" && route === "studio/downloads") {
    return DOWNLOAD_UPSTREAM_TIMEOUT_MS;
  }
  // SSE streams: this only bounds the initial connect (until headers arrive),
  // after which the stream runs unbounded. A longer window avoids EventSource
  // reconnect storms when the backend is briefly slow to respond.
  if (route === "events" || route.endsWith("/stream")) {
    return SSE_CONNECT_TIMEOUT_MS;
  }
  if (route === "v1/chat/completions" || route === "v1/responses") {
    return CHAT_COMPLETION_UPSTREAM_TIMEOUT_MS;
  }
  if (route === "compat") {
    return DEFAULT_UPSTREAM_TIMEOUT_MS;
  }
  if (route === "config" || route === "evict") {
    return SYSTEM_UPSTREAM_TIMEOUT_MS;
  }
  if (route === "logs" || route.startsWith("logs/")) {
    return DEFAULT_UPSTREAM_TIMEOUT_MS;
  }
  if (route === "v1/metrics/vllm") {
    return DEFAULT_UPSTREAM_TIMEOUT_MS;
  }
  if (route.startsWith("runtime/")) {
    return SYSTEM_UPSTREAM_TIMEOUT_MS;
  }
  return DEFAULT_UPSTREAM_TIMEOUT_MS;
}
