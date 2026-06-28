import { isManagedOAuthEnvKey, providerForEnvKeys } from "@/features/agent/oauth/oauth-providers";
import type { CatalogueEntry, McpServer } from "./plugins-types";

export { isManagedOAuthEnvKey };

/** The OAuth provider id a catalogue entry connects through, if any. */
export function oauthProviderIdForEntry(entry: CatalogueEntry): string | null {
  return entry.oauthProvider ?? providerForEnvKeys(entry.env)?.id ?? null;
}

/** Whether a catalogue entry is connected via a managed OAuth provider. */
export function isManagedOAuthEntry(entry: CatalogueEntry): boolean {
  return oauthProviderIdForEntry(entry) !== null;
}

export function serverDescription(server: McpServer): string {
  const summary = server.description?.replace(/\s+/g, " ").trim();
  const short = summary && summary.length > 160 ? `${summary.slice(0, 157)}...` : summary;
  return short || "MCP stdio server";
}

export function serverLocation(server: McpServer, ready = server.ready): string {
  const state = !server.enabled
    ? "disabled"
    : ready
      ? "connected"
      : server.oauthProvider
        ? "needs account"
        : "not ready";
  const tags = server.tags?.length ? ` · ${server.tags.join(", ")}` : "";
  return `${state} · @${server.name}${tags}`;
}

export function parseArgsText(text: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  for (const char of text) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (escaping) current += "\\";
  if (current) args.push(current);
  return args;
}

export function quoteArgsText(args: string[]): string {
  return args.map(quoteArg).join(" ");
}

function quoteArg(arg: string): string {
  if (!arg) return '""';
  if (!/[\s"'\\]/.test(arg)) return arg;
  return `"${arg.replace(/(["\\])/g, "\\$1")}"`;
}

export function parseTagsText(text: string): string[] {
  return text
    .split(/[, ]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseEnvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function missingRequiredEnv(entry: CatalogueEntry, env: Record<string, string>): boolean {
  return (entry.requiredEnv ?? []).some((key) => !env[key]?.trim());
}
