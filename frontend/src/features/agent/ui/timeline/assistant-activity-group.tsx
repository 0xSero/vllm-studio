import { memo, useMemo, useState } from "react";
import { ChevronRight } from "@/ui/icon-registry";
import type { ThinkingBlock, ToolBlock } from "@/features/agent/messages";
import { useReasoningVisible } from "@/features/agent/messages/use-reasoning-visible";
import { ToolBlockView } from "@/features/agent/ui/timeline/tool-block-view";
import {
  buildActivityItems,
  exploreCounts,
  summarizeActivity,
  activityPreview,
  type ActivitySegment,
} from "@/features/agent/ui/timeline/activity-grouping";

/* Each thinking block is its own collapsible disclosure, shown inline between
   tool calls inside the activity group. It stays collapsed by default even while
   live so streaming thought text doesn't continuously resize the transcript. */
function ReasoningDisclosure({ block, active }: { block: ThinkingBlock; active: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? false;
  return (
    <details className="group min-w-0" open={open}>
      <summary
        className="flex min-h-6 cursor-pointer list-none items-center gap-1.5 rounded-lg px-1.5 py-0.5 transition-colors hover:bg-(--hover) [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          setUserOpen(!open);
        }}
      >
        <span
          className={`text-[length:var(--fs-base)] font-normal leading-5 ${
            active ? "codex-shimmer-text" : "text-(--fg)/55"
          }`}
        >
          {active ? "Thinking" : "Thought"}
        </span>
        <ChevronRight className="h-3 w-3 text-(--dim)/50 transition-transform group-open:rotate-90" />
      </summary>
      {open ? (
        <div className="mb-1.5 ml-1.5 mt-1 max-h-[320px] min-w-0 overflow-auto whitespace-pre-wrap border-l-2 border-(--border) pl-3 text-[length:var(--fs-base)] leading-[1.625] text-(--fg)/60">
          {block.text}
        </div>
      ) : null}
    </details>
  );
}

function ExploreAccordion({ blocks, live }: { blocks: ToolBlock[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const running = live && blocks.some((block) => block.status === "running");
  const counts = exploreCounts(blocks);
  return (
    <details className="group min-w-0" open={open}>
      <summary
        className="flex min-h-6 min-w-0 cursor-pointer list-none items-center gap-2 rounded-lg px-1.5 py-0.5 transition-colors hover:bg-(--hover) [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
        }}
      >
        <span
          className={`shrink-0 text-[length:var(--fs-base)] font-normal leading-5 ${
            running ? "codex-shimmer-text" : "text-(--fg)/55"
          }`}
        >
          {running ? "Exploring" : "Explored"}
        </span>
        <span className="min-w-0 flex-1 truncate text-[length:var(--fs-base)] leading-5 text-(--hl2)">
          {counts}
        </span>
        <ChevronRight className="h-3 w-3 shrink-0 text-(--dim)/50 transition-transform group-open:rotate-90" />
      </summary>
      {open ? (
        <div className="mb-1.5 ml-2 mt-1 flex min-w-0 flex-col gap-0.5 border-l border-(--separator) pl-2">
          {blocks.map((block) => (
            <ToolBlockView key={block.id} block={block} />
          ))}
        </div>
      ) : null}
    </details>
  );
}

/* Every run of thoughts+tools between two content blocks collapses into ONE
   disclosure. Collapsed it reads as a Codex-style summary ("Ran 6 commands ·
   read 3 files"); while streaming it shows a shimmering "Working" plus a live
   preview of the current action. Expanding reveals the individual rows. */
export const AssistantActivityGroup = memo(function AssistantActivityGroup({
  segments,
  live,
}: {
  segments: ActivitySegment[];
  // `live`: this group is the actively streaming block (drives the "Working"
  // shimmer + live preview).
  live: boolean;
}) {
  // Global "show reasoning" preference: when off, drop reasoning segments so the
  // group shows tools only (and disappears entirely for thinking-only turns).
  const showReasoning = useReasoningVisible();
  const visibleSegments = useMemo(
    () => (showReasoning ? segments : segments.filter((segment) => segment.kind !== "reasoning")),
    [segments, showReasoning],
  );
  const items = useMemo(() => buildActivityItems(visibleSegments), [visibleSegments]);
  // Keep live work collapsed by default. Streaming reasoning/tool previews can
  // grow by hundreds of pixels and update every token; auto-opening them makes
  // the transcript visibly jump and flicker. The summary row stays one line and
  // users can still expand details explicitly.
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);
  const expanded = userExpanded ?? false;
  const working =
    live &&
    visibleSegments.some(
      (segment) =>
        segment.kind === "tools" && segment.blocks.some((block) => block.status === "running"),
    );
  const summary = useMemo(() => summarizeActivity(visibleSegments), [visibleSegments]);
  const preview = live ? activityPreview(visibleSegments) : null;

  // Reasoning hidden + nothing else to show → render nothing. The turn's
  // "Working for…"/"Worked for…" divider still signals that the model worked.
  if (items.length === 0) return null;

  // A reasoning-only burst (no tools) needs no "Worked for…" wrapper, which
  // would nest a "Thought" summary around a "Thought" disclosure. Render the
  // single merged thought directly so the chat shows one clean, top-level row.
  if (items.every((item) => item.kind === "reasoning")) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        {items.map((item) =>
          item.kind === "reasoning" ? (
            <ReasoningDisclosure key={item.id} block={item.block} active={working || live} />
          ) : null,
        )}
      </div>
    );
  }

  return (
    <details className="group min-w-0" open={expanded}>
      <summary
        className="flex min-h-6 min-w-0 cursor-pointer list-none items-center gap-2 rounded-lg px-1.5 py-0.5 transition-colors hover:bg-(--hover) [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          setUserExpanded(!expanded);
        }}
      >
        <span
          className={`shrink-0 text-[length:var(--fs-base)] font-normal leading-5 ${
            working || live ? "codex-shimmer-text" : "text-(--fg)/55"
          }`}
        >
          {working || live ? "Working" : summary}
        </span>
        {!expanded && (working || live) && preview ? (
          <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--codex-chat-code-font-size)] leading-5 text-(--dim)/70">
            {preview}
          </span>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <ChevronRight className="h-3 w-3 shrink-0 text-(--dim)/50 transition-transform group-open:rotate-90" />
      </summary>
      {expanded ? (
        <div className="mb-1.5 ml-2 mt-1 flex min-w-0 flex-col gap-0.5 border-l border-(--separator) pl-2">
          {items.map((item, index) => {
            const isLastItem = index === items.length - 1;
            if (item.kind === "reasoning") {
              return (
                <ReasoningDisclosure key={item.id} block={item.block} active={live && isLastItem} />
              );
            }
            if (item.kind === "explore") {
              return <ExploreAccordion key={item.id} blocks={item.blocks} live={live} />;
            }
            return <ToolBlockView key={item.id} block={item.block} />;
          })}
        </div>
      ) : null}
    </details>
  );
});
