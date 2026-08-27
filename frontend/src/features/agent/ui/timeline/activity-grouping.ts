import type {
  AssistantBlock,
  EventBlock,
  TextBlock,
  ThinkingBlock,
  ToolBlock,
} from "@/features/agent/messages";
import {
  goalOutcomeFromText,
  stripGoalSentinels,
  type GoalOutcome,
} from "@shared/agent/goal-protocol";

export type ActivitySegment =
  | { kind: "reasoning"; id: string; blocks: ThinkingBlock[] }
  | { kind: "tools"; id: string; blocks: ToolBlock[] };

export type RoutedBlock =
  | { kind: "activity-group"; id: string; segments: ActivitySegment[] }
  | { kind: "content"; block: TextBlock }
  | { kind: "event"; block: EventBlock };

// Every run of thinking + tool blocks between two content/event blocks folds
// into ONE activity-group whose segments stay in chronological order. The group
// renders as a single Codex-style "Worked for…" disclosure — reasoning never
// gets its own top-level row, so the chat alternates cleanly between answer text
// and one collapsible work summary. Ids derive from the first underlying block
// so collapse state survives snapshot rebuilds and ordering normalization.
export function groupAssistantBlocks(inputBlocks: AssistantBlock[]): RoutedBlock[] {
  const blocks = withGoalOutcomeMarkers(inputBlocks);
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

export function assistantContentCopyText(blocks: AssistantBlock[]): string {
  return withGoalOutcomeMarkers(blocks)
    .map((block) => (block.kind === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
}

// GOAL_COMPLETE / GOAL_BLOCKED are how the model reports a goal outcome to the
// driver. They are protocol, not prose, and used to render verbatim in the
// bubble. Strip them out of the text and re-emit the outcome as an event block,
// which the timeline already draws as a hairline marker row — a transition
// should be a line, never a bubble.
//
// This runs on every streamed frame, so it must not manufacture array or block
// identities: an unchanged transcript returns the very same array, and only the
// text block that actually carried a sentinel is rebuilt.
function withGoalOutcomeMarkers(blocks: AssistantBlock[]): AssistantBlock[] {
  let changed = false;
  const next: AssistantBlock[] = [];
  for (const block of blocks) {
    if (block.kind !== "text") {
      next.push(block);
      continue;
    }
    const stripped = stripGoalSentinels(block.text);
    if (stripped === block.text) {
      next.push(block);
      continue;
    }
    changed = true;
    next.push({ ...block, text: stripped });
    const outcome = goalOutcomeFromText(block.text);
    if (outcome)
      next.push({ kind: "event", id: `${block.id}-goal`, text: goalMarkerText(outcome) });
  }
  return changed ? next : blocks;
}

function goalMarkerText(outcome: GoalOutcome): string {
  if (outcome.kind === "complete") return "Goal complete";
  return outcome.reason ? `Goal blocked — ${outcome.reason}` : "Goal blocked";
}
