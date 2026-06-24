/**
 * Conservative log-line redaction for API/SSE responses.
 *
 * Preserves raw log files on disk; only use this when serializing lines to
 * HTTP/SSE clients. The regexes are intentionally anchored to known secret
 * markers so ordinary error messages, file paths, ports, and throughput metrics
 * are not eaten.
 */

const REDACTED = "[redacted]";

/**
 * Token-like value that stops at common separators/punctuation so surrounding
 * log context (semicolons, commas, quotes) is preserved.
 */
const TOKEN = String.raw`[^\s;,"']+`;

/**
 * Redact common secret-bearing patterns from a single log line.
 *
 * Covered:
 * - Authorization: Bearer <token>
 * - X-Api-Key: <token>
 * - Env assignments: HF_TOKEN=..., OPENAI_API_KEY=..., *_API_KEY=..., *_TOKEN=...
 * - JSON-ish pairs: "api_key": "...", 'token': '...'
 * - CLI flags: --api-key <value>, --hf-token <value>, --token <value>, etc.
 * - URL query params: ?api_key=...&token=...
 */
export function redactLogLine(line: string): string {
  let redacted = line;

  // Authorization / Bearer headers.
  redacted = redacted.replace(
    new RegExp(String.raw`(Authorization:\s*Bearer\s+)` + TOKEN, "gi"),
    `$1${REDACTED}`
  );

  // X-Api-Key style headers.
  redacted = redacted.replace(
    new RegExp(String.raw`((?:^|[\r\n])[Xx]-[Aa]pi-[Kk]ey:\s+)` + TOKEN, "g"),
    `$1${REDACTED}`
  );

  // Env-style assignments: KEY=VALUE or export KEY=VALUE.
  // Covers explicit keys plus generic *_API_KEY / *_TOKEN patterns.
  redacted = redacted.replace(
    new RegExp(
      String.raw`((?:^|[\s;{"'|&]|export\s+)(?:HF_TOKEN|HUGGING_FACE_HUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|[A-Za-z_][A-Za-z0-9_]*_API_KEY|[A-Za-z_][A-Za-z0-9_]*_TOKEN)\s*=\s*)(?:"[^"]*"|'[^']*'|` + TOKEN + ")",
      "g"
    ),
    `$1${REDACTED}`
  );

  // JSON-ish key/value pairs: "api_key": "...", 'token': '...'.
  // Preserves the quote style of the value.
  redacted = redacted.replace(
    /(["']?(?:api_key|api-key|apikey|auth_token|access_token|token|secret|password|hf_token|openai_api_key|anthropic_api_key)["']?\s*:\s*)(["'])[^"']*\2/gi,
    `$1$2${REDACTED}$2`
  );

  // CLI long flags: --api-key <value>, --hf-token <value>, etc.
  redacted = redacted.replace(
    new RegExp(String.raw`(\s)(--(?:api-key|apikey|api_token|auth-token|access-token|hf-token|token|secret|password))\s+` + TOKEN, "gi"),
    `$1$2 ${REDACTED}`
  );

  // URL query parameters: api_key=..., token=..., etc.
  redacted = redacted.replace(
    /([?&])(api_key|api-key|apikey|token|access_token|auth_token|key|secret|hf_token|openai_api_key|anthropic_api_key)=([^&\s]*)/gi,
    `$1$2=${REDACTED}`
  );

  return redacted;
}

/**
 * Redact a multi-line log string, preserving line endings.
 */
export function redactLogContent(content: string): string {
  return content
    .split(/(\r?\n)/)
    .map((part, index) => (index % 2 === 0 ? redactLogLine(part) : part))
    .join("");
}
