"use client";

import { useRef, useState } from "react";
import type { Mermaid } from "mermaid";
import { AssistantMarkdown } from "@/features/agent/ui/assistant-markdown";
import type { PreviewKind } from "@/features/agent/filesystem-types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type MarkdownSegment =
  | { kind: "text"; text: string }
  | { kind: "mermaid"; code: string; fence: string };

let mermaidLoader: Promise<Mermaid> | null = null;
let mermaidRenderSeq = 0;

function loadMermaid(): Promise<Mermaid> {
  mermaidLoader ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({ startOnLoad: false, theme: "dark" });
    return mermaid;
  });
  return mermaidLoader;
}

function splitMermaidSegments(text: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const pattern = /^[ \t]*```mermaid[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  let cursor = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    }
    segments.push({ kind: "mermaid", code: match[1] ?? "", fence: match[0] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length || segments.length === 0) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}

function MermaidBlock({ code, fence }: { code: string; fence: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useMountSubscription(() => {
    let cancelled = false;
    const renderId = `fs-preview-mermaid-${++mermaidRenderSeq}`;
    void loadMermaid()
      .then((mermaid) => mermaid.render(renderId, code))
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg;
      })
      .catch(() => {
        document.getElementById(`d${renderId}`)?.remove();
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);
  if (failed) return <AssistantMarkdown text={fence} />;
  return <div ref={containerRef} className="my-2 overflow-x-auto" />;
}

function MarkdownWithMermaid({ text }: { text: string }) {
  return (
    <>
      {splitMermaidSegments(text).map((segment, index) =>
        segment.kind === "mermaid" ? (
          <MermaidBlock
            key={`${index}-${segment.code}`}
            code={segment.code}
            fence={segment.fence}
          />
        ) : (
          <AssistantMarkdown key={index} text={segment.text} />
        ),
      )}
    </>
  );
}

function previewKindForPath(path: string): PreviewKind | null {
  if (/\.(html?|svg)$/i.test(path)) return "html";
  if (/\.(jsx|tsx)$/i.test(path)) return "jsx";
  if (/\.(md|mdx|markdown)$/i.test(path)) return "md";
  if (/\.(png|jpe?g|gif|webp|avif|bmp|ico|apng)$/i.test(path)) return "image";
  if (/\.pdf$/i.test(path)) return "pdf";
  return null;
}

export function previewKindForOpenFile(openFile: string | null): PreviewKind | null {
  return openFile ? previewKindForPath(openFile) : null;
}

/** Kinds served from the file's own bytes instead of a UTF-8 text read. */
export function isBinaryPreviewKind(kind: PreviewKind | null): kind is "image" | "pdf" {
  return kind === "image" || kind === "pdf";
}

export function rawFileUrl(root: string, relPath: string): string {
  return `/api/agent/fs/raw?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(relPath)}`;
}

// Images render straight from /api/agent/fs/raw — same-origin, so the app's
// `img-src 'self'` CSP allows them. PDFs cannot be embedded (the CSP sets
// `object-src 'none'` and the desktop shell runs with plugins disabled), so the
// panel hands those to the OS or a browser tab instead of framing them.
export function ImagePreview({ name, url }: { name: string; url: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-(--bg) p-4">
      <img src={url} alt={name} className="max-h-full max-w-full object-contain" />
    </div>
  );
}

function extractJsxPreviewSource(source: string): string {
  const withoutImports = source
    .replace(/^\s*import\s.+?;?\s*$/gm, "")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s+/gm, "");
  const returnMatch = withoutImports.match(/return\s*\(([\s\S]*?)\)\s*;?\s*}/);
  const arrowMatch = withoutImports.match(/=>\s*\(([\s\S]*?)\)\s*;?\s*$/m);
  const body = (returnMatch?.[1] || arrowMatch?.[1] || withoutImports).trim();
  return body
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\sclassName=/g, " class=")
    .replace(/\shtmlFor=/g, " for=")
    .replace(/\{`([^`]+)`\}/g, "$1")
    .replace(/\{"([^"]*)"\}/g, "$1")
    .replace(/\{'([^']*)'\}/g, "$1")
    .replace(/\{[^{}]*\}/g, "")
    .replace(/<([A-Z][\w.]*)/g, '<div data-component="$1"')
    .replace(/<\/[A-Z][\w.]*>/g, "</div>");
}

function previewDocument(content: string, kind: "html" | "jsx"): string {
  const body = kind === "jsx" ? extractJsxPreviewSource(content) : content;
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0}body{font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#fff}*{box-sizing:border-box}img,video,iframe{max-width:100%}pre,code{white-space:pre-wrap}</style></head><body>${body}</body></html>`;
}

export function RenderedPreview({ content, kind }: { content: string; kind: PreviewKind }) {
  // Binary kinds render from their own bytes via BinaryPreview, never from a
  // text read, so they never reach the srcDoc path below.
  if (isBinaryPreviewKind(kind)) return null;
  if (kind === "md") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto bg-(--bg) px-5 py-4 text-sm leading-6 text-(--fg)">
        <MarkdownWithMermaid text={content} />
      </div>
    );
  }
  return (
    <iframe
      title="Rendered file preview"
      sandbox="allow-same-origin allow-popups allow-forms"
      srcDoc={previewDocument(content, kind)}
      className="min-h-0 flex-1 bg-white"
    />
  );
}
