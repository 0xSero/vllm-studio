import { useState } from "react";
import { useLegacyEffect } from "./use-legacy-effects";

/**
 * Tracks whether a session row is currently being dragged anywhere in the
 * document. The pane grid uses this to gate its invisible edge drop targets so
 * they don't steal clicks from the chat-pane header (e.g. the "..." menu and
 * the right sidebar toggle, both of which sit underneath the top strip).
 */
export function useSessionDragActive(): boolean {
  const [active, setActive] = useState(false);
  useLegacyEffect(() => {
    const onDragStart = (event: DragEvent) => {
      const types = event.dataTransfer?.types;
      if (!types) return;
      const hasSession = Array.from(types).some(
        (type) =>
          type === "application/x-vllm-session" || type === "application/x-vllm-agent-session",
      );
      if (hasSession) setActive(true);
    };
    const stop = () => setActive(false);
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragend", stop);
    document.addEventListener("drop", stop);
    return () => {
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragend", stop);
      document.removeEventListener("drop", stop);
    };
  }, []);
  return active;
}
