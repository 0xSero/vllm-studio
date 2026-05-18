import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { FileIcon } from "@/components/icons";
import type {
  AssistantBlock,
  ChatMessageAttachment,
  ChatMessage,
  EventBlock,
  TextBlock,
  ThinkingBlock,
  ToolBlock,
} from "@/lib/agent/session";
import { AssistantMarkdown } from "../assistant-markdown";
import { ToolBlockView } from "./tool-block-view";
import {
  classifyTool,
  compactToolText,
  fileBasename,
  humanizeToolName,
  toolArg,
} from "./tool-metadata";

type ActivitySegment =
  | { kind: "reasoning"; id: string; blocks: ThinkingBlock[] }
  | { kind: "tools"; id: string; blocks: ToolBlock[] };

type RoutedBlock =
  | { kind: "activity-group"; id: string; segments: ActivitySegment[] }
  | { kind: "content"; block: TextBlock }
  | { kind: "event"; block: EventBlock };

export function groupAssistantBlocks(blocks: AssistantBlock[]): RoutedBlock[] {
  const routed: RoutedBlock[] = [];
  let activitySegments: ActivitySegment[] = [];
  let reasoningGroup: ThinkingBlock[] = [];
  let toolGroup: ToolBlock[] = [];

  const flushReasoningSegment = () => {
    if (reasoningGroup.length === 0) return;
    activitySegments.push({
      kind: "reasoning",
      id: `reasoning-${reasoningGroup[0]?.id ?? routed.length}`,
      blocks: reasoningGroup,
    });
    reasoningGroup = [];
  };

  const flushToolSegment = () => {
    if (toolGroup.length === 0) return;
    activitySegments.push({
      kind: "tools",
      id: `tools-${toolGroup[0]?.id ?? routed.length}`,
      blocks: toolGroup,
    });
    toolGroup = [];
  };

  const flushActivityGroup = () => {
    flushReasoningSegment();
    flushToolSegment();
    if (activitySegments.length === 0) return;
    routed.push({
      kind: "activity-group",
      id: `activity-${activitySegments[0]?.id ?? routed.length}`,
      segments: activitySegments,
    });
    activitySegments = [];
  };

  for (const block of blocks) {
    if (block.kind === "tool") {
      flushReasoningSegment();
      toolGroup.push(block);
      continue;
    }
    if (block.kind === "thinking") {
      flushToolSegment();
      reasoningGroup.push(block);
      continue;
    }
    flushActivityGroup();
    if (block.kind === "text") {
      routed.push({ kind: "content", block });
    } else {
      routed.push({ kind: "event", block });
    }
  }
  flushActivityGroup();

  return routed;
}

export function SessionPaneBlockRouter({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <article className="flex justify-end">
        <div className="max-w-[72%] rounded-xl bg-(--surface) px-3.5 py-2 text-sm leading-6 text-(--fg)">
          {message.text ? (
            <div className="whitespace-pre-wrap break-words">{message.text}</div>
          ) : null}
          {message.attachments?.length ? (
            <div className={message.text ? "mt-2" : ""}>
              <UserMessageAttachments attachments={message.attachments} />
            </div>
          ) : null}
        </div>
      </article>
    );
  }

  const routedBlocks = groupAssistantBlocks(message.blocks ?? []);
  return (
    <article className="min-w-0">
      {routedBlocks.length === 0 ? (
        <div className="text-sm leading-6 text-(--dim)">…</div>
      ) : (
        <div className="flex flex-col gap-3">
          {routedBlocks.map((item) => {
            if (item.kind === "activity-group") {
              return <AssistantActivityGroup key={item.id} segments={item.segments} />;
            }
            if (item.kind === "content") {
              return <AssistantMarkdown key={item.block.id} text={item.block.text} />;
            }
            return <EventBlockView key={item.block.id} block={item.block} />;
          })}
        </div>
      )}
    </article>
  );
}

function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function UserMessageAttachments({ attachments }: { attachments: ChatMessageAttachment[] }) {
  return (
    <div className={messageAttachmentsClassName(attachments.length)}>
      {attachments.map((attachment) => (
        <UserMessageAttachmentPreview key={attachment.id} attachment={attachment} />
      ))}
    </div>
  );
}

function messageAttachmentsClassName(count: number) {
  const base = "grid gap-2";
  return count > 1 ? `${base} sm:grid-cols-2` : base;
}

function UserMessageAttachmentPreview({ attachment }: { attachment: ChatMessageAttachment }) {
  const label = `${attachment.name} · ${attachment.type || "file"} · ${formatAttachmentSize(attachment.size)}`;
  const previewUrl = attachment.previewUrl;
  if (attachment.previewKind === "image" && previewUrl) {
    return (
      <figure className="min-w-0 overflow-hidden rounded-lg bg-black/20">
        <img
          src={previewUrl}
          alt={attachment.name}
          className="max-h-[360px] w-full object-contain"
        />
        <figcaption className="truncate px-2 py-1.5 text-[11px] leading-4 text-(--dim)">
          {label}
        </figcaption>
      </figure>
    );
  }
  if (attachment.previewKind === "video" && previewUrl) {
    return (
      <figure className="min-w-0 overflow-hidden rounded-lg bg-black/20">
        <video src={previewUrl} controls playsInline className="max-h-[360px] w-full bg-black" />
        <figcaption className="truncate px-2 py-1.5 text-[11px] leading-4 text-(--dim)">
          {label}
        </figcaption>
      </figure>
    );
  }
  if (attachment.previewKind === "pdf" && previewUrl) {
    return (
      <figure className="min-w-0 overflow-hidden rounded-lg bg-black/20">
        <iframe
          src={previewUrl}
          title={attachment.name}
          className="h-[360px] w-full border-0 bg-(--bg)"
        />
        <figcaption className="truncate px-2 py-1.5 text-[11px] leading-4 text-(--dim)">
          {label}
        </figcaption>
      </figure>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg bg-black/20 px-2.5 py-2 text-[12px] leading-5 text-(--dim)">
      <FileIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </div>
  );
}

function AssistantActivityGroup({ segments }: { segments: ActivitySegment[] }) {
  const hasActiveTool = segments.some(
    (segment) =>
      segment.kind === "tools" && segment.blocks.some((block) => block.status === "running"),
  );
  const hasError = segments.some(
    (segment) =>
      segment.kind === "tools" && segment.blocks.some((block) => block.status === "error"),
  );
  const [expanded, setExpanded] = useState(false);
  const open = expanded;

  return (
    <details className="group min-w-0" open={open}>
      <summary
        className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-(--fg) hover:bg-(--hover) [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          setExpanded((value) => !value);
        }}
      >
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-(--fg)/70 transition-transform ${open ? "rotate-180" : ""}`}
        />
        <span className="shrink-0 font-medium text-(--fg)/90">{activityLabel(segments)}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-(--fg)/75">
          {activityPreview(segments)}
        </span>
        {hasActiveTool ? (
          <span className="shrink-0 text-[10px] text-(--accent)">running</span>
        ) : hasError ? (
          <span className="shrink-0 text-[10px] text-(--err)">error</span>
        ) : null}
      </summary>
      {open ? (
        <div className="mt-1.5 flex min-w-0 flex-col gap-2">
          {segments.map((segment) =>
            segment.kind === "reasoning" ? (
              <ReasoningBlockContent key={segment.id} blocks={segment.blocks} />
            ) : (
              <ToolBlockStack key={segment.id} blocks={segment.blocks} />
            ),
          )}
        </div>
      ) : null}
    </details>
  );
}

function ReasoningBlockContent({ blocks }: { blocks: ThinkingBlock[] }) {
  const text = blocks.map((block) => block.text).join("\n\n");
  return (
    <div className="text-xs">
      <div className="text-[11px] italic text-(--dim)">
        Reasoning{blocks.length > 1 ? ` · ${blocks.length}` : ""}
      </div>
      <pre className="mt-2 max-w-full whitespace-pre-wrap break-words border-l-2 border-(--border) pl-3 font-mono text-[11px] leading-5 text-(--dim) [overflow-wrap:anywhere]">
        {text}
      </pre>
    </div>
  );
}

function EventBlockView({ block }: { block: EventBlock }) {
  return (
    <div className="flex items-center gap-3 py-1 text-[11px] text-(--dim)">
      <span className="h-px flex-1 bg-(--border)" />
      <span>{block.text}</span>
      <span className="h-px flex-1 bg-(--border)" />
    </div>
  );
}

function ToolBlockStack({ blocks }: { blocks: ToolBlock[] }) {
  return (
    <div className="border-l-2 border-(--border) pl-3">
      {blocks.map((block, index) => (
        <div key={block.id} className="pb-1.5 last:pb-0">
          <div className={index === 0 ? "" : "pt-0.5"}>
            <ToolBlockView block={block} />
          </div>
        </div>
      ))}
    </div>
  );
}

function activityLabel(segments: ActivitySegment[]): string {
  const reasoningCount = segments
    .filter((segment) => segment.kind === "reasoning")
    .reduce((count, segment) => count + segment.blocks.length, 0);
  const toolCount = segments
    .filter((segment) => segment.kind === "tools")
    .reduce((count, segment) => count + segment.blocks.length, 0);
  const pieces = [];
  if (reasoningCount > 0)
    pieces.push(reasoningCount === 1 ? "Reasoning" : `${reasoningCount} reasoning`);
  if (toolCount > 0) pieces.push(toolCount === 1 ? "1 tool" : `${toolCount} tools`);
  return pieces.join(" + ");
}

function activityPreview(segments: ActivitySegment[]): string {
  const tools = segments.flatMap((segment) => (segment.kind === "tools" ? segment.blocks : []));
  if (tools.length > 0) return toolGroupPreview(tools);
  const reasoning = segments
    .flatMap((segment) => (segment.kind === "reasoning" ? segment.blocks : []))
    .map((block) => compactToolText(block.text, 72))
    .filter(Boolean);
  return reasoning.join(" · ");
}

function toolGroupPreview(blocks: ToolBlock[]): string {
  const previewItems = blocks.slice(0, 4).map(toolPreview);
  const remaining = blocks.length - previewItems.length;
  return `${previewItems.join(" · ")}${remaining > 0 ? ` · +${remaining} more` : ""}`;
}

function toolPreview(block: ToolBlock): string {
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
  const basename = fileBasename(path);

  switch (classifyTool(block)) {
    case "edit":
      return basename ? `edit ${basename}` : humanizeToolName(block.name);
    case "read":
      return basename ? `read ${basename}` : humanizeToolName(block.name);
    case "search":
      return compactToolText(query, 42) ? `search ${compactToolText(query, 42)}` : "search";
    case "exec":
      return compactToolText(command, 42) ?? "command";
    case "browser":
      return "browser";
    default:
      return humanizeToolName(block.name);
  }
}
