"use client";

import { useMemo } from "react";
import {
  byQuery,
  type ComposerMention,
  type ComposerPluginRef,
  type ComposerPromptTemplateRef,
  type ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { FileMentionRow, MentionRow } from "@/features/agent/ui/agent-composer-context";

type UseComposerMentionRowsOptions = {
  fileMentionRows: FileMentionRow[];
  mention: ComposerMention | null;
  pluginRows: ComposerPluginRef[];
  promptTemplateRows: ComposerPromptTemplateRef[];
  skillRows: ComposerSkillRef[];
};

export function useComposerMentionRows({
  fileMentionRows,
  mention,
  pluginRows,
  promptTemplateRows,
  skillRows,
}: UseComposerMentionRowsOptions): MentionRow[] {
  return useMemo<MentionRow[]>(() => {
    if (!mention) return [];
    if (mention.kind === "skill") {
      return byQuery(skillRows, mention.query, 8).map((row) => ({ kind: "skill", row }));
    }
    if (mention.kind === "promptTemplate") {
      return byQuery(promptTemplateRows, mention.query, 8).map((row) => ({
        kind: "promptTemplate" as const,
        row,
      }));
    }
    const plugins = byQuery(pluginRows, mention.query, 5).map((row) => ({
      kind: "plugin" as const,
      row,
    }));
    const q = mention.query.trim().toLowerCase();
    const files = fileMentionRows
      .filter(
        (row) => !q || row.rel.toLowerCase().includes(q) || row.name.toLowerCase().includes(q),
      )
      .slice(0, 5)
      .map((row) => ({ kind: "file" as const, row }));
    return [...plugins, ...files].slice(0, 8);
  }, [fileMentionRows, mention, pluginRows, promptTemplateRows, skillRows]);
}
