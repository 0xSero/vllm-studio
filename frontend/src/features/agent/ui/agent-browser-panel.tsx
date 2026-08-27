"use client";

import { useCallback, useMemo, useState } from "react";
import {
  removePersistentTerminalOwner,
  usePersistentTerminalOwners,
  type TerminalOwnersSnapshot,
} from "@/features/agent/ui/use-persistent-terminal-owners";
import { normalizeBrowserInput } from "@/features/agent/tools/browser-url";
import {
  sanitizeBrowserPaneUrl,
  sanitizeLocalFileUrl,
} from "@/features/agent/sanitize-embedded-browser-url";
import { useTools } from "@/features/agent/tools/context";
import type { Project } from "@/features/agent/projects/types";
import type { Session } from "@/features/agent/runtime/types";
import { makeFreshTab } from "@/features/agent/messages/helpers";
import type { AgentModel } from "@/features/agent/workspace/types";
import { terminalKeysMatch, terminalOwnerFor } from "@/features/agent/terminal-owners";
import { ComputerTabPanel, type SideChatTabsUpdater } from "@/features/agent/ui/computer-tab-panel";
import { PersistentTerminals } from "@/features/agent/ui/persistent-terminals";
import type { WorkspaceHandles } from "@/features/agent/ui/use-workspace";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useWorkbenchProjection } from "@/features/workbench/controller-state";
import { sessionIdFromSubagentResource } from "@/features/agent/ui/subagent-activity";

type AgentBrowserPanelHandles = Pick<
  WorkspaceHandles,
  "updateDetachedSession" | "removeDetachedSession"
>;

type AgentBrowserPanelProps = {
  handles: AgentBrowserPanelHandles;
  activeProject: Project | null;
  focusedSession: Session | null;
  sessions: Session[];
  activeModelId: string;
  activeModel: AgentModel | null;
  models: AgentModel[];
  modelsLoading: boolean;
};

function createSideChatSession(
  activeProject: Project | null,
  focusedSession: Session | null,
  activeModelId: string,
  resourceId?: string,
  resourceTitle?: string,
): Session {
  const tab = makeFreshTab();
  const subagentSessionId = sessionIdFromSubagentResource(resourceId);
  return {
    ...tab,
    ...(resourceId ? { id: subagentSessionId ?? resourceId } : {}),
    title: resourceTitle ?? "Side chat",
    piSessionId: subagentSessionId,
    cwd: focusedSession?.cwd ?? activeProject?.path,
    projectId: focusedSession?.projectId ?? activeProject?.id,
    modelId: focusedSession?.modelId ?? activeModelId,
  };
}

function terminalBridge() {
  return (
    window as unknown as {
      localStudioDesktop?: { terminal?: { closeOwner?: (ownerKey: string) => Promise<void> } };
    }
  ).localStudioDesktop?.terminal;
}

function closePersistedTerminalOwner(ownerKey: string) {
  const owner = removePersistentTerminalOwner(ownerKey);
  if (owner) void terminalBridge()?.closeOwner?.(owner.mountKey);
}

function acceptedBrowserUrl(url: string): string | null {
  return /^file:\/\//i.test(url) ? sanitizeLocalFileUrl(url) : sanitizeBrowserPaneUrl(url);
}

export function AgentBrowserPanel({
  handles,
  activeProject,
  focusedSession,
  sessions,
  activeModelId,
  activeModel,
  models,
  modelsLoading,
}: AgentBrowserPanelProps) {
  const tools = useTools();
  const projection = useWorkbenchProjection();
  const { closeComputerTab, registerComputerTabCloseHandler } = tools;
  const workspaceToolsEnabled =
    activeProject?.id !== "chats" &&
    focusedSession?.projectId !== "chats" &&
    focusedSession?.executionKind !== "chat";
  const activeWorkbenchTab = projection.workbench?.tabs.find(
    (tab) => tab.id === projection.workbench?.activeTabId,
  );
  const sideChatResource =
    activeWorkbenchTab?.kind === "chat" && activeWorkbenchTab.closable
      ? activeWorkbenchTab.resourceId
      : undefined;
  const sideChatScope =
    sideChatResource ?? focusedSession?.id ?? `project:${activeProject?.id ?? "workspace"}`;
  const [sideChatSeeds, setSideChatSeeds] = useState<Record<string, Session>>({});
  const fallbackSideChatSeed = useMemo(
    () =>
      createSideChatSession(
        activeProject,
        focusedSession,
        activeModelId,
        sideChatResource,
        activeWorkbenchTab?.title,
      ),
    [activeModelId, activeProject, activeWorkbenchTab?.title, focusedSession, sideChatResource],
  );
  const sideChatSeed = sideChatSeeds[sideChatScope] ?? fallbackSideChatSeed;
  useMountSubscription(() => {
    setSideChatSeeds((current) =>
      current[sideChatScope] ? current : { ...current, [sideChatScope]: fallbackSideChatSeed },
    );
  }, [fallbackSideChatSeed.id, sideChatScope]);
  const sideChatSession =
    sessions.find((session) => session.id === sideChatSeed.id) ?? sideChatSeed;
  const terminalOwner = useMemo(
    () =>
      workspaceToolsEnabled
        ? terminalOwnerFor(
            activeProject,
            focusedSession,
            activeWorkbenchTab?.kind === "terminal" ? activeWorkbenchTab.resourceId : null,
          )
        : null,
    [activeProject, activeWorkbenchTab, focusedSession, workspaceToolsEnabled],
  );
  const terminalState = usePersistentTerminalOwners(
    tools.computer.open && tools.computer.tab === "terminal",
    terminalOwner,
  );
  const visibleTerminalState = useMemo<TerminalOwnersSnapshot>(() => {
    const owners = terminalOwner
      ? terminalState.owners.filter((owner) =>
          terminalKeysMatch(owner.matchKeys, terminalOwner.matchKeys),
        )
      : [];
    const activeOwnerKey = owners.some((owner) => owner.mountKey === terminalState.activeOwnerKey)
      ? terminalState.activeOwnerKey
      : (owners[0]?.mountKey ?? null);
    return { owners, activeOwnerKey };
  }, [terminalOwner, terminalState]);
  const navigateBrowser = (value: string) => {
    const next = normalizeBrowserInput(value, focusedSession?.cwd ?? activeProject?.path ?? "");
    if (!next) return;
    const accepted = acceptedBrowserUrl(next);
    if (!accepted) return;
    tools.setBrowserUrl(accepted, accepted);
    if (/^file:\/\//i.test(accepted)) return;
    void fetch("/api/agent/browser/navigate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: accepted }),
    }).catch(() => undefined);
  };
  const updateSideChatTabs = useCallback(
    (nextTabsOrUpdater: SideChatTabsUpdater) => {
      handles.updateDetachedSession(sideChatSeed, (current) => {
        const nextTabs =
          typeof nextTabsOrUpdater === "function"
            ? nextTabsOrUpdater([current])
            : nextTabsOrUpdater;
        return nextTabs.at(-1) ?? current;
      });
    },
    [handles, sideChatSeed],
  );
  const renameSideChat = useCallback(
    (tabId: string, title: string) => {
      handles.updateDetachedSession(sideChatSeed, (current) =>
        current.id === tabId ? { ...current, title } : current,
      );
    },
    [handles, sideChatSeed],
  );
  const resetSideChat = useCallback(() => {
    handles.removeDetachedSession(sideChatSeed.id);
    setSideChatSeeds((current) => ({
      ...current,
      [sideChatScope]: createSideChatSession(
        activeProject,
        focusedSession,
        activeModelId,
        sideChatResource,
        activeWorkbenchTab?.title,
      ),
    }));
  }, [
    activeModelId,
    activeProject,
    focusedSession,
    handles,
    sideChatResource,
    activeWorkbenchTab?.title,
    sideChatScope,
    sideChatSeed.id,
  ]);
  const closeSideChat = useCallback(() => closeComputerTab("side-chat"), [closeComputerTab]);
  const closeTerminalTab = useCallback(() => {
    for (const owner of visibleTerminalState.owners) closePersistedTerminalOwner(owner.mountKey);
  }, [visibleTerminalState.owners]);
  useMountSubscription(() => {
    const unregisterSideChat = registerComputerTabCloseHandler("side-chat", resetSideChat);
    const unregisterTerminal = registerComputerTabCloseHandler("terminal", closeTerminalTab);
    return () => {
      unregisterSideChat();
      unregisterTerminal();
    };
  }, [closeTerminalTab, registerComputerTabCloseHandler, resetSideChat]);
  return (
    <section
      className={`agent-computer-panel ${tools.computer.open ? "relative flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col bg-(--color-panel)`}
      tabIndex={-1}
    >
      <ComputerTabPanel
        activeModel={activeModel}
        activeModelId={activeModelId}
        activeProject={activeProject}
        focusedSession={focusedSession}
        models={models}
        modelsLoading={modelsLoading}
        onCloseSideChat={closeSideChat}
        onNavigateBrowser={navigateBrowser}
        onRenameSideChat={renameSideChat}
        onUpdateSideChatTabs={updateSideChatTabs}
        sessions={sessions}
        sideChatSession={sideChatSession}
        tools={tools}
        workspaceToolsEnabled={workspaceToolsEnabled}
      />

      <PersistentTerminals
        active={workspaceToolsEnabled && tools.computer.open && tools.computer.tab === "terminal"}
        activeOwnerKey={visibleTerminalState.activeOwnerKey}
        terminals={terminalState.owners}
      />
    </section>
  );
}
