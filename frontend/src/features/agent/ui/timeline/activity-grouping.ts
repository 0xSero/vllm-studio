import type {
  AssistantBlock,
  EventBlock,
  TextBlock,
  ThinkingBlock,
  ToolBlock,
} from "@/features/agent/messages";
import {
  classifyTool,
  toolArg,
  toolVerb,
  compactToolText,
} from "@/features/agent/ui/timeline/tool-metadata";

export type ActivitySegment =
  | { kind: "reasoning"; id: string; blocks: ThinkingBlock[] }
  | { kind: "tools"; id: string; blocks: ToolBlock[] };

export type RoutedBlock =
  | { kind: "activity-group"; id: string; segments: ActivitySegment[] }
  | { kind: "content"; block: TextBlock }
  | { kind: "event"; block: EventBlock };

export type ActivityItem =
  | { kind: "reasoning"; id: string; block: ThinkingBlock }
  | { kind: "tool"; id: string; block: ToolBlock }
  | { kind: "explore"; id: string; blocks: ToolBlock[] };

// Every run of thinking + tool blocks between two content/event blocks folds
// into ONE activity-group whose segments stay in chronological order. The group
// renders as a single Codex-style "Worked for…" disclosure — reasoning never
// gets its own top-level row, so the chat alternates cleanly between answer text
// and one collapsible work summary. Ids derive from the first underlying block
// so collapse state survives snapshot rebuilds and ordering normalization.
export function groupAssistantBlocks(blocks: AssistantBlock[]): RoutedBlock[] {
  const routed: RoutedBlock[] = [];
  let segments: ActivitySegment[] = [];
  let reasoning: ThinkingBlock[] = [];
  let tools: ToolBlock[] = [];

  const flushReasoning = () => {
    if (reasoning.length === 0) return;
    segments.push({
      kind: "reasoning",
      id: `reasoning-seg-${reasoning[0]?.id ?? segments.length}`,
      blocks: reasoning,
    });
    reasoning = [];
  };
  const flushTools = () => {
    if (tools.length === 0) return;
    segments.push({
      kind: "tools",
      id: `tools-seg-${tools[0]?.id ?? segments.length}`,
      blocks: tools,
    });
    tools = [];
  };
  const flushActivity = () => {
    flushReasoning();
    flushTools();
    if (segments.length === 0) return;
    routed.push({
      kind: "activity-group",
      id: `activity-${segments[0]?.id ?? routed.length}`,
      segments,
    });
    segments = [];
  };

  for (const block of blocks) {
    if (block.kind === "tool") {
      flushReasoning();
      tools.push(block);
      continue;
    }
    if (block.kind === "thinking") {
      flushTools();
      reasoning.push(block);
      continue;
    }
    if (block.kind === "text" && block.text.trim() === "") {
      // Empty text blocks shouldn't split a run — keep the surrounding activity together.
      continue;
    }
    flushActivity();
    if (block.kind === "text") {
      routed.push({ kind: "content", block });
    } else {
      routed.push({ kind: "event", block });
    }
  }
  flushActivity();

  return routed;
}

// A reasoning segment is one continuous burst of model chain-of-thought (no
// tools between). Some backends stream it as MANY tiny thinking blocks, and a
// reasoning model can leak stub fragments (e.g. a lone "The") or empty parts,
// which previously rendered as a stack of duplicate, nested "Thought" rows.
// Collapse the whole burst into ONE disclosure: drop empties and consecutive
// duplicates, then join the distinct fragments.
export function mergeReasoningBlocks(blocks: ThinkingBlock[]): ThinkingBlock | null {
  const parts: string[] = [];
  for (const block of blocks) {
    const text = block.text.trim();
    if (!text || parts[parts.length - 1] === text) continue;
    parts.push(text);
  }
  if (parts.length === 0) return null;
  return { kind: "thinking", id: blocks[0]?.id ?? "reasoning", text: parts.join("\n\n") };
}

export function buildActivityItems(segments: ActivitySegment[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const segment of segments) {
    if (segment.kind === "reasoning") {
      const merged = mergeReasoningBlocks(segment.blocks);
      if (merged) items.push({ kind: "reasoning", id: merged.id, block: merged });
      continue;
    }
    let run: ToolBlock[] = [];
    const flushRun = () => {
      if (run.length >= 2) {
        items.push({ kind: "explore", id: `explore-${run[0]?.id}`, blocks: run });
      } else {
        for (const block of run) items.push({ kind: "tool", id: block.id, block });
      }
      run = [];
    };
    for (const block of segment.blocks) {
      const kind = classifyTool(block);
      if (kind === "read" || kind === "search") {
        run.push(block);
        continue;
      }
      flushRun();
      items.push({ kind: "tool", id: block.id, block });
    }
    flushRun();
  }
  return items;
}

/* Codex's collapsed-turn summary: tool counts joined with " · ", first segment
   capitalized — "Ran 3 commands · edited 2 files · searched 4 times". */
export function summarizeActivity(segments: ActivitySegment[]): string {
  let thoughts = 0;
  const counts: Record<string, number> = {};
  for (const segment of segments) {
    if (segment.kind === "reasoning") {
      thoughts += segment.blocks.length;
      continue;
    }
    for (const block of segment.blocks) {
      const kind = classifyTool(block);
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  }
  const pieces: string[] = [];
  const add = (count: number | undefined, verb: string, singular: string, plural: string) => {
    if (!count) return;
    pieces.push(`${verb} ${count} ${count === 1 ? singular : plural}`);
  };
  add(counts["exec"], "ran", "command", "commands");
  add(counts["edit"], "edited", "file", "files");
  add(counts["read"], "read", "file", "files");
  add(counts["search"], "searched", "time", "times");
  add(counts["browser"], "browsed", "page", "pages");
  add(counts["generic"], "called", "tool", "tools");
  if (pieces.length === 0) return thoughts > 0 ? "Thought" : "Worked";
  const joined = pieces.join(" · ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/* Latest in-flight action, for the live preview in the collapsed summary.
   Reasoning is deliberately excluded — model chain-of-thought should never
   leak into the visible chat, even as a one-line preview; the user can still
   expand the activity group to read it if they want. */
export function activityPreview(segments: ActivitySegment[]): string | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment || segment.kind === "reasoning") continue;
    const runningTool = [...segment.blocks].reverse().find((block) => block.status === "running");
    const latestTool = runningTool ?? segment.blocks[segment.blocks.length - 1];
    if (latestTool) {
      const detail = toolArg(latestTool, ["cmd", "command", "path", "file_path", "query", "url"]);
      return [toolVerb(latestTool), compactToolText(detail, 72)].filter(Boolean).join(" ");
    }
  }
  return null;
}

export function exploreCounts(blocks: ToolBlock[]): string {
  let files = 0;
  let searches = 0;
  for (const block of blocks) {
    if (classifyTool(block) === "search") searches += 1;
    else files += 1;
  }
  const pieces: string[] = [];
  if (files > 0) pieces.push(`${files} ${files === 1 ? "file" : "files"}`);
  if (searches > 0) pieces.push(`${searches} ${searches === 1 ? "search" : "searches"}`);
  return pieces.join(", ");
}

export function assistantContentCopyText(blocks: AssistantBlock[]): string {
  return blocks
    .map((block) => (block.kind === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
}
