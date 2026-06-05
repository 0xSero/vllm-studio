"use client";

import { useCallback } from "react";
import type { SessionTab } from "@/lib/agent/session";
import type { ToolsContextValue } from "@/lib/agent/tools/context";

type LoadedContextKind = "plugin" | "skill" | "promptTemplate";

export function useComposerLoadedContext({
  activeTab,
  tools,
}: {
  activeTab: SessionTab | null;
  tools: ToolsContextValue;
}) {
  const activeSelection = tools.selectionFor(activeTab?.id);
  const removeLoadedContext = useCallback(
    (kind: LoadedContextKind, id: string) => {
      if (!activeTab) return;
      const current = tools.selectionFor(activeTab.id);
      tools.setSelection(activeTab.id, {
        plugins:
          kind === "plugin"
            ? current.plugins.filter((plugin) => plugin.id !== id)
            : current.plugins,
        skills:
          kind === "skill" ? current.skills.filter((skill) => skill.id !== id) : current.skills,
        promptTemplates:
          kind === "promptTemplate"
            ? current.promptTemplates.filter((template) => template.id !== id)
            : current.promptTemplates,
      });
    },
    [activeTab, tools],
  );

  return {
    selectedPlugins: activeSelection.plugins,
    selectedSkills: activeSelection.skills,
    selectedPromptTemplates: activeSelection.promptTemplates,
    removeLoadedContext,
  };
}
