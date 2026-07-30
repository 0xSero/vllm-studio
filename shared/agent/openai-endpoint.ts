export type OpenAIOperation =
  | "models"
  | "chat/completions"
  | "responses"
  | "embeddings"
  | "audio/transcriptions";

export type ProviderPathStyle = "openai" | "azure";

export const normalizeOpenAIBaseUrl = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/u, "");
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("OpenAI-compatible endpoint must use HTTP or HTTPS");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError("OpenAI-compatible endpoint must not contain credentials, query, or hash");
  }
  const pathname = parsed.pathname.replace(/\/+$/u, "").replace(/(?:\/v1){2,}$/u, "/v1");
  parsed.pathname = pathname.endsWith("/v1") ? pathname : `${pathname}/v1`;
  return parsed.toString().replace(/\/+$/u, "");
};

export const openAIEndpoint = (baseUrl: string, operation: OpenAIOperation): string =>
  `${normalizeOpenAIBaseUrl(baseUrl)}/${operation}`;

export const providerChatEndpoint = (
  baseUrl: string,
  modelId: string,
  pathStyle: ProviderPathStyle | undefined,
  apiVersion: string | undefined,
): string => {
  if (pathStyle !== "azure") return openAIEndpoint(baseUrl, "chat/completions");
  const trimmed = normalizeOpenAIBaseUrl(baseUrl).replace(/\/v1$/u, "");
  const version = apiVersion?.trim() || "2024-10-21";
  return `${trimmed}/deployments/${encodeURIComponent(modelId)}/chat/completions?api-version=${encodeURIComponent(version)}`;
};

export const providerModelsEndpoint = (
  baseUrl: string,
  pathStyle: ProviderPathStyle | undefined,
  apiVersion: string | undefined,
): string => {
  if (pathStyle !== "azure") return openAIEndpoint(baseUrl, "models");
  const trimmed = normalizeOpenAIBaseUrl(baseUrl).replace(/\/v1$/u, "");
  const version = apiVersion?.trim() || "2024-10-21";
  return `${trimmed}/deployments?api-version=${encodeURIComponent(version)}`;
};
