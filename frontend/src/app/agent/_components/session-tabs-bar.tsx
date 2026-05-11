"use client";

import { useCallback, useState } from "react";
import { CloseIcon } from "@/components/icons";
import { makeFreshTab, type SessionTab } from "./chat-pane";

export function SessionTabsBar({
  paneId,
  tabs,
  activeTabId,
  onActiveTabChange,
  onTabsChange,
  onRenameTab,
}: {
  paneId: string;
  tabs: SessionTab[];
  activeTabId: string;
  onActiveTabChange: (tabId: string) => void;
  onTabsChange: (tabs: SessionTab[] | ((tabs: SessionTab[]) => SessionTab[])) => void;
  onRenameTab: (tabId: string, title: string) => void;
}) {
  const closeTab = useCallback(
    (tabId: string) => {
      const remaining = tabs.filter((tab) => tab.id !== tabId);
      if (remaining.length === 0) {
        const fresh = makeFreshTab();
        onTabsChange([fresh]);
        onActiveTabChange(fresh.id);
        return;
      }
      onTabsChange(remaining);
      if (activeTabId === tabId) onActiveTabChange(remaining[remaining.length - 1].id);
    },
    [tabs, activeTabId, onTabsChange, onActiveTabChange],
  );

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => (
        <TabPill
          key={tab.id}
          tab={tab}
          paneId={paneId}
          active={tab.id === activeTabId}
          onSelect={() => onActiveTabChange(tab.id)}
          onClose={() => closeTab(tab.id)}
          onRename={(title) => onRenameTab(tab.id, title)}
        />
      ))}
    </div>
  );
}

function TabPill({
  tab,
  paneId,
  active,
  onSelect,
  onClose,
  onRename,
}: {
  tab: SessionTab;
  paneId: string;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (title: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(tab.title);

  const finishRename = useCallback(() => {
    const next = draft.trim();
    if (next) onRename(next.slice(0, 80));
    setRenaming(false);
  }, [draft, onRename]);

  return (
    <div
      role="tab"
      aria-selected={active}
      draggable
      onDragStart={(event) => {
        if (tab.piSessionId) {
          event.dataTransfer.setData("application/x-vllm-session", tab.piSessionId);
        }
        event.dataTransfer.setData(
          "application/x-vllm-agent-session",
          JSON.stringify({
            piSessionId: tab.piSessionId,
            projectId: tab.projectId,
            cwd: tab.cwd,
            paneId,
            tabId: tab.id,
            title: tab.title,
          }),
        );
        event.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onSelect}
      onDoubleClick={(event) => {
        event.stopPropagation();
        setDraft(tab.title);
        setRenaming(true);
      }}
      title={tab.title}
      className={`group flex h-7 max-w-[200px] shrink-0 cursor-pointer items-center gap-1 rounded-md border px-2 text-xs ${
        active
          ? "border-(--border) bg-(--bg) text-(--fg)"
          : "border-transparent text-(--dim) hover:bg-(--bg) hover:text-(--fg)"
      }`}
    >
      {renaming ? (
        <input
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={finishRename}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishRename();
            if (event.key === "Escape") {
              setDraft(tab.title);
              setRenaming(false);
            }
          }}
          className="min-w-0 bg-transparent outline-none"
        />
      ) : (
        <span className="truncate">{tab.title}</span>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="rounded p-0.5 text-(--dim) opacity-0 hover:bg-(--surface) hover:text-(--fg) group-hover:opacity-100"
        aria-label="Close tab"
        title="Close tab"
      >
        <CloseIcon className="h-3 w-3" />
      </button>
    </div>
  );
}
