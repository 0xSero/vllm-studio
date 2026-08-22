import { memo, useMemo } from "react";
import type { AssistantBlock, ChatMessage, EventBlock, TextBlock } from "@/features/agent/messages";
import { traceAgentReasoning } from "@/features/agent/trace-reasoning";
import { AssistantMarkdown } from "@/features/agent/ui/assistant-markdown";
import { AssistantActivityGroup } from "@/features/agent/ui/timeline/assistant-activity-group";
import { AssistantMessageActions } from "@/features/agent/ui/timeline/assistant-message-actions";
import { UserMessage } from "@/features/agent/ui/timeline/user-message-block";
import {
  assistantContentCopyText,
  groupAssistantBlocks,
} from "@/features/agent/ui/timeline/activity-grouping";

// Per-content-block memo. `appendDelta` preserves the reference of every
// non-trailing text block during streaming, so prior content blocks skip
// re-rendering entirely once the assistant moves on past them.
const MemoContentBlock = memo(function MemoContentBlock({
  block,
  cwd,
}: {
  block: TextBlock;
  cwd: string | null;
}) {
  return <AssistantMarkdown text={block.text} cwd={cwd} />;
});

const MemoEventBlock = memo(function MemoEventBlock({ block }: { block: EventBlock }) {
  return (
    <div className="flex items-center gap-3 py-1 text-[length:var(--fs-sm)] text-(--fg)/35">
      <span className="h-px flex-1 bg-(--separator)" />
      <span>{block.text}</span>
      <span className="h-px flex-1 bg-(--separator)" />
    </div>
  );
});

const EMPTY_BLOCKS: AssistantBlock[] = [];

// `AssistantBlocks` isolates the (memoised) routed-block computation so that
// re-renders triggered by non-block message fields (e.g. `text`, `timestamp`,
// `attachments`) don't redo `groupAssistantBlocks`. Re-runs only on a new
// `blocks` array identity — which `appendDelta` only produces when the
// assistant actually mutates a block.
const AssistantBlocks = memo(function AssistantBlocks({
  blocks,
  live,
  running,
  cwd,
  onForkSession,
}: {
  blocks: AssistantBlock[];
  live: boolean;
  running: boolean;
  cwd: string | null;
  onForkSession?: () => void;
}) {
  const routedBlocks = useMemo(() => groupAssistantBlocks(blocks), [blocks]);
  traceAgentReasoning("render.blocks", { blocks, routedBlocks });
  const copyText = useMemo(() => assistantContentCopyText(blocks), [blocks]);
  const lastContentIndex = useMemo(
    () => routedBlocks.findLastIndex((item) => item.kind === "content"),
    [routedBlocks],
  );
  const showActions = !running && copyText.trim().length > 0 && lastContentIndex >= 0;

  if (routedBlocks.length === 0) {
    return <article className="min-w-0" />;
  }

  return (
    <article className="min-w-0">
      <div className="flex flex-col gap-3">
        {routedBlocks.map((item, index) => {
          if (item.kind === "activity-group") {
            return (
              <AssistantActivityGroup
                key={item.id}
                segments={item.segments}
                live={live && index === routedBlocks.length - 1}
              />
            );
          }
          if (item.kind === "event") {
            return <MemoEventBlock key={item.block.id} block={item.block} />;
          }
          return (
            <div key={item.block.id} className="min-w-0">
              <MemoContentBlock block={item.block} cwd={cwd} />
              {showActions && index === lastContentIndex ? (
                <AssistantMessageActions copyText={copyText} onForkSession={onForkSession} />
              ) : null}
            </div>
          );
        })}
      </div>
    </article>
  );
});

export const SessionPaneBlockRouter = memo(function SessionPaneBlockRouter({
  message,
  live,
  running,
  cwd,
  onForkSession,
}: {
  message: ChatMessage;
  live: boolean;
  running: boolean;
  cwd: string | null;
  onForkSession?: () => void;
}) {
  if (message.role === "user") {
    return <UserMessage message={message} />;
  }

  return (
    <AssistantBlocks
      blocks={message.blocks ?? EMPTY_BLOCKS}
      live={live}
      running={running}
      cwd={cwd}
      onForkSession={onForkSession}
    />
  );
});
