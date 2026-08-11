import { create } from "zustand";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { SessionId } from "@/features/agent/runtime/types";
import {
  EMPTY_SELECTION,
  type BrowserBackend,
  type BrowserState,
  type ComputerState,
  type ComputerTab,
  type ContextAttachRequest,
  type FileOpenRequest,
  type ToolSelection,
} from "@/features/agent/tools/types";
import {
  clampComputerWidth,
  computerPanelVisibility,
  loadBrowserState,
  loadComputerState,
  migrateToolStorage,
  uniqueComputerTabs,
  writeBrowserBackend,
  writeBrowserEnabled,
  writeComputerTab,
  writeComputerTabs,
  writeComputerWidth,
} from "@/features/agent/tools/persistence";
import {
  computerSessionView,
  patchSessionView,
  readSessionView,
  type SessionViewIdentity,
} from "@/features/agent/workspace/session-view-state";

export type ToolsActions = {
  setBrowserEnabled: (enabled: boolean) => void;
  setBrowserBackend: (backend: BrowserBackend) => void;
  toggleBrowserBackend: () => void;
  toggleBrowser: () => void;
  setBrowserUrl: (url: string, input?: string) => void;
  setBrowserInput: (input: string) => void;
  setComputerOpen: (open: boolean) => void;
  toggleComputerOpen: () => void;
  setComputerTab: (tab: ComputerTab) => void;
  selectComputerTabWithoutOpening: (tab: ComputerTab) => void;
  closeComputerTab: (tab: ComputerTab) => void;
  setComputerWidth: (width: number) => void;
  setActiveComputerSession: (identity: SessionViewIdentity | null) => void;
  requestFileOpen: (path: string) => void;
  requestContextAttach: (request: { label: string; path?: string; content: string }) => void;
  setSelection: (sessionId: SessionId, selection: ToolSelection | null) => void;
  hydrateSelections: (entries: Iterable<[SessionId, ToolSelection]>) => void;
};

export type ToolSelectionsValue = {
  fileOpenRequest: FileOpenRequest | null;
  contextAttachRequest: ContextAttachRequest | null;
  skillCatalogue: ComposerSkillRef[];
  promptTemplateCatalogue: ComposerPromptTemplateRef[];
  selectionFor: (sessionId: SessionId | null | undefined) => ToolSelection;
};

export type ToolsContextValue = ToolsActions &
  ToolSelectionsValue & { browser: BrowserState; computer: ComputerState };

type ToolsStore = ToolsContextValue & {
  selections: ReadonlyMap<SessionId, ToolSelection>;
  initialize: () => void;
  setCatalogues: (payload: {
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
  }) => void;
};

const initialBrowser: BrowserState = { enabled: false, backend: "embedded", url: "", input: "" };
const initialComputer: ComputerState = { open: false, tab: "status", tabs: ["status"], width: 0 };

export const useToolsStore = create<ToolsStore>((set, get) => {
  let initialized = false;
  let activeComputerSession: SessionViewIdentity | null = null;
  const updateComputer = (update: (current: ComputerState) => ComputerState) => {
    const next = update(get().computer);
    if (next === get().computer) return;
    if (activeComputerSession && typeof window !== "undefined") {
      patchSessionView(window.localStorage, activeComputerSession, {
        computer: computerSessionView(next),
      });
    }
    set({ computer: next });
  };
  const selectComputerTab = (tab: ComputerTab, open: boolean) => {
    updateComputer((current) => {
      const tabs = uniqueComputerTabs([...current.tabs, tab]);
      return { ...current, open: open || current.open, tab, tabs };
    });
    writeComputerTabs(get().computer.tabs);
    writeComputerTab(tab);
    if (tab === "browser" && !get().browser.enabled) {
      writeBrowserEnabled(true);
      set({ browser: { ...get().browser, enabled: true } });
    }
  };
  return {
    browser: initialBrowser,
    computer: initialComputer,
    fileOpenRequest: null,
    contextAttachRequest: null,
    skillCatalogue: [],
    promptTemplateCatalogue: [],
    selections: new Map(),
    initialize: () => {
      if (initialized || typeof window === "undefined") return;
      initialized = true;
      migrateToolStorage();
      set({ browser: loadBrowserState(), computer: loadComputerState() });
    },
    setCatalogues: ({ skills, promptTemplates }) =>
      set({ skillCatalogue: skills, promptTemplateCatalogue: promptTemplates }),
    selectionFor: (sessionId) =>
      sessionId ? (get().selections.get(sessionId) ?? EMPTY_SELECTION) : EMPTY_SELECTION,
    setBrowserEnabled: (enabled) => {
      writeBrowserEnabled(enabled);
      set({ browser: { ...get().browser, enabled } });
    },
    setBrowserBackend: (backend) => {
      writeBrowserBackend(backend);
      set({ browser: { ...get().browser, backend } });
    },
    toggleBrowserBackend: () => {
      const backend = get().browser.backend === "sitegeist" ? "embedded" : "sitegeist";
      writeBrowserBackend(backend);
      set({ browser: { ...get().browser, backend } });
    },
    toggleBrowser: () => get().setBrowserEnabled(!get().browser.enabled),
    setBrowserUrl: (url, input) => {
      if (!url.trim()) return;
      set({ browser: { ...get().browser, url, input: input ?? get().browser.input } });
    },
    setBrowserInput: (input) => set({ browser: { ...get().browser, input } }),
    setComputerOpen: (open) => updateComputer((current) => computerPanelVisibility(current, open)),
    toggleComputerOpen: () =>
      updateComputer((current) => computerPanelVisibility(current, !current.open)),
    setComputerTab: (tab) => selectComputerTab(tab, true),
    selectComputerTabWithoutOpening: (tab) => selectComputerTab(tab, false),
    closeComputerTab: (tab) => {
      if (tab === "status" || tab === "tools") return;
      if (tab === "browser") get().setBrowserEnabled(false);
      updateComputer((current) => {
        const tabs = uniqueComputerTabs(current.tabs.filter((item) => item !== tab));
        const active = current.tab === tab ? (tabs.at(-1) ?? "status") : current.tab;
        writeComputerTabs(tabs);
        writeComputerTab(active);
        return { ...current, tab: active, tabs };
      });
    },
    setComputerWidth: (width) => {
      if (!Number.isFinite(width)) return;
      const clamped = clampComputerWidth(width);
      updateComputer((current) =>
        current.width === clamped ? current : { ...current, width: clamped },
      );
      writeComputerWidth(clamped);
    },
    setActiveComputerSession: (identity) => {
      if (activeComputerSession?.key === identity?.key) return;
      if (activeComputerSession && typeof window !== "undefined") {
        patchSessionView(window.localStorage, activeComputerSession, {
          computer: computerSessionView(get().computer),
        });
      }
      activeComputerSession = identity;
      const restored =
        identity && typeof window !== "undefined"
          ? readSessionView(window.localStorage, identity)?.computer
          : null;
      set({
        computer: restored
          ? { ...get().computer, ...restored }
          : { ...get().computer, open: false },
      });
    },
    requestFileOpen: (path) => {
      const clean = path.trim();
      if (!clean) return;
      selectComputerTab("files", true);
      set({ fileOpenRequest: { id: (get().fileOpenRequest?.id ?? 0) + 1, path: clean } });
    },
    requestContextAttach: (request) => {
      const content = request.content.trim();
      if (!content) return;
      set({
        contextAttachRequest: {
          id: (get().contextAttachRequest?.id ?? 0) + 1,
          label: request.label.trim() || "context",
          ...(request.path ? { path: request.path } : {}),
          content,
        },
      });
    },
    setSelection: (sessionId, selection) => {
      const selections = new Map(get().selections);
      if (selection) selections.set(sessionId, selection);
      else if (!selections.delete(sessionId)) return;
      set({ selections });
    },
    hydrateSelections: (entries) => {
      const selections = new Map(get().selections);
      let changed = false;
      for (const [id, selection] of entries) {
        if (selections.get(id) === selection) continue;
        selections.set(id, selection);
        changed = true;
      }
      if (changed) set({ selections });
    },
  };
});

export const toolsRef: { current: ToolsContextValue } = { current: useToolsStore.getState() };
useToolsStore.subscribe((state) => {
  toolsRef.current = state;
});
