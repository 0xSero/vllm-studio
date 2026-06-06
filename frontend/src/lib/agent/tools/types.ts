// Tool surface types — split into two pieces:
//
// 1. UI state (workspace-global): which side panel is open, panel width,
//    browser tool toggle, browser URL.
// 2. Per-session selection: which plugins/skills the composer has armed for
//    a given session. Lives in a flat map keyed by SessionId so panes /
//    sessions stay independent of tool choice.

import type {
  ComposerPluginRef,
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/lib/agent/composer-context";
import type { SessionId } from "@/lib/agent/sessions/types";

export type ComputerTab =
  | "status"
  | "tools"
  | "canvas"
  | "side-chat"
  | "browser"
  | "files"
  | "diff"
  | "terminal";

export type BrowserBackend = "embedded" | "parchi";

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
  canvasEnabled: boolean;
  canvasText: string;
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
  plugins: ComposerPluginRef[];
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
};

export type ToolSelectionMap = ReadonlyMap<SessionId, ToolSelection>;

export const EMPTY_SELECTION: ToolSelection = {
  plugins: [],
  skills: [],
  promptTemplates: [],
};
