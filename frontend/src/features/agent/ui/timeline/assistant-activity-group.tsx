import { memo, useMemo } from "react";
import type { ThinkingBlock, ToolBlock } from "@/features/agent/messages";
import { useReasoningVisible } from "@/features/agent/messages/use-reasoning-visible";
import {
  mergeReasoningBlocks,
  type ActivitySegment,
} from "@/features/agent/ui/timeline/activity-grouping";
import { ToolBlockView } from "@/features/agent/ui/timeline/tool-block-view";
import { classifyTool, toolArg } from "@/features/agent/ui/timeline/tool-metadata";
import { Globe2 } from "@/ui/icon-registry";

type ActivityItem =
  | { kind: "tool"; id: string; block: ToolBlock }
  | { kind: "reasoning"; id: string; block: ThinkingBlock }
  | { kind: "browser-group"; id: string; blocks: ToolBlock[] };

function cleanThinkingText(text: string): string {
  return text.replace(/\*\*([\s\S]*?)\*\*/g, "$1").trim();
}

function browserUrl(block: ToolBlock): string | null {
  const direct = toolArg(block, ["url", "href"]);
  if (direct) return direct;
  return (
    block.argsText?.match(/https?:\/\/[^\s"'}]+/)?.[0] ??
    block.text?.match(/https?:\/\/[^\s"'}]+/)?.[0] ??
    block.resultText?.match(/https?:\/\/[^\s"'}]+/)?.[0] ??
    null
  );
}

function browserSite(url: string): { href: string; label: string; favicon: string } | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    return {
      href: parsed.href,
      label: hostname,
      favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`,
    };
  } catch {
    return null;
  }
}

function groupBrowserItems(items: ActivityItem[]): ActivityItem[] {
  const grouped: ActivityItem[] = [];
  for (const item of items) {
    if (item.kind !== "tool" || classifyTool(item.block) !== "browser") {
      grouped.push(item);
      continue;
    }
    const previous = grouped.at(-1);
    if (previous?.kind === "browser-group") {
      previous.blocks.push(item.block);
    } else {
      grouped.push({ kind: "browser-group", id: `browser-${item.id}`, blocks: [item.block] });
    }
  }
  return grouped;
}

function BrowserActivity({ blocks, live }: { blocks: ToolBlock[]; live: boolean }) {
  const sites = new Map<string, ReturnType<typeof browserSite>>();
  for (const block of blocks) {
    const url = browserUrl(block);
    const site = url ? browserSite(url) : null;
    if (site) sites.set(site.label, site);
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border border-(--border) bg-(--color-input)/55 px-2.5 py-2">
      <Globe2 className={`h-3.5 w-3.5 shrink-0 text-(--dim)/65 ${live ? "animate-pulse" : ""}`} />
      {[...sites.values()].map((site) =>
        site ? (
          <a
            key={site.label}
            href={site.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-6 max-w-44 items-center gap-1.5 rounded-full border border-(--border) bg-(--surface) px-2 text-[length:var(--fs-xs)] text-(--fg)/72 transition-colors hover:bg-(--hover) hover:text-(--fg)"
          >
            <img src={site.favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
            <span className="truncate">{site.label}</span>
          </a>
        ) : null,
      )}
      {sites.size === 0 ? (
        <span className="text-[length:var(--fs-xs)] text-(--dim)">Web</span>
      ) : null}
    </div>
  );
}

export const AssistantActivityGroup = memo(function AssistantActivityGroup({
  segments,
  live,
}: {
  segments: ActivitySegment[];
  live: boolean;
}) {
  const showReasoning = useReasoningVisible();
  const items = useMemo<ActivityItem[]>(() => {
    const next: ActivityItem[] = [];
    for (const segment of segments) {
      if (segment.kind === "tools") {
        next.push(
          ...segment.blocks.map((block) => ({ kind: "tool" as const, id: block.id, block })),
        );
        continue;
      }
      if (!showReasoning) continue;
      const block = mergeReasoningBlocks(segment.blocks);
      if (block) next.push({ kind: "reasoning", id: block.id, block });
    }
    return groupBrowserItems(next);
  }, [segments, showReasoning]);

  if (items.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {items.map((item, index) =>
        item.kind === "reasoning" ? (
          <div
            key={item.id}
            className={`whitespace-pre-wrap text-[length:var(--fs-base)] leading-[1.625] text-(--fg)/62 ${
              live && index === items.length - 1 ? "codex-shimmer-text" : ""
            }`}
          >
            {cleanThinkingText(item.block.text)}
          </div>
        ) : item.kind === "browser-group" ? (
          <BrowserActivity
            key={item.id}
            blocks={item.blocks}
            live={live && index === items.length - 1}
          />
        ) : (
          <ToolBlockView key={item.id} block={item.block} />
        ),
      )}
    </div>
  );
});
