const REDACTED = "[redacted]";

const ENVIRONMENT_KEY = String.raw`[A-Za-z_][A-Za-z0-9_]*_(?:API_KEY|TOKEN)`;
const STRUCTURED_KEY = String.raw`(?:api_key|api-key|apikey|auth_token|access_token|token|secret|password|hf_token|openai_api_key|anthropic_api_key|${ENVIRONMENT_KEY})`;
const ESCAPED_KEY_END = String.raw`(?:\\*["'])?`;
const ASSIGNMENT = String.raw`(?:=>|[:=])`;

const SECRET_MARKER = new RegExp(
  [
    String.raw`(?<authorization>(?<![A-Za-z0-9_-])Authorization${ESCAPED_KEY_END}\s*${ASSIGNMENT}\s*)`,
    String.raw`(?<xApiKey>(?<![A-Za-z0-9_-])[Xx]-[Aa]pi-[Kk]ey${ESCAPED_KEY_END}\s*${ASSIGNMENT}\s*)`,
    String.raw`(?<environment>(?<![A-Za-z0-9_])${ENVIRONMENT_KEY}\s*=(?!>)\s*)`,
    String.raw`(?<structured>(?<![A-Za-z0-9_-])${STRUCTURED_KEY}${ESCAPED_KEY_END}\s*${ASSIGNMENT}\s*)`,
    String.raw`(?<cli>(?<![A-Za-z0-9_-])--(?:api-key|apikey|api_token|auth-token|access-token|hf-token|token|secret|password)(?:\s*=\s*|\s+|${ESCAPED_KEY_END}\s*,\s*))`,
    String.raw`(?<query>[?&](?:api_key|api-key|apikey|token|access_token|auth_token|key|secret|hf_token|openai_api_key|anthropic_api_key)=)`,
  ].join("|"),
  "gi",
);

const TOKEN_BOUNDARY = /[\s;,}\]]/;
const TOKEN_CONTINUATION_BOUNDARY = /[\s;,]/;
const QUERY_BOUNDARY = /[\s&#]/;
const AUTHORIZATION_BOUNDARY = /[\r\n}]/;
const STRUCTURAL_BOUNDARY = /[\r\n,;}\]]/;
const STRUCTURAL_CONTINUATION_BOUNDARY = /[\r\n,;]/;

type ValueKind = "authorization" | "query" | "structured" | "token";
type ValueRedaction = { end: number; replacement: string };

const closingBoundaryIsComplete = (line: string, start: number): boolean => {
  let cursor = start;
  while (line[cursor] === "]" || line[cursor] === "}") cursor += 1;
  return cursor >= line.length || /[\s,;]/.test(line[cursor] ?? "");
};

const scanToBoundary = (line: string, start: number, boundary: RegExp): number => {
  let cursor = start;
  while (cursor < line.length) {
    const value = line[cursor] ?? "";
    if (boundary.test(value)) {
      if ((value !== "]" && value !== "}") || closingBoundaryIsComplete(line, cursor)) {
        return cursor;
      }
    }
    cursor += 1;
  }
  return cursor;
};

const isBoundary = (line: string, start: number, kind: ValueKind): boolean => {
  if (start >= line.length) return true;
  if (kind === "token") return TOKEN_BOUNDARY.test(line[start] ?? "");
  if (kind === "query") return QUERY_BOUNDARY.test(line[start] ?? "");
  let cursor = start;
  while (line[cursor] === " " || line[cursor] === "\t") cursor += 1;
  if (cursor >= line.length) return true;
  const boundary = kind === "authorization" ? AUTHORIZATION_BOUNDARY : STRUCTURAL_BOUNDARY;
  return boundary.test(line[cursor] ?? "");
};

const redactedEnd = (line: string, start: number, kind: ValueKind): number | null => {
  if (!line.startsWith(REDACTED, start)) return null;
  const end = start + REDACTED.length;
  if (line[end] === '"' || line[end] === "'" || line[end] === "\\") return null;
  if (!isBoundary(line, end, kind)) return null;
  let boundaryAt = end;
  if (kind === "authorization" || kind === "structured") {
    while (line[boundaryAt] === " " || line[boundaryAt] === "\t") boundaryAt += 1;
  }
  if (line[boundaryAt] !== "]" && line[boundaryAt] !== "}") return end;
  return closingBoundaryIsComplete(line, boundaryAt) ? end : null;
};

const quotedRedaction = (line: string, start: number, kind: ValueKind): ValueRedaction | null => {
  let quoteAt = start;
  while (line[quoteAt] === "\\") quoteAt += 1;
  const quote = line[quoteAt];
  if (quote !== '"' && quote !== "'") return null;
  const openingEscapes = quoteAt - start;
  const delimiterPeriod = 2 * (openingEscapes + 1);
  let cursor = quoteAt + 1;
  let escapeRun = 0;
  while (cursor < line.length) {
    const value = line[cursor];
    if (value === "\r" || value === "\n") return { end: cursor, replacement: REDACTED };
    if (value === "\\") {
      escapeRun += 1;
      cursor += 1;
      continue;
    }
    if (
      value === quote &&
      escapeRun >= openingEscapes &&
      (escapeRun - openingEscapes) % delimiterPeriod === 0 &&
      isBoundary(line, cursor + 1, kind)
    ) {
      return {
        end: cursor + 1,
        replacement: `${line.slice(start, quoteAt + 1)}${REDACTED}${line.slice(cursor - openingEscapes, cursor + 1)}`,
      };
    }
    escapeRun = 0;
    cursor += 1;
  }
  return { end: line.length, replacement: REDACTED };
};

const unquotedEnd = (line: string, start: number, kind: ValueKind): number => {
  const boundary =
    kind === "token"
      ? TOKEN_BOUNDARY
      : kind === "query"
        ? QUERY_BOUNDARY
        : kind === "authorization"
          ? AUTHORIZATION_BOUNDARY
          : STRUCTURAL_BOUNDARY;
  return scanToBoundary(line, start, boundary);
};

const continuationEnd = (line: string, start: number, kind: ValueKind): number => {
  const boundary =
    kind === "token"
      ? TOKEN_CONTINUATION_BOUNDARY
      : kind === "query"
        ? QUERY_BOUNDARY
        : kind === "authorization"
          ? AUTHORIZATION_BOUNDARY
          : STRUCTURAL_CONTINUATION_BOUNDARY;
  return scanToBoundary(line, start, boundary);
};

const kindFor = (groups: Record<string, string>): ValueKind => {
  if (groups["authorization"]) return "authorization";
  if (groups["query"]) return "query";
  if (groups["structured"]) return "structured";
  return "token";
};

const valueRedaction = (
  line: string,
  start: number,
  groups: Record<string, string>,
): ValueRedaction => {
  const kind = kindFor(groups);
  const knownRedactedEnd = redactedEnd(line, start, kind);
  if (knownRedactedEnd !== null) return { end: knownRedactedEnd, replacement: REDACTED };
  const hasRedactedPrefix = line.startsWith(REDACTED, start);
  const scanFrom = hasRedactedPrefix ? start + REDACTED.length : start;
  const quoted = quotedRedaction(line, scanFrom, kind);
  if (quoted !== null) return quoted;
  return {
    end: hasRedactedPrefix
      ? continuationEnd(line, scanFrom, kind)
      : unquotedEnd(line, scanFrom, kind),
    replacement: REDACTED,
  };
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
    const redaction = valueRedaction(line, markerEnd, match.groups ?? {});
    output.push(line.slice(copiedThrough, markerEnd), redaction.replacement);
    copiedThrough = Math.max(markerEnd, redaction.end);
    SECRET_MARKER.lastIndex = copiedThrough;
    match = SECRET_MARKER.exec(line);
  }
  SECRET_MARKER.lastIndex = 0;
  if (copiedThrough === 0) return line;
  output.push(line.slice(copiedThrough));
  return output.join("");
}
