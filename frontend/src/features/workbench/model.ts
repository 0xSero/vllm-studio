import type { OpenAgentSession } from "@/features/agent/session-index";
import type { ComputerTab } from "@/features/agent/tools/types";

export type RenderedWorkbenchTab = {
  id: string;
  kind: "task" | "tool";
  title: string;
  resourceId: string;
  groupId: string;
  groupTitle: string;
  href?: string;
  projectId?: string;
  sessionId?: string;
  threadId?: string;
  tool?: ComputerTab;
  status?: string;
};

export const COMPUTER_TAB_TITLES: Record<ComputerTab, string> = {
  "side-chat": "Side chat",
  browser: "Browser",
  files: "Files",
  diff: "Review",
  terminal: "Terminal",
};

export function taskTab(session: OpenAgentSession): RenderedWorkbenchTab {
  const identity = session.threadId ?? session.id;
  const title = session.title.trim() || "New task";
  const query = new URLSearchParams({ project: session.projectId, replace: "1" });
  if (session.threadId) query.set("session", session.threadId);
  return {
    id: `task:${identity}`,
    kind: "task",
    title: "Chat",
    resourceId: session.id,
    groupId: `thread:${identity}`,
    groupTitle: title,
    href: `/agent?${query.toString()}`,
    projectId: session.projectId,
    sessionId: session.id,
    ...(session.threadId ? { threadId: session.threadId } : {}),
    status: session.status,
  };
}

export function emptyTaskTab(projectId?: string | null): RenderedWorkbenchTab {
  const scope = projectId?.trim() || "workspace";
  const groupTitle = projectId === "chats" ? "New chat" : "New task";
  const query = new URLSearchParams({ new: "1", replace: "1" });
  if (projectId) query.set("project", projectId);
  return {
    id: `task:new:${scope}`,
    kind: "task",
    title: "Chat",
    resourceId: "new",
    groupId: `new:${scope}`,
    groupTitle,
    href: `/agent?${query.toString()}`,
    ...(projectId ? { projectId } : {}),
  };
}
