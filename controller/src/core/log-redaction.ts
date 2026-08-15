const REDACTED = "[redacted]";

const SECRET_MARKER = new RegExp(
  [
    String.raw`(?<authorization>(?<![A-Za-z0-9_-])Authorization(?:\\*["'])?\s*[:=]\s*)`,
    String.raw`(?<xApiKey>(?<![A-Za-z0-9_-])[Xx]-[Aa]pi-[Kk]ey(?:\\*["'])?\s*[:=]\s*)`,
    String.raw`(?<environment>(?<![A-Za-z0-9_])(?:HF_TOKEN|HUGGING_FACE_HUB_TOKEN|OPENAI_API_KEY|ANTHROPIC_API_KEY|[A-Za-z_][A-Za-z0-9_]*_API_KEY|[A-Za-z_][A-Za-z0-9_]*_TOKEN)\s*=\s*)`,
    String.raw`(?<structured>(?<![A-Za-z0-9_-])(?:api_key|api-key|apikey|auth_token|access_token|token|secret|password|hf_token|openai_api_key|anthropic_api_key)(?:\\*["'])?\s*:\s*)`,
    String.raw`(?<cli>(?<![A-Za-z0-9_-])--(?:api-key|apikey|api_token|auth-token|access-token|hf-token|token|secret|password)(?:\s*=\s*|\s+|["']?\s*,\s*["']?))`,
    String.raw`(?<query>[?&](?:api_key|api-key|apikey|token|access_token|auth_token|key|secret|hf_token|openai_api_key|anthropic_api_key)=)`,
  ].join("|"),
  "gi",
);

const TOKEN_BOUNDARY = /[\s;,}"'\]]/;

const redactedEnd = (line: string, start: number): number | null =>
  line.startsWith(REDACTED, start) ? start + REDACTED.length : null;

const directQuotedEnd = (line: string, start: number, quote: string): number => {
  let cursor = start + 1;
  while (cursor < line.length) {
    const value = line[cursor];
    if (value === "\r" || value === "\n") return cursor;
    if (value === "\\") {
      cursor += 2;
      continue;
    }
    cursor += 1;
    if (value === quote) return cursor;
  }
  return line.length;
};

const escapedQuotedEnd = (line: string, quoteAt: number, quote: string): number => {
  let cursor = quoteAt + 1;
  let backslashes = 0;
  while (cursor < line.length) {
    const value = line[cursor];
    if (value === "\r" || value === "\n") return cursor;
    if (value === "\\") {
      backslashes += 1;
      cursor += 1;
      continue;
    }
    if (value === quote && backslashes > 0) {
      let following = cursor + 1;
      while (line[following] === " " || line[following] === "\t") following += 1;
      const boundary = line[following];
      if (
        boundary === undefined ||
        boundary === "\r" ||
        boundary === "\n" ||
        boundary === "," ||
        boundary === "}" ||
        boundary === "]"
      ) {
        return cursor + 1;
      }
    }
    backslashes = 0;
    cursor += 1;
  }
  return line.length;
};

const quotedEnd = (line: string, start: number): number | null => {
  let quoteAt = start;
  while (line[quoteAt] === "\\") quoteAt += 1;
  const quote = line[quoteAt];
  if (quote !== '"' && quote !== "'") return null;
  return quoteAt === start
    ? directQuotedEnd(line, start, quote)
    : escapedQuotedEnd(line, quoteAt, quote);
};

const tokenEnd = (line: string, start: number): number => {
  const knownRedactedEnd = redactedEnd(line, start);
  if (knownRedactedEnd !== null) return knownRedactedEnd;
  const knownQuotedEnd = quotedEnd(line, start);
  if (knownQuotedEnd !== null) return knownQuotedEnd;
  let cursor = start;
  while (cursor < line.length && !TOKEN_BOUNDARY.test(line[cursor] ?? "")) cursor += 1;
  return cursor;
};

const authorizationEnd = (line: string, start: number): number => {
  const knownRedactedEnd = redactedEnd(line, start);
  if (knownRedactedEnd !== null) return knownRedactedEnd;
  const knownQuotedEnd = quotedEnd(line, start);
  if (knownQuotedEnd !== null) return knownQuotedEnd;
  let cursor = start;
  while (
    cursor < line.length &&
    line[cursor] !== "\r" &&
    line[cursor] !== "\n" &&
    line[cursor] !== "}"
  ) {
    cursor += 1;
  }
  return cursor;
};

const queryEnd = (line: string, start: number): number => {
  const knownRedactedEnd = redactedEnd(line, start);
  if (knownRedactedEnd !== null) return knownRedactedEnd;
  let cursor = start;
  while (cursor < line.length && line[cursor] !== "&" && !/\s/.test(line[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
};

const valueEnd = (line: string, start: number, groups: Record<string, string>): number => {
  if (groups["authorization"]) return authorizationEnd(line, start);
  if (groups["query"]) return queryEnd(line, start);
  return tokenEnd(line, start);
};

export function redactLogLine(line: string): string {
  const output: string[] = [];
  let copiedThrough = 0;
  SECRET_MARKER.lastIndex = 0;
  let match = SECRET_MARKER.exec(line);
  while (match !== null) {
    const matchAt = match.index;
    if (matchAt < copiedThrough) {
      SECRET_MARKER.lastIndex = copiedThrough;
      match = SECRET_MARKER.exec(line);
      continue;
    }
    const markerEnd = matchAt + match[0].length;
    output.push(line.slice(copiedThrough, markerEnd), REDACTED);
    copiedThrough = Math.max(markerEnd, valueEnd(line, markerEnd, match.groups ?? {}));
    SECRET_MARKER.lastIndex = copiedThrough;
    match = SECRET_MARKER.exec(line);
  }
  SECRET_MARKER.lastIndex = 0;
  if (copiedThrough === 0) return line;
  output.push(line.slice(copiedThrough));
  return output.join("");
}
