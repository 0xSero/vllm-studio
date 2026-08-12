import { create } from "zustand";
import type {
  ComposerPromptTemplateRef,
  ComposerSkillRef,
} from "@/features/agent/composer-context";
import type { SessionId } from "@/features/agent/runtime/types";
import {
  mergeTerminalKeys,
  terminalKeysMatch,
  type TerminalOwner,
  type TerminalOwnersState,
} from "@/features/agent/terminal-owners";
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
  loadToolState,
  uniqueComputerTabs,
  writeToolState,
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
  rememberTerminalOwner: (owner: TerminalOwner, options?: { select?: boolean }) => void;
  selectTerminalOwner: (ownerKey: string) => void;
  removeTerminalOwner: (ownerKey: string) => TerminalOwner | null;
  removeTerminalOwners: (ownerKeys: readonly string[]) => TerminalOwner[];
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
  ToolSelectionsValue & {
    browser: BrowserState;
    computer: ComputerState;
    terminals: TerminalOwnersState;
  };

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
const initialTerminals: TerminalOwnersState = { owners: [], activeOwnerKey: null };

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
    writeToolState(get());
  };
  const selectComputerTab = (tab: ComputerTab, open: boolean) => {
    updateComputer((current) => {
      const tabs = uniqueComputerTabs([...current.tabs, tab]);
      return { ...current, open: open || current.open, tab, tabs };
    });
    if (tab === "browser" && !get().browser.enabled) {
      set({ browser: { ...get().browser, enabled: true } });
      writeToolState(get());
    }
  };
  const updateTerminals = (next: TerminalOwnersState) => {
    set({ terminals: next });
    writeToolState(get());
  };
  return {
    browser: initialBrowser,
    computer: initialComputer,
    terminals: initialTerminals,
    fileOpenRequest: null,
    contextAttachRequest: null,
    skillCatalogue: [],
    promptTemplateCatalogue: [],
    selections: new Map(),
    initialize: () => {
      if (initialized || typeof window === "undefined") return;
      initialized = true;
      set(loadToolState());
    },
    setCatalogues: ({ skills, promptTemplates }) =>
      set({ skillCatalogue: skills, promptTemplateCatalogue: promptTemplates }),
    selectionFor: (sessionId) =>
      sessionId ? (get().selections.get(sessionId) ?? EMPTY_SELECTION) : EMPTY_SELECTION,
    setBrowserEnabled: (enabled) => {
      set({ browser: { ...get().browser, enabled } });
      writeToolState(get());
    },
    setBrowserBackend: (backend) => {
      set({ browser: { ...get().browser, backend } });
      writeToolState(get());
    },
    toggleBrowserBackend: () => {
      const backend = get().browser.backend === "sitegeist" ? "embedded" : "sitegeist";
      set({ browser: { ...get().browser, backend } });
      writeToolState(get());
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
        return { ...current, tab: active, tabs };
      });
    },
    setComputerWidth: (width) => {
      if (!Number.isFinite(width)) return;
      const clamped = clampComputerWidth(width);
      updateComputer((current) =>
        current.width === clamped ? current : { ...current, width: clamped },
      );
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
    rememberTerminalOwner: (owner, options = {}) => {
      const current = get().terminals;
      const index = current.owners.findIndex((item) =>
        terminalKeysMatch(item.matchKeys, owner.matchKeys),
      );
      const existing = current.owners[index];
      const nextOwner = existing
        ? {
            ...existing,
            ...owner,
            mountKey: existing.mountKey,
            matchKeys: mergeTerminalKeys(existing.matchKeys, owner.matchKeys),
            cwd: owner.cwd ?? existing.cwd,
            title: owner.title || existing.title,
          }
        : owner;
      const owners = existing
        ? current.owners.map((item, ownerIndex) => (ownerIndex === index ? nextOwner : item))
        : [...current.owners, nextOwner];
      const activeOwnerKey =
        options.select || !current.activeOwnerKey ? nextOwner.mountKey : current.activeOwnerKey;
      if (
        existing &&
        activeOwnerKey === current.activeOwnerKey &&
        nextOwner.cwd === existing.cwd &&
        nextOwner.title === existing.title &&
        nextOwner.kind === existing.kind &&
        nextOwner.sessionId === existing.sessionId &&
        nextOwner.piSessionId === existing.piSessionId &&
        nextOwner.projectId === existing.projectId &&
        nextOwner.matchKeys.length === existing.matchKeys.length
      ) {
        return;
      }
      updateTerminals({
        owners,
        activeOwnerKey,
      });
    },
    selectTerminalOwner: (ownerKey) => {
      const current = get().terminals;
      if (
        current.activeOwnerKey === ownerKey ||
        !current.owners.some((owner) => owner.mountKey === ownerKey)
      ) {
        return;
      }
      updateTerminals({ ...current, activeOwnerKey: ownerKey });
    },
    removeTerminalOwner: (ownerKey) => get().removeTerminalOwners([ownerKey])[0] ?? null,
    removeTerminalOwners: (ownerKeys) => {
      const current = get().terminals;
      const keys = new Set(ownerKeys);
      const removed = current.owners.filter((owner) => keys.has(owner.mountKey));
      if (!removed.length) return [];
      const owners = current.owners.filter((owner) => !keys.has(owner.mountKey));
      updateTerminals({
        owners,
        activeOwnerKey: owners.some((owner) => owner.mountKey === current.activeOwnerKey)
          ? current.activeOwnerKey
          : (owners[0]?.mountKey ?? null),
      });
      return removed;
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
