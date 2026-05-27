"use client";

import type { ReactNode } from "react";
import { Code, Cpu, Layers, Sparkles, Terminal, Settings, Zap } from "lucide-react";
import type { RecipeModalTabId } from "./tabs/tab-id";

const tabDefinitions: Array<{ id: RecipeModalTabId; label: string; icon: ReactNode }> = [
  { id: "general", label: "General", icon: <Settings className="h-3.5 w-3.5" /> },
  { id: "model", label: "Model", icon: <Layers className="h-3.5 w-3.5" /> },
  { id: "resources", label: "Resources", icon: <Cpu className="h-3.5 w-3.5" /> },
  { id: "performance", label: "Performance", icon: <Zap className="h-3.5 w-3.5" /> },
  { id: "features", label: "Features", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { id: "environment", label: "Environment", icon: <Terminal className="h-3.5 w-3.5" /> },
  { id: "command", label: "Command", icon: <Code className="h-3.5 w-3.5" /> },
];

export function RecipeModalTabBar({
  activeTab,
  onSelectTab,
}: {
  activeTab: RecipeModalTabId;
  onSelectTab: (tab: RecipeModalTabId) => void;
}) {
  return (
    <div className="flex h-10 shrink-0 gap-1 overflow-x-auto border-b border-(--border) bg-(--bg) px-3 py-1.5">
      {tabDefinitions.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onSelectTab(tab.id)}
          className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
            activeTab === tab.id
              ? "bg-(--surface) text-(--fg)"
              : "text-(--dim) hover:text-(--fg) hover:bg-(--surface)"
          }`}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}
