import { useEffect } from "react";
import type { SessionId } from "@/lib/agent/sessions/types";

export function useActiveCanvasSessionEffects({
  sessionId,
  setActiveCanvasSession,
}: {
  sessionId: SessionId | null;
  setActiveCanvasSession: (id: SessionId | null) => void;
}): void {
  useEffect(() => {
    setActiveCanvasSession(sessionId);
  }, [sessionId, setActiveCanvasSession]);
}
