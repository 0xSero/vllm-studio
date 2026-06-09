import type { Project } from "@/lib/agent/projects/types";
import type { Session, SessionId } from "@/lib/agent/sessions/types";
import type { PaneId, WorkspaceSessionPayload } from "./types";

type SessionPayload = { tab?: Session };

export type OpenNewSessionPayload = SessionPayload & { project?: Project };
export type ReplaySessionPayload = SessionPayload & { piSessionId: string; sessionTitle?: string };
export type ReplaySessionInSplitPayload = ReplaySessionPayload & { paneId?: PaneId };
export type OpenSessionPayloadInPanePayload = SessionPayload & {
  paneId: PaneId;
  payload: WorkspaceSessionPayload;
};
export type SplitPaneWithPayloadPayload = SessionPayload & {
  paneId: PaneId;
  newPaneId?: PaneId;
  direction: "vertical" | "horizontal";
  side: "a" | "b";
  payload: WorkspaceSessionPayload;
};
export type SplitTabPayload = SessionPayload & {
  sourcePaneId: PaneId;
  sourceTabId: SessionId;
  newPaneId?: PaneId;
};
export type UrlNavigationPayload = SessionPayload & {
  key: string;
  project: Project | null;
  sessionId?: string | null;
  sessionTitle?: string;
  newSession?: boolean;
  split?: boolean;
  paneId?: PaneId;
};
