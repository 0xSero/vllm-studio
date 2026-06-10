import type { ChatMessage } from "@/features/agent/messages";
import { SessionPaneBlockRouter } from "@/features/agent/ui/timeline/session-pane-block-router";

export function MessageView({
  message,
  live = false,
  running = false,
  onForkSession,
}: {
  message: ChatMessage;
  live?: boolean;
  running?: boolean;
  onForkSession?: () => void;
}) {
  return (
    <SessionPaneBlockRouter
      message={message}
      live={live}
      running={running}
      onForkSession={onForkSession}
    />
  );
}
