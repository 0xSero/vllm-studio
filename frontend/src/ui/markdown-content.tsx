"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { cx } from "./utils";

const MARKDOWN_PLUGINS = [remarkGfm];
const SAFE_HTML_PLUGINS = [rehypeRaw, rehypeSanitize];

const markdownComponents: Components = {
  a: ({ children, href, ...props }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" {...props}>
      {children}
    </a>
  ),
};

export function MarkdownContent({
  markdown,
  className,
  components,
  safeHtml = false,
}: {
  markdown: string;
  className?: string;
  components?: Components;
  safeHtml?: boolean;
}) {
  return (
    <div
      className={cx(
        "chat-markdown min-w-0 max-w-full overflow-x-auto text-[length:var(--fs-md)] leading-6 [overflow-wrap:anywhere]",
        className,
      )}
    >
      <ReactMarkdown
        skipHtml={!safeHtml}
        remarkPlugins={MARKDOWN_PLUGINS}
        rehypePlugins={safeHtml ? SAFE_HTML_PLUGINS : undefined}
        components={{ ...markdownComponents, ...components }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
