import { memo, useMemo, useState } from "react";
import type { ThinkingBlock, ToolBlock } from "@/features/agent/messages";
import { useReasoningVisible } from "@/features/agent/messages/use-reasoning-visible";
import {
  mergeReasoningBlocks,
  type ActivitySegment,
} from "@/features/agent/ui/timeline/activity-grouping";
import { ToolBlockView } from "@/features/agent/ui/timeline/tool-block-view";
import { Brain } from "@/ui/icon-registry";

type ActivityItem =
  | { kind: "tool"; id: string; block: ToolBlock }
  | { kind: "reasoning"; id: string; block: ThinkingBlock };

function cleanThinkingText(text: string): string {
  return text.replace(/\*\*([\s\S]*?)\*\*/g, "$1").trim();
}

function reasoningParts(text: string): { title: string; detail: string | null } {
  const cleaned = cleanThinkingText(text);
  const firstBreak = cleaned.search(/\n\s*\n|\n|(?<=[.!?])\s+/);
  if (firstBreak < 0) return { title: cleaned, detail: null };
  const title = cleaned.slice(0, firstBreak).trim();
  const detail = cleaned.slice(firstBreak).trim();
  return { title: title || "Reasoning", detail: detail || null };
}

function ReasoningRow({ block, autoOpen }: { block: ThinkingBlock; autoOpen: boolean }) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const { title, detail } = reasoningParts(block.text);
  const open = manualOpen ?? autoOpen;
  return (
    <div className="min-w-0 py-0.5">
      <button
        type="button"
        disabled={!detail}
        aria-expanded={detail ? open : undefined}
        onClick={() => detail && setManualOpen(!open)}
        className="group flex min-h-7 w-full min-w-0 items-center gap-2 px-1 text-left disabled:cursor-default"
      >
        <Brain
          className="h-3.5 w-3.5 shrink-0 text-(--color-command-node-foreground)/75"
          strokeWidth={1.7}
        />
        <span
          className={`min-w-0 flex-1 truncate text-[length:var(--fs-sm)] leading-5 text-(--fg)/78 transition-colors group-hover:text-(--fg) ${autoOpen ? "codex-shimmer-text" : ""}`}
        >
          {title || "Reasoning"}
        </span>
      </button>
      {detail && open ? (
        <div className="px-6 pb-1 pt-0.5 whitespace-pre-wrap text-[length:var(--fs-sm)] leading-[1.55] text-(--dim)/78">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

export const AssistantActivityGroup = memo(function AssistantActivityGroup({
  segments,
  live,
  latest,
}: {
  segments: ActivitySegment[];
  live: boolean;
  latest: boolean;
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
    return next;
  }, [segments, showReasoning]);

  const lastToolIndex = items.findLastIndex((item) => item.kind === "tool");
  const lastReasoningIndex = items.findLastIndex((item) => item.kind === "reasoning");
  if (items.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {items.map((item, index) =>
        item.kind === "reasoning" ? (
          <ReasoningRow
            key={item.id}
            block={item.block}
            autoOpen={live && index === lastReasoningIndex && index > lastToolIndex}
          />
        ) : (
          <ToolBlockView
            key={item.id}
            block={item.block}
            autoOpen={latest && index === lastToolIndex}
          />
        ),
      )}
    </div>
  );
});
