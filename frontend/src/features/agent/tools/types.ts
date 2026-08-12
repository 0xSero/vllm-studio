// Tool surface types — split into two pieces:
//
// 1. UI state (workspace-global): which side panel is open, panel width,
//    browser tool toggle, browser URL.
// 2. Per-session selection: which skills/templates the composer has armed for
//    a given session. Lives in a flat map keyed by SessionId so panes /
//    sessions stay independent of tool choice.

import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { ComputerTab } from "@/features/agent/tools/resources";
export type { ComputerTab } from "@/features/agent/tools/resources";

export type BrowserBackend = "embedded" | "sitegeist";

export type BrowserState = {
  enabled: boolean;
  backend: BrowserBackend;
  url: string;
  input: string;
};

export type ComputerState = {
  open: boolean;
  tab: ComputerTab;
  tabs: ComputerTab[];
  width: number;
};

export type FileOpenRequest = {
  id: number;
  path: string;
};

export type ContextAttachRequest = {
  id: number;
  /** Short label shown on the composer chip (e.g. the file name). */
  label: string;
  /** Optional disk path so the attachment dedupes/links to the file. */
  path?: string;
  /** The text injected into the model context. */
  content: string;
};

export type ToolSelection = {
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
};

export const EMPTY_SELECTION: ToolSelection = {
  skills: [],
  promptTemplates: [],
};
