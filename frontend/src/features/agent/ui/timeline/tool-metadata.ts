import type { ToolBlock } from "@/features/agent/messages";
import type { PreviewHeight } from "@/ui/preview-scroll";

export const FILE_WRITE_TOOL_NAMES = new Set([
  "write_file",
  "write",
  "create_file",
  "createfile",
  "create file",
  "create",
  "edit_file",
  "editfile",
  "edit file",
  "edit",
  "apply_patch",
  "apply_edit",
  "replace_file",
  "str_replace_editor",
  // Writing a note is writing a file. Named exactly rather than by adding
  // "create"/"append" to the needle list below, which would sweep up every
  // unrelated tool whose verb happens to be one of those.
  "obsidian_create",
  "obsidian_append",
]);

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  md: "markdown",
  html: "xml",
  htm: "xml",
  css: "css",
  scss: "scss",
  py: "python",
  rs: "rust",
  go: "go",
  sh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  sql: "sql",
};

export function detectLang(filePath: string | null | undefined): string {
  if (!filePath) return "";
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return "";
  const ext = filePath.slice(dot + 1).toLowerCase();
  return LANG_BY_EXT[ext] ?? "";
}

// Try to extract a streaming-friendly preview of "what file is being written"
// from the partially-parsed tool args. We accept partial JSON: greedy extract
// the value of the most likely "content" / "text" / "patch" key.
export function extractPartialField(argsText: string, keys: string[]): string | null {
  if (!argsText) return null;
  for (const key of keys) {
    const needle = `"${key}"`;
    const idx = argsText.indexOf(needle);
    if (idx === -1) continue;
    // Find the colon and the opening quote of the value.
    const colon = argsText.indexOf(":", idx + needle.length);
    if (colon === -1) continue;
    let i = colon + 1;
    while (i < argsText.length && /\s/.test(argsText[i])) i += 1;
    if (argsText[i] !== '"') continue;
    let j = i + 1;
    let out = "";
    while (j < argsText.length) {
      const ch = argsText[j];
      if (ch === "\\") {
        const next = argsText[j + 1];
        if (next === "n") out += "\n";
        else if (next === "t") out += "\t";
        else if (next === "r") out += "\r";
        else if (next === '"') out += '"';
        else if (next === "\\") out += "\\";
        else if (next === undefined) break;
        else out += next;
        j += 2;
        continue;
      }
      if (ch === '"') return out;
      out += ch;
      j += 1;
    }
    // Unterminated string — return what we have so far for live streaming.
    return out;
  }
  return null;
}

export function extractFromArgs(
  args: Record<string, unknown> | undefined,
  argsText: string | undefined,
  keys: string[],
): string | null {
  if (args) {
    for (const key of keys) {
      const value = args[key];
      if (typeof value === "string") return value;
    }
  }
  if (argsText) return extractPartialField(argsText, keys);
  return null;
}

export function compactToolText(value: string | null | undefined, limit = 88): string | null {
  if (!value) return null;
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  if (oneLine.length <= limit) return oneLine;
  return `${oneLine.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function fileBasename(path: string | null | undefined): string | null {
  if (!path) return null;
  const clean = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const slash = clean.lastIndexOf("/");
  return clean.slice(slash + 1) || clean;
}

export function humanizeToolName(name: string): string {
  return name
    .replace(/^functions[._-]/, "")
    .replace(/^mcp__[a-z0-9_-]+__/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function hasAnyNeedle(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

export function toolArg(
  block: ToolBlock,
  keys: string[],
  fallback?: string | null | undefined,
): string | null {
  return extractFromArgs(block.args, block.argsText, keys) ?? fallback ?? null;
}

export type ToolKind =
  | "edit"
  | "search"
  | "read"
  | "exec"
  | "browser"
  | "mcp"
  | "setup"
  | "generic";

export type ToolPreviewHeightOverrides = Partial<Record<ToolKind, PreviewHeight>>;

export const TOOL_PREVIEW_HEIGHT_OPTIONS: Array<{ id: PreviewHeight; label: string }> = [
  { id: "sm", label: "Small" },
  { id: "md", label: "Medium" },
  { id: "lg", label: "Large" },
];

export const TOOL_PREVIEW_KIND_LABELS: Record<ToolKind, string> = {
  edit: "Edits",
  search: "Searches",
  read: "Reads",
  exec: "Commands",
  browser: "Browser",
  mcp: "MCP calls",
  setup: "Setup",
  generic: "Other tools",
};

export function toolPreviewHeightFor(
  kind: ToolKind,
  defaultHeight: PreviewHeight,
  overrides: ToolPreviewHeightOverrides,
): PreviewHeight {
  return overrides[kind] ?? defaultHeight;
}

export function classifyTool(block: ToolBlock): ToolKind {
  const name = block.name.toLowerCase();
  if (name.startsWith("local_studio_")) return "setup";
  if (
    name.startsWith("mcp__") ||
    /^(github|figma|slack|linear|notion|obsidian|context7)[._]/.test(name)
  ) {
    return "mcp";
  }
  if (hasAnyNeedle(name, ["browser", "chrome", "web", "open_url", "navigate"])) {
    return "browser";
  }
  if (extractFromArgs(block.args, block.argsText, ["cmd", "command", "script", "shell"])) {
    return "exec";
  }
  if (FILE_WRITE_TOOL_NAMES.has(name) || hasAnyNeedle(name, ["edit", "write", "patch"])) {
    return "edit";
  }
  if (hasAnyNeedle(name, ["search", "grep", "find", "ripgrep", "rg"])) return "search";
  if (hasAnyNeedle(name, ["read", "open", "cat", "view", "list"])) return "read";
  if (hasAnyNeedle(name, ["exec", "command", "shell", "bash", "run", "terminal"])) return "exec";
  return "generic";
}

export function toolVerb(block: ToolBlock): string {
  const running = block.status === "running";
  const name = block.name.toLowerCase();
  if (name === "local_studio_prepare_checkout") {
    return running ? "Preparing checkout" : "Prepared checkout";
  }
  if (name === "local_studio_start_sandbox") {
    return running ? "Starting sandbox" : "Started sandbox";
  }
  if (name === "local_studio_clone_repository") {
    return running ? "Cloning repository" : "Cloned repository";
  }
  switch (classifyTool(block)) {
    case "edit":
      if (hasAnyNeedle(name, ["create", "write"])) return running ? "Creating" : "Created";
      return running ? "Editing" : "Edited";
    case "read":
      if (hasAnyNeedle(name, ["list"])) return running ? "Listing" : "Listed";
      return running ? "Reading" : "Read";
    case "search":
      return running ? "Searching" : "Searched";
    case "exec":
      return running ? "Running" : "Ran";
    case "browser":
      return running ? "Browsing" : "Browsed";
    default:
      return running ? "Calling" : "Called";
  }
}
