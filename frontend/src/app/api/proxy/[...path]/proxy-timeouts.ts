const DEFAULT_UPSTREAM_TIMEOUT_MS = 5_000;
const DOWNLOAD_UPSTREAM_TIMEOUT_MS = 120_000;
const SYSTEM_UPSTREAM_TIMEOUT_MS = 20_000;
const CHAT_COMPLETION_UPSTREAM_TIMEOUT_MS = 600_000;

export function getUpstreamTimeoutMs(path: string[]): number {
  const route = path.join("/");
  if (route === "studio/downloads" || route.startsWith("studio/downloads/")) {
    return DOWNLOAD_UPSTREAM_TIMEOUT_MS;
  }
  if (route === "v1/chat/completions" || route === "v1/responses") {
    return CHAT_COMPLETION_UPSTREAM_TIMEOUT_MS;
  }
  if (route === "config" || route === "compat" || route === "evict") {
    return SYSTEM_UPSTREAM_TIMEOUT_MS;
  }
  if (route === "logs" || route.startsWith("logs/")) {
    return SYSTEM_UPSTREAM_TIMEOUT_MS;
  }
  if (route === "v1/metrics/vllm") {
    return SYSTEM_UPSTREAM_TIMEOUT_MS;
  }
  if (route.startsWith("runtime/")) {
    return SYSTEM_UPSTREAM_TIMEOUT_MS;
  }
  return DEFAULT_UPSTREAM_TIMEOUT_MS;
}
