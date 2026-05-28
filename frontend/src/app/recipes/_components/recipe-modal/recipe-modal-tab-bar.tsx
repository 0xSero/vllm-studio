"use client";

import type { ReactNode } from "react";
import { Code, Cpu, Layers, Sparkles, Terminal, Settings, Zap } from "lucide-react";
import { Tabs } from "@/ui";
import type { RecipeModalTabId } from "./tabs/tab-id";

const tabDefinitions: Array<{ id: RecipeModalTabId; label: string; icon: ReactNode }> = [
  { id: "general", label: "General", icon: <Settings className="h-3 w-3 shrink-0" /> },
  { id: "model", label: "Model", icon: <Layers className="h-3 w-3 shrink-0" /> },
  { id: "resources", label: "Resources", icon: <Cpu className="h-3 w-3 shrink-0" /> },
  { id: "performance", label: "Performance", icon: <Zap className="h-3 w-3 shrink-0" /> },
  { id: "features", label: "Features", icon: <Sparkles className="h-3 w-3 shrink-0" /> },
  { id: "environment", label: "Environment", icon: <Terminal className="h-3 w-3 shrink-0" /> },
  { id: "command", label: "Command", icon: <Code className="h-3 w-3 shrink-0" /> },
];

export function RecipeModalTabBar({
  activeTab,
  onSelectTab,
}: {
  activeTab: RecipeModalTabId;
  onSelectTab: (tab: RecipeModalTabId) => void;
}) {
  return (
    <div className="relative flex min-h-9 shrink-0 items-center gap-1 border-b border-(--ui-border) px-1.5 py-1 text-[11px]">
      <Tabs
        variant="pill"
        items={tabDefinitions}
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        className="min-w-0 flex-1 text-[11px] [&_button]:h-7 [&_button]:px-1.5 [&_button]:py-0 [&_button]:text-[11px]"
      />
    </div>
  );
}
