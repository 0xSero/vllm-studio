import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { PreviewScroll } from "@/ui";
import { PREVIEW_HEIGHT_PX, type PreviewHeight } from "@/ui/preview-scroll";
import {
  FilePenLine,
  FileText,
  Globe2,
  Plug,
  Rocket,
  Search,
  TerminalSquare,
  Wrench,
  type LucideIcon,
} from "@/ui/icon-registry";
import type { ToolBlock } from "@/features/agent/messages";
import { highlightLines } from "@/features/agent/highlight-cache";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useAppStore } from "@/store";
import { FILESYSTEM_CHANGED_EVENT } from "@/lib/workspace-events";
import {
  FILE_WRITE_TOOL_NAMES,
  classifyTool,
  compactToolText,
  detectLang,
  extractFromArgs,
  extractPartialField,
  fileBasename,
  humanizeToolName,
  toolArg,
  toolPreviewHeightFor,
  toolVerb,
  type ToolKind,
} from "@/features/agent/ui/timeline/tool-metadata";
import {
  parseDiffPreview,
  type DiffPreviewLine,
} from "@/features/agent/ui/timeline/diff-preview-model";
import { parseUnifiedDiff } from "@/features/agent/ui/git-diff-panel-model";
import { PierreInlineDiff } from "@/features/agent/ui/git-diff-panel-diff-view";

const ToolPreviewHeightContext = createContext<PreviewHeight>("md");

function useToolPreviewHeight(): PreviewHeight {
  return useContext(ToolPreviewHeightContext);
}

export const TOOL_ICONS: Record<ToolKind, LucideIcon> = {
  edit: FilePenLine,
  search: Search,
  read: FileText,
  exec: TerminalSquare,
  browser: Globe2,
  mcp: Plug,
  setup: Rocket,
  generic: Wrench,
};

type ToolMeta = { title: string; detail: string | null; provider: string | null };

function previewHtmlDocument(source: string): string {
  const resetStyle = "<style>html,body{margin:0;padding:0}</style>";
  if (/<head[\s>]/i.test(source)) return source.replace(/<head([^>]*)>/i, `<head$1>${resetStyle}`);
  if (/<html[\s>]/i.test(source))
    return source.replace(/<html([^>]*)>/i, `<html$1><head>${resetStyle}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${resetStyle}</head><body>${source}</body></html>`;
}

function mcpProvider(name: string): string | null {
  const normalized = name.toLowerCase();
  const match = normalized.match(/^mcp__([^_]+)__/);
  if (match?.[1]) return match[1];
  const prefix = normalized.match(/^([a-z0-9-]+)[._]/)?.[1] ?? null;
  return prefix &&
    ["github", "figma", "slack", "linear", "notion", "obsidian", "context7"].includes(prefix)
    ? prefix
    : null;
}

function mcpTitle(block: ToolBlock): string {
  const running = block.status === "running";
  const action = block.name
    .toLowerCase()
    .replace(/^mcp__[^_]+__/, "")
    .replace(/^[^.]+\./, "");
  if (action.includes("search_pull_requests"))
    return running ? "Searching pull requests" : "Searched pull requests";
  if (action.includes("search_issues")) return running ? "Searching issues" : "Searched issues";
  if (action.includes("create_pull_request"))
    return running ? "Creating pull request" : "Created pull request";
  if (action.includes("get_pull_request"))
    return running ? "Opening pull request" : "Opened pull request";
  if (action.includes("create_issue")) return running ? "Creating issue" : "Created issue";
  if (action.includes("search")) return running ? "Searching" : "Searched";
  if (action.includes("list")) return running ? "Listing" : "Listed";
  if (action.includes("get") || action.includes("read")) return running ? "Reading" : "Read";
  if (action.includes("create") || action.includes("post")) return running ? "Creating" : "Created";
  if (action.includes("update") || action.includes("edit")) return running ? "Updating" : "Updated";
  return humanizeToolName(block.name);
}

function toolMeta(block: ToolBlock, filePath?: string | null): ToolMeta {
  const path = toolArg(block, [
    "path",
    "file_path",
    "filePath",
    "file",
    "filename",
    "target_file",
    "uri",
    "ref_id",
  ]);
  const query = toolArg(block, ["query", "q", "pattern", "search", "search_query", "needle"]);
  const command = toolArg(block, ["cmd", "command", "script", "shell", "input"]);
  const url = browserUrlFromBlock(block);
  const resolvedPath = filePath ?? path;
  const kind = classifyTool(block);
  const verb = toolVerb(block);
  const setupDetail = toolArg(block, ["ref"]);

  if (block.name.startsWith("local_studio_")) {
    return { title: verb, detail: compactToolText(setupDetail, 110), provider: null };
  }

  switch (kind) {
    case "edit":
      return {
        title: fileBasename(resolvedPath) ?? verb,
        detail: null,
        provider: null,
      };
    case "read":
      return { title: fileBasename(resolvedPath) ?? "File", detail: null, provider: null };
    case "search": {
      const compact = compactToolText(query, 80);
      return { title: compact ?? path ?? "Search", detail: null, provider: null };
    }
    case "exec":
      return { title: compactToolText(command, 160) ?? "Command", detail: null, provider: null };
    case "browser":
      return {
        title: browserToolLabel(block),
        detail: browserDomain(url) ?? compactToolText(browserToolDetail(block), 80),
        provider: null,
      };
    case "mcp":
      return {
        title: mcpTitle(block),
        detail: compactToolText(query ?? path ?? url, 80),
        provider: mcpProvider(block.name),
      };
    default:
      return {
        title: humanizeToolName(block.name),
        detail: compactToolText(command ?? query ?? path ?? url, 80),
        provider: null,
      };
  }
}

function browserDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function browserToolLabel(block: ToolBlock): string {
  const running = block.status === "running";
  const query = toolArg(block, ["query", "q"]);
  if (query) return running ? "Searching the web" : "Searched the web";
  if (Array.isArray(block.args?.search_query))
    return running ? "Searching the web" : "Searched the web";
  if (Array.isArray(block.args?.image_query))
    return running ? "Searching images" : "Searched images";
  if (Array.isArray(block.args?.open)) return running ? "Opening page" : "Opened page";
  if (Array.isArray(block.args?.click)) return running ? "Clicking link" : "Clicked link";
  if (Array.isArray(block.args?.find)) return running ? "Finding on page" : "Found on page";
  if (Array.isArray(block.args?.screenshot))
    return running ? "Taking screenshot" : "Took screenshot";
  const normalized = block.name
    .toLowerCase()
    .replace(/^browser_/, "")
    .replace(/^chrome_/, "");
  if (normalized.includes("navigate")) return running ? "Navigating" : "Navigated";
  if (normalized.includes("get_text")) return running ? "Reading page" : "Read page";
  if (normalized.includes("get_html")) return running ? "Reading page" : "Read page";
  if (normalized.includes("screenshot")) return running ? "Taking screenshot" : "Took screenshot";
  if (normalized.includes("click")) return running ? "Clicking" : "Clicked";
  if (normalized.includes("fill")) return running ? "Filling field" : "Filled field";
  if (normalized.includes("scroll")) return running ? "Scrolling" : "Scrolled";
  if (normalized.includes("get_url")) return running ? "Checking URL" : "Checked URL";
  if (normalized.includes("history")) return running ? "Checking history" : "Checked history";
  return running ? "Using browser" : "Used browser";
}

function browserUrlFromBlock(block: ToolBlock): string | null {
  const direct = toolArg(block, ["url", "href"]);
  if (direct) return direct;
  const source = JSON.stringify(block.args ?? {});
  return source.match(/https?:\\?\/\\?\/[^"]+/)?.[0]?.replaceAll("\\/", "/") ?? null;
}

function browserToolDetail(block: ToolBlock): string | null {
  const stringValue = toolArg(block, ["selector", "value", "tabId", "query"]);
  const deltaY = block.args?.deltaY;
  if (stringValue) return stringValue;
  if (typeof deltaY === "number") return `deltaY ${deltaY}`;
  return compactToolText(block.resultText, 110);
}

function durationLabel(block: ToolBlock): string | null {
  if (!block.startedAt || !block.finishedAt) return null;
  const elapsed = Date.parse(block.finishedAt) - Date.parse(block.startedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  if (elapsed < 1_000) return `${Math.round(elapsed)}ms`;
  return `${(elapsed / 1_000).toFixed(elapsed < 10_000 ? 1 : 0)}s`;
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.74-1.55-2.57-.3-5.27-1.29-5.27-5.7 0-1.26.45-2.3 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.17 1.18a10.94 10.94 0 0 1 5.77 0c2.2-1.5 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.8 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.28 5.7.42.36.79 1.07.79 2.16v3.2c0 .31.2.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

function ZigMark({ className }: { className?: string }) {
  return <span className={`${className ?? ""} font-mono text-[11px] font-semibold`}>Z</span>;
}

function ProviderMark({ provider }: { provider: string }) {
  if (provider === "github") {
    return <GithubMark className="h-3.5 w-3.5 shrink-0 text-(--dim)/70" />;
  }
  const label =
    provider === "slack" ? "#" : provider === "obsidian" ? "◇" : provider.slice(0, 1).toUpperCase();
  return (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center font-mono text-[11px] font-semibold text-(--color-skill-node-foreground)">
      {label}
    </span>
  );
}

const ToolAutoOpenContext = createContext(false);

function ToolSummary({
  block,
  filePath,
  children,
}: {
  block: ToolBlock;
  filePath?: string | null;
  children?: ReactNode;
}) {
  const meta = toolMeta(block, filePath);
  const running = block.status === "running";
  const kind = classifyTool(block);
  const Icon = TOOL_ICONS[kind];
  const autoOpen = useContext(ToolAutoOpenContext) || block.status === "error";
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? autoOpen;
  const duration = durationLabel(block);
  const resolvedPath =
    filePath ?? toolArg(block, ["path", "file_path", "filePath", "file", "filename"]);
  const zig = resolvedPath?.toLowerCase().endsWith(".zig") ?? false;
  const browserUrl = kind === "browser" ? browserUrlFromBlock(block) : null;
  const favicon = browserDomain(browserUrl)
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(browserDomain(browserUrl) ?? "")}&sz=32`
    : null;
  return (
    <div className="min-w-0 py-0.5">
      <button
        type="button"
        disabled={!children}
        aria-expanded={children ? open : undefined}
        onClick={() => children && setManualOpen(!open)}
        className="group flex min-h-7 w-full min-w-0 items-center gap-2 px-1 text-left disabled:cursor-default"
      >
        {meta.provider ? (
          <ProviderMark provider={meta.provider} />
        ) : zig ? (
          <ZigMark className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-(--color-file-node-foreground)" />
        ) : favicon ? (
          <img src={favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-[3px]" />
        ) : (
          <Icon className="h-3.5 w-3.5 shrink-0 text-(--dim)/65" strokeWidth={1.7} />
        )}
        <span
          className={`min-w-0 truncate text-[length:var(--fs-sm)] font-normal leading-5 transition-colors group-hover:text-(--fg) ${
            running ? "codex-shimmer-text" : "text-(--fg)/78"
          }`}
        >
          {meta.title}
        </span>
        {meta.detail ? (
          <span className="min-w-0 flex-1 truncate text-[length:var(--fs-xs)] leading-5 text-(--dim)/70 transition-colors group-hover:text-(--fg)/65">
            {meta.detail}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        {meta.provider && meta.provider !== "github" ? (
          <span className="shrink-0 text-[length:var(--fs-xs)] text-(--dim)/60">
            {meta.provider}
          </span>
        ) : null}
        {duration ? (
          <span className="shrink-0 font-mono text-[length:var(--fs-xs)] tabular-nums text-(--dim)/65">
            {duration}
          </span>
        ) : null}
        {block.status === "error" ? (
          <span className="shrink-0 text-[length:var(--fs-xs)] text-(--err)">failed</span>
        ) : null}
      </button>
      {children && open ? <div className="min-w-0 pt-0.5">{children}</div> : null}
    </div>
  );
}

/* The shell block: a single flat terminal surface — `$ command` line, then
   dim scrollback-style output. Failure tints the prompt; no chips, no rows. */
function ShellBlock({ output, status }: { output: string | null; status: ToolBlock["status"] }) {
  const failed = status === "error";
  const trimmedOutput = output?.replace(/\s+$/, "") || null;
  const height = useToolPreviewHeight();
  if (!trimmedOutput) return null;
  return (
    <div
      className={`overflow-hidden rounded-b-md border border-t-0 bg-(--color-input) ${
        failed ? "border-(--err)/35" : "border-(--border)"
      }`}
    >
      <PreviewScroll height={height} className="bg-(--surface)/45">
        <pre className="whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[length:var(--fs-sm)] leading-[1.6] text-(--fg)/55">
          {trimmedOutput}
        </pre>
      </PreviewScroll>
    </div>
  );
}

function ToolOutput({ children }: { children: ReactNode }) {
  const height = useToolPreviewHeight();
  return (
    <PreviewScroll
      height={height}
      className="max-w-full rounded-md border border-(--border) bg-(--color-input)"
    >
      <pre className="whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[length:var(--fs-sm)] leading-[1.6] text-(--fg)/65">
        {children}
      </pre>
    </PreviewScroll>
  );
}

function HighlightedToolSource({ body, lang }: { body: string; lang: string }) {
  const height = useToolPreviewHeight();
  const highlighted = useMemo(
    () => (lang ? highlightLines(lang, body.split("\n")).join("\n") : null),
    [body, lang],
  );
  return (
    <PreviewScroll height={height} stickToBottom={false} className="max-w-full">
      <pre className="px-3 py-2.5 font-mono text-[length:var(--fs-sm)] leading-[1.6] text-(--fg)/90">
        {highlighted !== null ? (
          <code
            className={`language-${lang} syntax-highlight`}
            dangerouslySetInnerHTML={{ __html: highlighted || "&nbsp;" }}
          />
        ) : (
          <code>{body || "\u00a0"}</code>
        )}
      </pre>
    </PreviewScroll>
  );
}

const DIFF_ROW_STYLES: Record<DiffPreviewLine["kind"], string> = {
  addition: "bg-(--ok)/[0.07]",
  context: "bg-transparent",
  deletion: "bg-(--err)/[0.065]",
  hunk: "border-y border-(--separator)/70 bg-(--fg)/[0.035] text-(--dim)",
  meta: "bg-(--fg)/[0.025] text-(--dim)/80",
};

const DIFF_MARKER_STYLES: Record<DiffPreviewLine["kind"], string> = {
  addition: "bg-(--ok)/[0.055] text-(--ok)",
  context: "text-(--dim)/35",
  deletion: "bg-(--err)/[0.05] text-(--err)",
  hunk: "text-(--dim)/45",
  meta: "text-(--dim)/45",
};

function DiffPreviewSource({ body, filePath }: { body: string; filePath?: string | null }) {
  const height = useToolPreviewHeight();
  const preview = useMemo(() => parseDiffPreview(body), [body]);
  const pierreFiles = useMemo(() => parseUnifiedDiff(body), [body]);
  const language = detectLang(filePath);
  const highlightedLines = useMemo(
    () =>
      language
        ? highlightLines(
            language,
            preview.lines.map((line) => line.content),
          )
        : null,
    [language, preview.lines],
  );
  if (pierreFiles.length > 0) {
    return (
      <div className="overflow-hidden rounded-md border border-(--border) bg-(--color-input)">
        <PreviewScroll height={height} stickToBottom={false}>
          <PierreInlineDiff files={pierreFiles} />
        </PreviewScroll>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-(--border) bg-(--color-input)">
      <div className="flex h-7 items-center justify-between border-b border-(--separator) px-3 text-[length:var(--fs-xs)]">
        <span className="text-(--dim)">Changes</span>
        <span className="flex items-center gap-2 font-mono">
          <span className="text-(--ok)">+{preview.additions}</span>
          <span className="text-(--err)">−{preview.deletions}</span>
        </span>
      </div>
      <PreviewScroll height={height} stickToBottom={false}>
        {preview.lines.map((line, index) => {
          const highlighted =
            line.kind === "addition" || line.kind === "deletion" || line.kind === "context"
              ? highlightedLines?.[index]
              : undefined;
          return (
            <div
              key={`${index}:${line.kind}`}
              className={`grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] font-mono text-[length:var(--fs-sm)] leading-5 ${DIFF_ROW_STYLES[line.kind]} ${line.content ? "min-h-5" : "h-3"}`}
            >
              <span
                className={`flex select-none items-start justify-center border-r border-(--separator)/45 ${DIFF_MARKER_STYLES[line.kind]}`}
              >
                {line.marker}
              </span>
              {highlighted !== undefined ? (
                <span
                  className="syntax-highlight min-w-0 whitespace-pre-wrap break-words px-3 text-(--fg)/82"
                  dangerouslySetInnerHTML={{ __html: highlighted || "&nbsp;" }}
                />
              ) : (
                <span className="min-w-0 whitespace-pre-wrap break-words px-3 text-(--fg)/82">
                  {line.content || "\u00a0"}
                </span>
              )}
            </div>
          );
        })}
      </PreviewScroll>
    </div>
  );
}

type FileWritePreviewData = {
  filePath: string | null;
  fileContent: string | null;
  patchContent: string | null;
};

type EditEntry = {
  oldText?: unknown;
  newText?: unknown;
};

function editsToDiff(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const hunks = value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const edit = entry as EditEntry;
    const oldText = typeof edit.oldText === "string" ? edit.oldText : "";
    const newText = typeof edit.newText === "string" ? edit.newText : "";
    if (!oldText && !newText) return [];
    const removed = oldText.split("\n").map((line) => `-${line}`);
    const added = newText.split("\n").map((line) => `+${line}`);
    return [`@@ edit ${index + 1} @@`, ...removed, ...added].join("\n");
  });
  return hunks.length ? hunks.join("\n") : null;
}

// Stream a diff preview out of partially-streamed args JSON. Some edit tools
// (str_replace_editor, apply_patch) emit `"old_str": "...`, `"new_str": "..."`
// fields before the surrounding object closes — find every such pair and
// render an incremental diff so the user sees the edit as it streams.
function partialEditsDiffFromArgsText(argsText: string | undefined): string | null {
  if (!argsText) return null;
  const oldKey = extractPartialField(argsText, ["old_str", "old_text", "oldText"]);
  const newKey = extractPartialField(argsText, ["new_str", "new_text", "newText", "replacement"]);
  if (oldKey === null && newKey === null) return null;
  const oldText = oldKey ?? "";
  const newText = newKey ?? "";
  if (!oldText && !newText) return null;
  const removed = oldText.split("\n").map((line: string) => `-${line}`);
  const added = newText.split("\n").map((line: string) => `+${line}`);
  return ["@@ edit @@", ...removed, ...added].join("\n");
}

function patchPreviewFromArgs(block: ToolBlock): string | null {
  const direct = extractFromArgs(block.args, block.argsText, ["patch", "diff"]);
  if (direct) return direct;
  const editsDiff = editsToDiff(block.args?.edits);
  if (editsDiff) return editsDiff;
  return (
    partialEditsDiffFromArgsText(block.argsText) ??
    (block.argsText ? extractFromArgs(undefined, block.argsText, ["edits"]) : null)
  );
}

function fileWritePreviewData(block: ToolBlock): FileWritePreviewData | null {
  const filePath = extractFromArgs(block.args, block.argsText, [
    "path",
    "file_path",
    "filePath",
    "file",
    "target_file",
    // The obsidian tools address a note, not a path on disk — same role here.
    "note",
  ]);
  const patchContent = patchPreviewFromArgs(block);
  const fileContent = patchContent
    ? null
    : extractFromArgs(block.args, block.argsText, [
        "content",
        "contents",
        "text",
        "body",
        "source",
        "payload",
        "newText",
        "new_text",
        "new_content",
        "new_str",
        "replacement",
        "insert",
      ]);

  if (fileContent === null && patchContent === null) return null;
  return { filePath, fileContent, patchContent };
}

function FileWritePreview({
  block,
  filePath,
  fileContent,
  patchContent,
}: {
  block: ToolBlock;
  filePath: string | null;
  fileContent: string | null;
  patchContent: string | null;
}) {
  const height = useToolPreviewHeight();
  const previewHeightPx = PREVIEW_HEIGHT_PX[height];
  const lang = detectLang(filePath);
  const isHtml = lang === "html";
  const body = fileContent ?? patchContent ?? "";
  const isSvg = /\.svg$/i.test(filePath ?? "") || /^\s*<svg[\s>]/i.test(body);
  const canPreview = isHtml || isSvg;
  const [showPreview, setShowPreview] = useState(isSvg);
  const sourceLang = fileContent === null && patchContent !== null ? "diff" : lang;

  return (
    <ToolSummary block={block} filePath={filePath}>
      {patchContent ? (
        <DiffPreviewSource body={patchContent} filePath={filePath} />
      ) : (
        <div className="overflow-hidden rounded-md border border-(--border) bg-(--color-input)">
          <div className="flex items-center justify-between gap-2 border-b border-(--separator) px-3 py-1.5 text-[length:var(--fs-sm)] text-(--dim)">
            <span className="truncate font-mono">
              {fileBasename(filePath) ?? sourceLang ?? "source"}
            </span>
            {canPreview ? (
              <button
                type="button"
                onClick={() => setShowPreview((value) => !value)}
                className="rounded-md px-1.5 py-0.5 text-[length:var(--fs-sm)] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
              >
                {showPreview ? "Source" : "Preview"}
              </button>
            ) : null}
          </div>
          {isSvg && showPreview ? (
            <div
              className="flex min-h-40 items-center justify-center overflow-auto bg-white p-4"
              style={{ height: previewHeightPx }}
            >
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(body)}`}
                alt={fileBasename(filePath) ?? "svg preview"}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ) : isHtml && showPreview ? (
            <iframe
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={previewHtmlDocument(body)}
              className="m-0 w-full border-0 bg-white p-0"
              style={{ height: previewHeightPx }}
              title={filePath ?? "preview"}
            />
          ) : (
            <HighlightedToolSource body={body} lang={sourceLang} />
          )}
        </div>
      )}
      {block.resultText ? (
        <div className="mt-1.5">
          <ToolOutput>{block.resultText}</ToolOutput>
        </div>
      ) : null}
    </ToolSummary>
  );
}

function diffPreviewData(block: ToolBlock): string | null {
  const diffText =
    extractFromArgs(block.args, block.argsText, ["patch", "diff", "edits"]) ?? block.resultText;
  if (!diffText) return null;
  if (block.name.toLowerCase().includes("diff")) return diffText;
  if (/^(diff --git|@@\s+-|\+\+\+ |--- )/m.test(diffText)) return diffText;
  return null;
}

function DiffPreview({ block, diffText }: { block: ToolBlock; diffText: string }) {
  const filePath = toolArg(block, ["path", "file_path", "filePath", "file", "filename"]);
  return (
    <ToolSummary block={block} filePath={filePath}>
      <DiffPreviewSource body={diffText} filePath={filePath} />
    </ToolSummary>
  );
}

function execCommand(block: ToolBlock): string | null {
  const command = extractFromArgs(block.args, block.argsText, [
    "cmd",
    "command",
    "script",
    "shell",
    "input",
    "command_line",
    "commandLine",
  ]);
  if (command?.trim()) return command;
  const args = block.args;
  if (!args) return null;
  for (const key of ["cmd", "command", "script", "shell", "input"]) {
    const value = args[key];
    if (Array.isArray(value) && value.every((part) => typeof part === "string")) {
      return value.join(" ");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const nested = value as Record<string, unknown>;
    for (const nestedKey of ["cmd", "command", "script", "shell", "input"]) {
      const nestedValue = nested[nestedKey];
      if (typeof nestedValue === "string" && nestedValue.trim()) return nestedValue;
    }
  }
  return null;
}

function BrowserPreview({ block }: { block: ToolBlock }) {
  const display =
    block.resultText || (block.text && block.text !== block.argsText ? block.text : "");
  return (
    <ToolSummary block={block}>{display ? <ToolOutput>{display}</ToolOutput> : null}</ToolSummary>
  );
}

function ToolPreviewHeightProvider({ kind, children }: { kind: ToolKind; children: ReactNode }) {
  const defaultHeight = useAppStore((state) => state.toolPreviewHeight);
  const overrides = useAppStore((state) => state.toolPreviewHeightOverrides);
  const height = toolPreviewHeightFor(kind, defaultHeight, overrides);
  return (
    <ToolPreviewHeightContext.Provider value={height}>{children}</ToolPreviewHeightContext.Provider>
  );
}

export function ToolBlockView({
  block,
  autoOpen = false,
}: {
  block: ToolBlock;
  autoOpen?: boolean;
}) {
  useFilesystemRefresh(block);
  const kind = classifyTool(block);
  const fileWritePreview = FILE_WRITE_TOOL_NAMES.has(block.name.toLowerCase())
    ? fileWritePreviewData(block)
    : null;
  if (fileWritePreview) {
    return (
      <ToolAutoOpenContext.Provider value={autoOpen}>
        <ToolPreviewHeightProvider kind={kind}>
          <FileWritePreview block={block} {...fileWritePreview} />
        </ToolPreviewHeightProvider>
      </ToolAutoOpenContext.Provider>
    );
  }
  const diffPreview = diffPreviewData(block);
  if (diffPreview) {
    return (
      <ToolAutoOpenContext.Provider value={autoOpen}>
        <ToolPreviewHeightProvider kind={kind}>
          <DiffPreview block={block} diffText={diffPreview} />
        </ToolPreviewHeightProvider>
      </ToolAutoOpenContext.Provider>
    );
  }
  if (kind === "exec") {
    const command = execCommand(block) ?? humanizeToolName(block.name);
    const output = block.resultText || null;
    return (
      <ToolAutoOpenContext.Provider value={autoOpen}>
        <ToolPreviewHeightProvider kind={kind}>
          <ToolSummary block={{ ...block, args: { ...block.args, command } }}>
            {output ? <ShellBlock output={output} status={block.status} /> : null}
          </ToolSummary>
        </ToolPreviewHeightProvider>
      </ToolAutoOpenContext.Provider>
    );
  }
  if (kind === "browser") {
    return (
      <ToolAutoOpenContext.Provider value={autoOpen}>
        <ToolPreviewHeightProvider kind={kind}>
          <BrowserPreview block={block} />
        </ToolPreviewHeightProvider>
      </ToolAutoOpenContext.Provider>
    );
  }

  const display =
    block.resultText || (block.text && block.text !== block.argsText ? block.text : "");
  return (
    <ToolAutoOpenContext.Provider value={autoOpen}>
      <ToolPreviewHeightProvider kind={kind}>
        <ToolSummary block={block}>
          {display ? <ToolOutput>{display}</ToolOutput> : null}
        </ToolSummary>
      </ToolPreviewHeightProvider>
    </ToolAutoOpenContext.Provider>
  );
}

function useFilesystemRefresh(block: ToolBlock): void {
  const refreshesFilesystem =
    FILE_WRITE_TOOL_NAMES.has(block.name.toLowerCase()) || classifyTool(block) === "exec";
  useMountSubscription(() => {
    if (block.status !== "done" || !refreshesFilesystem) return;
    window.dispatchEvent(new Event(FILESYSTEM_CHANGED_EVENT));
  }, [block.id, block.status, refreshesFilesystem]);
}
