"use client";

import React, {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PreviewScroll } from "@/ui";
import { useCopiedFlag } from "@/features/agent/ui/use-copied-flag";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { highlightLines } from "@/features/agent/highlight-cache";
import { normalizeBrowserInput } from "@/features/agent/tools/browser-url";
import { useToolsActions } from "@/features/agent/tools/context";
import type { ComputerTab } from "@/features/agent/tools/types";
import { writeClipboardText } from "@/lib/clipboard";
import {
  assistantMediaKind,
  assistantMediaName,
  assistantMediaSource,
  cleanFileReference,
  remarkLocalMediaReferences,
  type AssistantMediaKind,
} from "@/features/agent/ui/assistant-media";

const FILE_REF_PATTERN =
  /^(?:file:\/\/|~\/|\.{1,2}\/|\/|[\w.-]+\/)[^\s`'")]+(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)(?::\d+(?::\d+)?)?$/;

const DIRECTORY_REF_PATTERN = /^(?:~\/|\.{1,2}\/|\/)?[\w.-]+(?:\/[\w.-]+)*\/$/;

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToPlainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeToPlainText(node.props.children);
  return "";
}

function isFileReference(value: string | undefined): value is string {
  if (!value) return false;
  const clean = value.trim();
  if (/^https?:\/\//i.test(clean)) return false;
  return FILE_REF_PATTERN.test(clean) || DIRECTORY_REF_PATTERN.test(clean);
}

class MarkdownErrorBoundary extends React.Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  override render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

function CodeBlockCopyButton({ code }: { code: string }) {
  const [copied, markCopied] = useCopiedFlag();
  const handleCopy = useCallback(() => {
    void writeClipboardText(code).then(markCopied, () => undefined);
  }, [code, markCopied]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 rounded px-1 text-[length:var(--fs-xs)] text-(--dim) hover:text-(--fg)"
      aria-label={copied ? "Copied" : "Copy code"}
      title={copied ? "Copied" : "Copy code"}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function codeLanguage(children: ReactNode): string | null {
  const codeElement = Children.toArray(children).find(
    (child) =>
      isValidElement<{ className?: string }>(child) &&
      typeof child.props.className === "string" &&
      /\blanguage-/.test(child.props.className),
  );
  if (!isValidElement<{ className?: string }>(codeElement)) return null;
  const match = /\blanguage-([^\s]+)/.exec(codeElement.props.className ?? "");
  return match ? match[1] : null;
}

const FencedCodeBlock = memo(function FencedCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) {
  const [wrapped, setWrapped] = useState(false);
  const codeClassName = [language ? `language-${language}` : "", "font-mono"]
    .filter(Boolean)
    .join(" ");
  const highlightedCode = useMemo(
    () => (language ? highlightLines(language, code.split("\n")).join("\n") : null),
    [code, language],
  );

  return (
    <div className="assistant-code-block group my-3 overflow-hidden rounded-md border border-(--border) bg-(--color-input)">
      <div className="flex h-7 items-center justify-between border-b border-(--separator) px-3">
        <span className="font-mono text-[length:var(--fs-sm)] font-medium text-(--dim)">
          {language ?? "code"}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWrapped((value) => !value)}
            className={`rounded px-1 text-[length:var(--fs-xs)] hover:text-(--fg) ${wrapped ? "bg-(--hover) text-(--fg)" : "text-(--dim)"}`}
            aria-pressed={wrapped}
            aria-label={wrapped ? "Disable code wrapping" : "Wrap code"}
            title={wrapped ? "Disable wrapping" : "Wrap code"}
          >
            Wrap
          </button>
          {code ? <CodeBlockCopyButton code={code} /> : null}
        </div>
      </div>
      <PreviewScroll height="lg" stickToBottom={false} className="max-w-full">
        <pre
          className={`m-0 bg-transparent px-3 py-2.5 text-[length:var(--fs-sm)] leading-[1.6] ${wrapped ? "whitespace-pre-wrap break-words" : "overflow-x-auto"}`}
        >
          {highlightedCode !== null ? (
            <code
              className={`${codeClassName} syntax-highlight`}
              dangerouslySetInnerHTML={{ __html: highlightedCode || "&nbsp;" }}
            />
          ) : (
            <code className={codeClassName}>{code}</code>
          )}
        </pre>
      </PreviewScroll>
    </div>
  );
});
FencedCodeBlock.displayName = "FencedCodeBlock";

const components: Components = {
  pre: ({ node: _n, children }) => {
    const code = nodeToPlainText(
      Children.toArray(children).find(
        (child) => isValidElement(child) && (child as { type?: string }).type === "code",
      ) ?? children,
    );
    const language = codeLanguage(children);
    return <FencedCodeBlock code={code} language={language} />;
  },
  a: ({ node: _n, href, children, ...props }) =>
    safeExternalHref(href) ? (
      <a {...props} href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : "[Remote image hidden]"}</span>,
  table: ({ node: _n, children }) => <MarkdownTable>{children}</MarkdownTable>,
  blockquote: ({ node: _n, children }) => <MarkdownBlockquote>{children}</MarkdownBlockquote>,
};

function tableText(table: HTMLTableElement): string[][] {
  return [...table.rows].map((row) => [...row.cells].map((cell) => cell.innerText.trim()));
}

function markdownTable(rows: string[][]): string {
  if (!rows.length) return "";
  const escape = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) =>
    Array.from({ length: width }, (_, index) => escape(row[index] ?? "")),
  );
  const header = normalized[0] ?? [];
  return [header, header.map(() => "---"), ...normalized.slice(1)]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function csvTable(rows: string[][]): string {
  return rows
    .map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

function MarkdownTable({ children }: { children?: ReactNode }) {
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [copied, setCopied] = useState<"markdown" | "csv" | null>(null);
  const copy = (format: "markdown" | "csv") => {
    const table = tableRef.current;
    if (!table) return;
    const rows = tableText(table);
    void writeClipboardText(format === "markdown" ? markdownTable(rows) : csvTable(rows)).then(
      () => {
        setCopied(format);
        window.setTimeout(() => setCopied(null), 1500);
      },
    );
  };
  return (
    <div className="assistant-markdown-table group/table my-3 overflow-hidden rounded-[var(--rad-md)] border border-(--border)">
      <div className="flex h-7 items-center justify-end gap-1 border-b border-(--border) bg-(--color-panel-subtle) px-1.5 opacity-70 transition-opacity group-hover/table:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={() => copy("markdown")}
          className="rounded px-1.5 py-0.5 text-[length:var(--fs-xs)] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
        >
          {copied === "markdown" ? "Copied" : "Markdown"}
        </button>
        <button
          type="button"
          onClick={() => copy("csv")}
          className="rounded px-1.5 py-0.5 text-[length:var(--fs-xs)] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
        >
          {copied === "csv" ? "Copied" : "CSV"}
        </button>
      </div>
      <div className="max-w-full overflow-x-auto">
        <table ref={tableRef}>{children}</table>
      </div>
    </div>
  );
}

const ALERT_TYPES = new Set(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]);

function stripAlertMarker(node: ReactNode, state: { stripped: boolean }): ReactNode {
  if (typeof node === "string" && !state.stripped) {
    const next = node.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i, "");
    if (next !== node) state.stripped = true;
    return next;
  }
  if (Array.isArray(node)) return node.map((child) => stripAlertMarker(child, state));
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return cloneElement(node, undefined, stripAlertMarker(node.props.children, state));
  }
  return node;
}

function MarkdownBlockquote({ children }: { children?: ReactNode }) {
  const match = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(nodeToPlainText(children));
  const type = match?.[1]?.toUpperCase();
  if (!type || !ALERT_TYPES.has(type)) return <blockquote>{children}</blockquote>;
  const stripped = stripAlertMarker(children, { stripped: false });
  return (
    <div role="note" data-markdown-alert={type.toLowerCase()} className="chat-markdown-alert">
      <div className="chat-markdown-alert-title">{type}</div>
      {stripped}
    </div>
  );
}

function safeExternalHref(value: string | undefined): boolean {
  if (!value) return false;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

// The remark/rehype plugin lists are constant. Hoisted out of render so the
// `ReactMarkdown` reconciler sees the same array identity each commit.
const REMARK_PLUGINS = [remarkGfm, remarkBreaks, remarkLocalMediaReferences];
const REHYPE_PLUGINS = [
  rehypeRaw,
  [
    rehypeSanitize,
    {
      ...defaultSchema,
      attributes: {
        ...defaultSchema.attributes,
        code: [...(defaultSchema.attributes?.code ?? []), ["className", /^language-/]],
      },
    },
  ],
] satisfies NonNullable<React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]>;

function appUrlTransform(value: string): string {
  return isFileReference(value) || assistantMediaKind(value) ? value : defaultUrlTransform(value);
}

// Repair a single emphasis run whose closing delimiter has a stray leading
// space (`**text **`), which CommonMark won't parse as bold. Two guards keep us
// from collapsing the space *between* two adjacent runs:
//   1. the content must START with a non-space, non-delimiter char, so we anchor
//      on a real opener rather than a previous run's closing `**` — blocks
//      `**a** and **b**` (gap starts with a space);
//   2. the trailing `**` must NOT be immediately followed by a word or `*` char,
//      otherwise it's the OPENER of the next run, not a closer — blocks
//      `**a**, **b**` (gap starts with punctuation).
// Only spaces/tabs are stripped (not newlines), since the symptom is a lost
// inline space.
function normalizeLooseMarkdownEmphasis(text: string): string {
  return text
    .replace(/\*\*([^\s*][^\n*]*?)[ \t]+\*\*(?![*\w])/g, "**$1**")
    .replace(/__([^\s_][^\n_]*?)[ \t]+__(?![_\w])/g, "__$1__");
}

type ToolHandlers = {
  setComputerOpen: (open: boolean) => void;
  setComputerTab: (tab: ComputerTab) => void;
  setBrowserUrl: (url: string, input?: string) => void;
  requestFileOpen: (path: string) => void;
};

function buildComponentsWithAppLinks(tools: ToolHandlers, cwd: string | null): Components {
  // Clicking a file reference opens it in the right panel's Files view with the
  // file selected — on both web and desktop. `requestFileOpen` opens the panel,
  // switches to the files tab, and the filesystem effect resolves the path
  // (file://, :line suffix, cwd-relative, or absolute-under-cwd) and previews
  // images/markdown/etc via its own previewKind logic.
  //
  // Alt-click is the explicit "Reveal" affordance: on desktop it reveals the
  // file in Finder/Explorer (server-side path resolution), falling back to the
  // in-app Files view when reveal is unavailable or fails; on web there is no OS
  // file manager, so it just opens the Files view like a plain click.
  const openFileReference = (raw: string, revealInOs: boolean) => {
    const cleaned = cleanFileReference(raw);
    if (!cleaned) return;
    const reveal = revealInOs ? window.localStudioDesktop?.revealPath : undefined;
    if (reveal) {
      void reveal(cleaned).then(
        (ok) => {
          if (!ok) tools.requestFileOpen(cleaned);
        },
        () => tools.requestFileOpen(cleaned),
      );
      return;
    }
    tools.requestFileOpen(cleaned);
  };
  return {
    ...components,
    code: ({ node: _n, className, children, ...props }) => {
      const isBlock = typeof className === "string" && /\blanguage-/.test(className);
      if (isBlock) {
        return (
          <code className={`${className ?? ""} font-mono`} {...props}>
            {children}
          </code>
        );
      }
      const value = nodeToPlainText(children).trim();
      const mediaKind = assistantMediaKind(value);
      if (mediaKind) {
        return (
          <AssistantMedia cwd={cwd} kind={mediaKind} onOpen={openFileReference} reference={value} />
        );
      }
      if (isFileReference(value)) return <FileLink onOpen={openFileReference} value={value} />;
      return <code {...props}>{children}</code>;
    },
    a: ({ node: _n, href, children, ...props }) => {
      const mediaKind = assistantMediaKind(href);
      if (typeof href === "string" && mediaKind) {
        return (
          <AssistantMedia
            cwd={cwd}
            kind={mediaKind}
            label={nodeToPlainText(children)}
            onOpen={openFileReference}
            reference={href}
          />
        );
      }
      if (typeof href === "string" && isFileReference(href)) {
        return (
          <FileLink onOpen={openFileReference} value={href}>
            {children}
          </FileLink>
        );
      }
      if (!safeExternalHref(href)) return <span>{children}</span>;
      return (
        <a
          {...props}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => {
            if (!href) return;
            const next = normalizeBrowserInput(href, "");
            if (!next) return;
            event.preventDefault();
            tools.setComputerOpen(true);
            tools.setComputerTab("browser");
            tools.setBrowserUrl(next, next);
          }}
          title={href}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt }) => {
      const reference = typeof src === "string" ? src : "";
      const mediaKind = assistantMediaKind(reference);
      return mediaKind ? (
        <AssistantMedia
          cwd={cwd}
          kind={mediaKind}
          label={alt ?? undefined}
          onOpen={openFileReference}
          reference={reference}
        />
      ) : (
        <span>{alt ? `[Image: ${alt}]` : "[Remote image hidden]"}</span>
      );
    },
  };
}

function AssistantMedia({
  cwd,
  kind,
  label,
  onOpen,
  reference,
}: {
  cwd: string | null;
  kind: AssistantMediaKind;
  label?: string;
  onOpen: (value: string, revealInOs: boolean) => void;
  reference: string;
}) {
  const source = assistantMediaSource(reference, cwd);
  if (!source) return <FileLink onOpen={onOpen} value={reference} />;
  return (
    <AssistantMediaPlayback
      key={source}
      kind={kind}
      label={label?.trim() || assistantMediaName(reference)}
      onOpen={onOpen}
      reference={reference}
      source={source}
    />
  );
}

function AssistantMediaPlayback({
  kind,
  label,
  onOpen,
  reference,
  source,
}: {
  kind: AssistantMediaKind;
  label: string;
  onOpen: (value: string, revealInOs: boolean) => void;
  reference: string;
  source: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <FileLink onOpen={onOpen} value={reference} />;
  return (
    <span className="chat-response-media" data-kind={kind}>
      {kind === "image" ? (
        <img src={source} alt={label} loading="lazy" onError={() => setFailed(true)} />
      ) : kind === "video" ? (
        <video
          src={source}
          controls
          preload="metadata"
          playsInline
          onError={() => setFailed(true)}
        />
      ) : (
        <audio src={source} controls preload="metadata" onError={() => setFailed(true)} />
      )}
      <span className="chat-response-media-caption">
        <FileLink onOpen={onOpen} value={reference}>
          {label}
        </FileLink>
      </span>
    </span>
  );
}

// A file path renders as a plain blue link (monospace, so paths stay legible)
// rather than a chip — no icon, no background, no inline copy button.
function FileLink({
  children,
  onOpen,
  value,
}: {
  children?: ReactNode;
  onOpen: (value: string, revealInOs: boolean) => void;
  value: string;
}) {
  return (
    <a
      className="chat-file-link"
      href={`file://${value}`}
      onClick={(event) => {
        event.preventDefault();
        onOpen(value, event.altKey);
      }}
      title={`Open ${value}`}
    >
      {children ?? value}
    </a>
  );
}

function AssistantMarkdownInner({ text, cwd = null }: { text: string; cwd?: string | null }) {
  // Actions-only subscription: tools state churn (browser typing, selections)
  // never re-renders frozen markdown blocks.
  const tools = useToolsActions();
  const normalizedText = useMemo(() => normalizeLooseMarkdownEmphasis(text), [text]);
  // Stable `components` map: only changes when any of the tool callbacks it
  // captures changes identity (they're useCallback-stable in ToolsProvider).
  const componentsWithAppLinks = useMemo<Components>(
    () =>
      buildComponentsWithAppLinks(
        {
          setComputerOpen: tools.setComputerOpen,
          setComputerTab: tools.setComputerTab,
          setBrowserUrl: tools.setBrowserUrl,
          requestFileOpen: tools.requestFileOpen,
        },
        cwd,
      ),
    [cwd, tools.setComputerOpen, tools.setComputerTab, tools.setBrowserUrl, tools.requestFileOpen],
  );
  return (
    <div className="chat-markdown min-w-0 max-w-full overflow-x-hidden [overflow-wrap:anywhere]">
      <MarkdownErrorBoundary
        fallback={
          <pre className="max-w-full whitespace-pre-wrap break-words font-[inherit] [overflow-wrap:anywhere]">
            {normalizedText}
          </pre>
        }
      >
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={componentsWithAppLinks}
          urlTransform={appUrlTransform}
        >
          {normalizedText}
        </ReactMarkdown>
      </MarkdownErrorBoundary>
    </div>
  );
}

// React.memo on `text` lets prior text blocks skip re-rendering entirely once
// they're frozen. The streaming text block keeps changing identity per delta
// (via appendDelta), which still re-renders correctly through this memo.
export const AssistantMarkdown = memo(AssistantMarkdownInner);
AssistantMarkdown.displayName = "AssistantMarkdown";
