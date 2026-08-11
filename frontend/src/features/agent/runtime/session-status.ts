import type { AssistantBlock } from "@/features/agent/messages";
import type { Session } from "./types";

const WORKING_SESSION_STATUSES: readonly string[] = ["starting", "running", "stopping", "loading"];

export function isWorkingStatus(status: string): boolean {
  return WORKING_SESSION_STATUSES.includes(status);
}

export function settleTurn(session: Session): Session {
  return { ...session, status: "idle", activeAssistantId: undefined };
}

function finalizeRunningToolBlocks(blocks: AssistantBlock[]): AssistantBlock[] {
  return blocks.map((block) =>
    block.kind === "tool" && block.status === "running" ? { ...block, status: "done" } : block,
  );
}

export function settleTurnFinalizingTools(session: Session): Session {
  return {
    ...settleTurn(session),
    messages: session.messages.map((message) =>
      message.role === "assistant" && message.blocks
        ? { ...message, blocks: finalizeRunningToolBlocks(message.blocks) }
        : message,
    ),
  };
}
