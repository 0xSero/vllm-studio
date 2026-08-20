/**
 * Launch configurations Local Studio already knows how to write.
 *
 * This is a starting point for the editor, not a store and not a marketplace.
 * Picking an entry fills the same form a hand-written connector uses, with the
 * same command preview and the same "nothing runs until you enable it" rule —
 * there is no install step, nothing is fetched from a URL, and no third party
 * decides what lands in the list. Growing the list is a code change, which is
 * the point: every entry here is a command someone reviewed.
 *
 * The `{{SSH_REMOTE_SERVER}}` placeholder is the one exception to "these args
 * are literal": it is resolved against the MCP server bundled inside this app,
 * because the absolute path differs between a dev checkout and a signed build.
 */
export const SSH_SERVER_PLACEHOLDER = "{{SSH_REMOTE_SERVER}}";

export interface CatalogEntry {
  id: string;
  name: string;
  company: string;
  description: string;
  transport: "stdio";
  command: string;
  args: string[];
  envFields: Array<{ key: string; label: string; placeholder?: string }>;
}

export const CONNECTOR_CATALOG: CatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    company: "GitHub",
    description: "Repos, issues, pull requests, and code search.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    envFields: [{ key: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "Personal access token" }],
  },
  {
    id: "x",
    name: "X / Twitter",
    company: "X",
    description: "Read and post with X API credentials.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@enescinar/twitter-mcp"],
    envFields: [
      { key: "API_KEY", label: "X API key" },
      { key: "API_SECRET_KEY", label: "X API secret" },
      { key: "ACCESS_TOKEN", label: "Access token" },
      { key: "ACCESS_TOKEN_SECRET", label: "Access token secret" },
    ],
  },
  {
    id: "computer",
    name: "Remote computer",
    company: "Local Studio",
    description: "Run commands and work with files over SSH on another machine.",
    transport: "stdio",
    command: "node",
    args: [SSH_SERVER_PLACEHOLDER],
    envFields: [{ key: "SSH_HOST", label: "SSH host", placeholder: "user@machine" }],
  },
];

/**
 * How a shell would read the argv this connector spawns.
 *
 * Rendered for the user rather than executed — the runtime passes argv to the
 * child process directly and never through a shell — so the quoting here is
 * about making a stray space visible, not about escaping for safety.
 */
export function renderCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args]
    .filter((part) => part.length > 0)
    .map((part) => (/[\s"'\\$`]/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}
