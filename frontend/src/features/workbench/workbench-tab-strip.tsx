"use client";

import { Effect } from "effect";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Menu, Plus } from "@/ui/icon-registry";
import { uniqueOpenSessions, useOpenSessions } from "@/features/agent/session-index";
import { useProjects } from "@/features/agent/projects/context";
import { CHATS_PROJECT_ID } from "@/features/agent/projects/types";
import { useComputerTools, useToolsActions } from "@/features/agent/tools/context";
import { workspaceCommands } from "@/features/agent/workspace/commands";
import { hrefWithOpenNonce } from "@/features/agent/ui/projects-nav/helpers";
import { emptyTaskTab, taskTab, type RenderedWorkbenchTab } from "@/features/workbench/model";
import {
  WorkbenchLauncher,
  WorkbenchProjectTabList,
} from "@/features/workbench/workbench-tab-components";
import {
  resolveWorkbenchNavigation,
  sessionForTab,
} from "@/features/workbench/workbench-tab-helpers";
import { clearKeyboardTabFocus, requestKeyboardTabFocus } from "@/features/workbench/focus-handoff";
import {
  dispatchWorkbenchCommand,
  useWorkbenchPreferences,
  useWorkbenchProjection,
} from "@/features/workbench/controller-state";
import { useAppStore } from "@/store";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { ComputerTab } from "@/features/agent/tools/types";
import type {
  WorkbenchResourceKind,
  WorkbenchTab as ControllerTab,
} from "@local-studio/contracts/workbench";

const TOOL_KIND: Record<ComputerTab, WorkbenchResourceKind> = {
  "side-chat": "chat",
  browser: "browser",
  files: "explorer",
  diff: "diff",
  terminal: "terminal",
};

const KIND_TOOL: Partial<Record<WorkbenchResourceKind, ComputerTab>> = {
  chat: "side-chat",
  browser: "browser",
  file: "files",
  explorer: "files",
  diff: "diff",
  terminal: "terminal",
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function taskIdentity(
  focusedSession: { id: string; threadId: string | null } | null | undefined,
  requestedSessionId: string | null,
): string | null {
  for (const candidate of [focusedSession?.id, requestedSessionId]) {
    if (candidate) return candidate;
  }
  return null;
}

function legacyTab(
  tab: ControllerTab,
  scope: RenderedWorkbenchTab,
  status: string | undefined,
): RenderedWorkbenchTab {
  const mainChat = tab.kind === "chat" && !tab.closable;
  const tool = mainChat ? undefined : KIND_TOOL[tab.kind];
  return {
    id: tab.id,
    kind: mainChat ? "task" : "tool",
    title: tab.title,
    resourceId: tab.resourceId,
    groupId: `task:${tab.taskId}`,
    groupTitle: scope.groupTitle,
    ...(scope.href ? { href: scope.href } : {}),
    ...(scope.projectId ? { projectId: scope.projectId } : {}),
    ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
    ...(scope.threadId ? { threadId: scope.threadId } : {}),
    ...(tool ? { tool } : {}),
    ...(status ? { status } : {}),
  };
}

export function WorkbenchTabStrip() {
  const searchParams = useSearchParams();
  const projects = useProjects();
  const projectId = searchParams.get("project") ?? projects.selectedProjectId;
  if (projectId === CHATS_PROJECT_ID) return null;
  return <ProjectWorkbenchTabStrip />;
}

function ProjectWorkbenchTabStrip() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const setMobileNavOpen = useAppStore((store) => store.setMobileNavOpen);
  const sidebarExpanded = useWorkbenchPreferences().sidebarPinnedOpen;
  const projection = useWorkbenchProjection();
  const projects = useProjects();
  const computer = useComputerTools();
  const tools = useToolsActions();
  const allOpenSessions = useOpenSessions();
  const openSessions = useMemo(() => uniqueOpenSessions(allOpenSessions), [allOpenSessions]);
  const { focusedSession, currentProjectId, requestedSessionId, navigationKey } =
    resolveWorkbenchNavigation(searchParams, openSessions, projects.selectedProjectId);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: "before" | "after";
  } | null>(null);
  const launcherRef = useRef<HTMLDivElement | null>(null);
  const draggedTabRef = useRef<string | null>(null);
  const tabElementsRef = useRef(new Map<string, HTMLButtonElement>());
  const projectNames = new Map(projects.projects.map((project) => [project.id, project.name]));
  const taskId = taskIdentity(focusedSession, requestedSessionId);
  const navigationTask = focusedSession ? taskTab(focusedSession) : emptyTaskTab(currentProjectId);
  const taskState = taskId ? projection.tasks.find((task) => task.id === taskId) : undefined;
  const controllerWorkbench =
    taskId && projection.workbench?.taskId === taskId ? projection.workbench : undefined;
  const controllerTabs = controllerWorkbench?.tabs ?? [];
  const controllerTabsById = new Map(controllerTabs.map((tab) => [tab.id, tab]));
  const orderedTabs = controllerTabs.length
    ? controllerTabs.map((tab) => legacyTab(tab, navigationTask, focusedSession?.status))
    : [navigationTask];
  const activeTabId = controllerWorkbench?.activeTabId ?? orderedTabs[0]?.id ?? null;
  const activeScope = navigationTask;
  const projectName = projectNames.get(activeScope.projectId ?? "workspace") ?? "Workspace";
  const threadTitle = focusedSession?.title || taskState?.title || activeScope.groupTitle;
  const activeControllerTab = controllerTabs.find((tab) => tab.id === activeTabId);

  useMountSubscription(() => {
    if (!taskId || !focusedSession) return;
    if (!taskState) {
      void Effect.runPromise(
        dispatchWorkbenchCommand({
          kind: "ensure_task",
          taskId,
          ...(currentProjectId ? { projectId: currentProjectId } : {}),
          title: focusedSession.title.trim() || "New task",
        }),
      );
      return;
    }
    if (projection.selectedTaskId === taskId) return;
    void Effect.runPromise(
      dispatchWorkbenchCommand({
        kind: "select_task",
        taskId,
      }),
    );
  }, [
    currentProjectId,
    focusedSession?.id,
    navigationKey,
    projection.selectedTaskId,
    taskId,
    taskState,
  ]);

  useMountSubscription(() => {
    const mainChat = activeControllerTab?.kind === "chat" && !activeControllerTab.closable;
    const tool = activeControllerTab && !mainChat ? KIND_TOOL[activeControllerTab.kind] : undefined;
    if (!tool) {
      tools.setComputerOpen(false);
      return;
    }
    if (activeControllerTab?.kind === "file") {
      tools.showFileResource(activeControllerTab.resourceId);
      return;
    }
    tools.setComputerTab(tool);
  }, [activeControllerTab?.id, activeControllerTab?.kind, activeControllerTab?.closable, taskId]);

  const activateTab = (tab: RenderedWorkbenchTab, origin: "pointer" | "keyboard" = "pointer") => {
    if (origin === "pointer") clearKeyboardTabFocus();
    setLauncherOpen(false);
    const controllerTab = controllerTabsById.get(tab.id);
    if (taskId && controllerTab) {
      void Effect.runPromise(
        dispatchWorkbenchCommand({
          kind: "select_tab",
          taskId,
          tabId: tab.id,
        }),
      );
    }
    if (tab.kind === "task") {
      const session = sessionForTab(tab, openSessions);
      if (session && !session.focused) {
        workspaceCommands().focusSession(session.paneId, session.id, { replaceWorkspace: true });
      }
      if (tab.href && (!session || !session.focused)) router.push(hrefWithOpenNonce(tab.href));
      return;
    }
    if (!tab.tool || !taskId || !controllerTab) return;
    const session = sessionForTab(tab, openSessions);
    if (session && !session.focused) {
      workspaceCommands().focusSession(session.paneId, session.id, { replaceWorkspace: true });
      if (tab.href) router.replace(hrefWithOpenNonce(tab.href));
    }
  };

  const openTool = (tool: ComputerTab) => {
    if (!taskId || !focusedSession) return;
    const kind = TOOL_KIND[tool];
    const unique = tool === "terminal" || tool === "side-chat";
    const resourceId = unique ? crypto.randomUUID() : tool;
    const tabId = `${kind}:${taskId}:${resourceId}`;
    void Effect.runPromise(
      Effect.gen(function* () {
        if (!taskState) {
          yield* dispatchWorkbenchCommand({
            kind: "ensure_task",
            taskId,
            ...(currentProjectId ? { projectId: currentProjectId } : {}),
            title: focusedSession.title.trim() || "New task",
          });
        }
        yield* dispatchWorkbenchCommand({
          kind: "open_tab",
          taskId,
          tabId,
          resourceKind: kind,
          resourceId,
          title:
            tool === "side-chat"
              ? "Side chat"
              : tool === "files"
                ? "Files"
                : tool[0]!.toUpperCase() + tool.slice(1),
          closable: true,
        });
      }),
    );
  };

  const closeTab = (tabId: string) => {
    const controllerTab = controllerTabsById.get(tabId);
    if (!taskId || !controllerTab?.closable) return;
    void Effect.runPromise(
      dispatchWorkbenchCommand({
        kind: "close_tab",
        taskId,
        tabId,
      }),
    );
  };

  const activateAtIndex = (index: number) => {
    const tab = orderedTabs[index];
    if (tab) activateTab(tab);
  };

  const cycleTab = (direction: -1 | 1) => {
    if (orderedTabs.length < 2) return;
    const activeIndex = Math.max(
      0,
      orderedTabs.findIndex((tab) => tab.id === activeTabId),
    );
    const nextIndex = (activeIndex + direction + orderedTabs.length) % orderedTabs.length;
    activateAtIndex(nextIndex);
  };

  const focusTabAtIndex = (index: number) => {
    if (orderedTabs.length === 0) return;
    const bounded = (index + orderedTabs.length) % orderedTabs.length;
    const tab = orderedTabs[bounded];
    if (!tab) return;
    requestKeyboardTabFocus(tab.id);
    activateTab(tab, "keyboard");
    requestAnimationFrame(() => tabElementsRef.current.get(tab.id)?.focus());
  };

  useMountSubscription(() => {
    if (!launcherOpen) return;
    const frame = requestAnimationFrame(() => {
      launcherRef.current?.querySelector<HTMLElement>('input, [role="menuitem"]')?.focus();
    });
    const close = (event: PointerEvent) => {
      if (!launcherRef.current?.contains(event.target as Node)) setLauncherOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", close);
    };
  }, [launcherOpen]);

  useMountSubscription(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (!event.shiftKey && /^[1-9]$/.test(key)) {
        event.preventDefault();
        activateAtIndex(Number(key) - 1);
      } else if (!event.shiftKey && key === "w") {
        const active = activeTabId ? controllerTabsById.get(activeTabId) : undefined;
        if (active?.closable) {
          event.preventDefault();
          closeTab(active.id);
        }
      } else if (event.shiftKey && (event.code === "BracketLeft" || event.key === "{")) {
        event.preventDefault();
        cycleTab(-1);
      } else if (event.shiftKey && (event.code === "BracketRight" || event.key === "}")) {
        event.preventDefault();
        cycleTab(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTabId, currentProjectId, navigationKey, orderedTabs.map((tab) => tab.id).join("\0")]);

  const dropTab = (
    event: DragEvent<HTMLDivElement>,
    targetId: string,
    position: "before" | "after",
  ) => {
    event.preventDefault();
    const tabId = draggedTabRef.current;
    draggedTabRef.current = null;
    setDraggedTabId(null);
    setDropTarget(null);
    if (!taskId || !tabId || tabId === targetId) return;
    const targetIndex = orderedTabs.findIndex((tab) => tab.id === targetId);
    const nextTarget =
      position === "after" ? (orderedTabs[targetIndex + 1]?.id ?? undefined) : targetId;
    void Effect.runPromise(
      dispatchWorkbenchCommand({
        kind: "move_tab",
        taskId,
        tabId,
        ...(nextTarget ? { targetId: nextTarget } : {}),
      }),
    );
  };

  return (
    <header className="workbench-tab-strip relative flex h-[var(--workbench-tab-height)] shrink-0 border-b border-(--border) bg-(--color-header)">
      <button
        type="button"
        data-ui-control="compact"
        onClick={() => setMobileNavOpen(true)}
        className="flex h-full w-8 shrink-0 items-center justify-center border-r border-(--border) text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg) md:hidden"
        aria-label="Open navigation menu"
        aria-controls="mobile-navigation-drawer"
      >
        <Menu className="h-3.5 w-3.5" />
      </button>
      <WorkbenchProjectTabList
        projectName={projectName}
        threadTitle={threadTitle}
        sidebarCollapsed={!sidebarExpanded}
        orderedTabs={orderedTabs}
        activeId={activeTabId}
        onActivate={activateTab}
        onClose={closeTab}
        onFocusTab={focusTabAtIndex}
        onDragStart={(tabId) => {
          draggedTabRef.current = tabId;
          setDraggedTabId(tabId);
        }}
        onDragEnd={() => {
          draggedTabRef.current = null;
          setDraggedTabId(null);
          setDropTarget(null);
        }}
        onDragOver={(id, position) => setDropTarget({ id, position })}
        onDrop={dropTab}
        draggedId={draggedTabId}
        dropTarget={dropTarget}
        register={(tabId, element) => {
          if (element) tabElementsRef.current.set(tabId, element);
          else tabElementsRef.current.delete(tabId);
        }}
      />
      <div
        ref={launcherRef}
        className="relative flex shrink-0 items-center border-l border-(--border)"
      >
        <button
          type="button"
          data-ui-control="compact"
          onClick={() => setLauncherOpen((open) => !open)}
          className="flex h-full w-8 items-center justify-center text-(--dim) transition-colors duration-[var(--motion-fast)] hover:bg-(--hover) hover:text-(--fg)"
          aria-label="Open tool tab"
          title="Open tool tab"
          aria-expanded={launcherOpen}
          aria-haspopup="menu"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        {launcherOpen ? (
          <WorkbenchLauncher
            onOpenTool={(tool) => {
              openTool(tool);
              setLauncherOpen(false);
            }}
            onDismiss={() => {
              setLauncherOpen(false);
            }}
          />
        ) : null}
      </div>
    </header>
  );
}
