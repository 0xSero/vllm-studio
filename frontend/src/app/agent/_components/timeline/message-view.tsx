import type { ChatMessage } from "@/lib/agent/session";
import { SessionPaneBlockRouter } from "./session-pane-block-router";

export function MessageView({ message, live = false }: { message: ChatMessage; live?: boolean }) {
  return <SessionPaneBlockRouter message={message} live={live} />;
}
