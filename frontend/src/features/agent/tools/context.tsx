"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type Context,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { usePathname } from "next/navigation";
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
  type ToolSelectionMap,
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
  writeComputerWidth,
} from "@/features/agent/tools/persistence";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { openWorkbenchResource } from "@/features/workbench/controller-state";
import {
  browserSessionView,
  patchSessionView,
  readSessionView,
  type SessionViewIdentity,
} from "@/features/agent/workspace/session-view-state";

// The tools surface is provided as four narrow contexts (actions / computer /
// browser / selections) so a state change in one slice never re-renders
// consumers of the others — e.g. typing in the browser URL bar must not churn
// every assistant-markdown block. `useTools()` composes all four for the
// pass-through consumers whose downstream prop contracts take the full value.
type ToolsActions = {
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
  registerComputerTabCloseHandler: (tab: ComputerTab, handler: () => void) => () => void;
  setComputerWidth: (width: number) => void;
  setActiveComputerSession: (identity: SessionViewIdentity | null) => void;
  requestFileOpen: (path: string) => void;
  showFileResource: (path: string) => void;
  requestContextAttach: (request: { label: string; path?: string; content: string }) => void;
  /**
   * Replace the entire selection for a session. Pass `null` to clear it (used
   * when a session is closed / pruned).
   */
  setSelection: (sessionId: SessionId, selection: ToolSelection | null) => void;
  hydrateSelections: (entries: Iterable<[SessionId, ToolSelection]>) => void;
};

type ToolSelectionsValue = {
  fileOpenRequest: FileOpenRequest | null;
  contextAttachRequest: ContextAttachRequest | null;
  skillCatalogue: ComposerSkillRef[];
  promptTemplateCatalogue: ComposerPromptTemplateRef[];
  selectionFor: (sessionId: SessionId | null | undefined) => ToolSelection;
};

export type ToolsContextValue = ToolsActions &
  ToolSelectionsValue & {
    browser: BrowserState;
    computer: ComputerToolsValue;
  };

export type ComputerToolsValue = ComputerState & {
  sessionKey: string | null;
};

const ToolsActionsContext = createContext<ToolsActions | null>(null);
const ComputerToolsContext = createContext<ComputerToolsValue | null>(null);
const BrowserToolsContext = createContext<BrowserState | null>(null);
const ToolSelectionsContext = createContext<ToolSelectionsValue | null>(null);
// Stable ref to the composed value for imperative (event-time) readers that
// must not re-render on tools churn — see `useToolsRef`.
const ToolsRefContext = createContext<{ current: ToolsContextValue } | null>(null);

type ToolsEffectsBridgeProps = {
  catalogueEnabled: boolean;
  onCatalogueLoaded: (payload: {
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
  }) => void;
};

type ToolsEffectsBridgeComponent = ComponentType<ToolsEffectsBridgeProps>;

let toolsEffectsBridgePromise: Promise<ToolsEffectsBridgeComponent> | null = null;

function loadToolsEffectsBridge(): Promise<ToolsEffectsBridgeComponent> {
  toolsEffectsBridgePromise ??= import("@/features/agent/tools/effects-bridge").then(
    (mod) => mod.ToolsEffectsBridge,
  );
  return toolsEffectsBridgePromise;
}

function LazyToolsEffectsBridge(props: ToolsEffectsBridgeProps) {
  const enabled = props.catalogueEnabled;
  const [ToolsEffectsBridge, setToolsEffectsBridge] = useState<ToolsEffectsBridgeComponent | null>(
    null,
  );

  useMountSubscription(() => {
    if (!enabled || ToolsEffectsBridge) return;
    let cancelled = false;
    void loadToolsEffectsBridge().then((Component) => {
      if (!cancelled) setToolsEffectsBridge(() => Component);
    });
    return () => {
      cancelled = true;
    };
  }, [ToolsEffectsBridge, enabled]);

  return enabled && ToolsEffectsBridge ? <ToolsEffectsBridge {...props} /> : null;
}

function buildInitialBrowser(): BrowserState {
  return { enabled: false, backend: "embedded", url: "", input: "" };
}

function buildInitialComputer(): ComputerState {
  return {
    open: false,
    tab: "files",
    tabs: [],
    width: 0,
  };
}

export function ToolsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const catalogueEnabled = pathname === "/agent" || pathname === "/quick";
  const [browser, setBrowser] = useState<BrowserState>(() => buildInitialBrowser());
  const [computer, setComputer] = useState<ComputerState>(() => buildInitialComputer());
  const [activeComputerSessionKey, setActiveComputerSessionKey] = useState<string | null>(null);
  const activeComputerSessionRef = useRef<SessionViewIdentity | null>(null);
  const computerTabCloseHandlersRef = useRef(new Map<ComputerTab, () => void>());
  const [fileOpenRequest, setFileOpenRequest] = useState<FileOpenRequest | null>(null);
  const [contextAttachRequest, setContextAttachRequest] = useState<ContextAttachRequest | null>(
    null,
  );
  const [skillCatalogue, setSkillCatalogue] = useState<ComposerSkillRef[]>([]);
  const [promptTemplateCatalogue, setPromptTemplateCatalogue] = useState<
    ComposerPromptTemplateRef[]
  >([]);
  const selectionsRef = useRef<Map<SessionId, ToolSelection>>(new Map());
  const [selectionVersion, setSelectionVersion] = useState(0);
  useMountSubscription(() => {
    migrateToolStorage();
    const storedBrowser = loadBrowserState();
    const storedComputer = loadComputerState();
    setBrowser({ ...buildInitialBrowser(), backend: storedBrowser.backend });
    setComputer({ ...buildInitialComputer(), width: storedComputer.width });
  }, []);
  const updateComputer = useCallback<Dispatch<SetStateAction<ComputerState>>>((update) => {
    setComputer((current) => {
      const next = typeof update === "function" ? update(current) : update;
      return next === current ? current : next;
    });
  }, []);
  const updateBrowser = useCallback<Dispatch<SetStateAction<BrowserState>>>((update) => {
    setBrowser((current) => {
      const next = typeof update === "function" ? update(current) : update;
      if (next === current) return current;
      const identity = activeComputerSessionRef.current;
      if (identity) {
        patchSessionView(window.localStorage, identity, { browser: browserSessionView(next) });
      }
      return next;
    });
  }, []);
  const handleCatalogueLoaded = useCallback(
    ({
      skills,
      promptTemplates,
    }: {
      skills: ComposerSkillRef[];
      promptTemplates: ComposerPromptTemplateRef[];
    }) => {
      setSkillCatalogue(skills);
      setPromptTemplateCatalogue(promptTemplates);
    },
    [],
  );

  const setBrowserEnabled = useCallback(
    (enabled: boolean) => {
      updateBrowser((current) => (current.enabled === enabled ? current : { ...current, enabled }));
      writeBrowserEnabled(enabled);
    },
    [updateBrowser],
  );

  const setBrowserBackend = useCallback(
    (backend: BrowserBackend) => {
      updateBrowser((current) => (current.backend === backend ? current : { ...current, backend }));
      writeBrowserBackend(backend);
    },
    [updateBrowser],
  );

  const toggleBrowserBackend = useCallback(() => {
    updateBrowser((current) => {
      const backend = current.backend === "chrome" ? "embedded" : "chrome";
      writeBrowserBackend(backend);
      return { ...current, backend };
    });
  }, [updateBrowser]);

  const toggleBrowser = useCallback(() => {
    updateBrowser((current) => {
      const next = !current.enabled;
      writeBrowserEnabled(next);
      return { ...current, enabled: next };
    });
  }, [updateBrowser]);

  const setBrowserUrl = useCallback(
    (url: string, input?: string) => {
      if (typeof url !== "string" || !url.trim()) return;
      updateBrowser((current) => ({
        ...current,
        url,
        input: input ?? current.input,
      }));
    },
    [updateBrowser],
  );

  const setBrowserInput = useCallback(
    (input: string) => {
      if (typeof input !== "string") return;
      updateBrowser((current) => ({ ...current, input }));
    },
    [updateBrowser],
  );

  const setComputerOpen = useCallback(
    (open: boolean) => {
      updateComputer((current) => computerPanelVisibility(current, open));
    },
    [updateComputer],
  );

  const toggleComputerOpen = useCallback(() => {
    updateComputer((current) => computerPanelVisibility(current, !current.open));
  }, [updateComputer]);

  const setComputerTab = useCallback(
    (tab: ComputerTab) => {
      updateComputer((current) => {
        const tabs = uniqueComputerTabs([...current.tabs, tab]);
        return current.tab === tab && current.tabs === tabs
          ? current
          : { ...current, open: true, tab, tabs };
      });
      if (tab === "browser") {
        updateBrowser((current) => {
          if (current.enabled) return current;
          writeBrowserEnabled(true);
          return { ...current, enabled: true };
        });
      }
    },
    [updateBrowser, updateComputer],
  );

  // Register + select a tab WITHOUT force-opening the computer panel. Used when
  // the model drives a background tool (e.g. the browser): it should route to the
  // right tab and pre-select it, but must not pop the panel open on every prompt
  // — the user controls whether the panel is visible.
  const selectComputerTabWithoutOpening = useCallback(
    (tab: ComputerTab) => {
      updateComputer((current) => {
        const tabs = uniqueComputerTabs([...current.tabs, tab]);
        return current.tab === tab && current.tabs === tabs ? current : { ...current, tab, tabs };
      });
      if (tab === "browser") {
        updateBrowser((current) => {
          if (current.enabled) return current;
          writeBrowserEnabled(true);
          return { ...current, enabled: true };
        });
      }
    },
    [updateBrowser, updateComputer],
  );

  const closeComputerTab = useCallback(
    (tab: ComputerTab) => {
      computerTabCloseHandlersRef.current.get(tab)?.();
      updateComputer((current) => {
        const tabs = uniqueComputerTabs(current.tabs.filter((item) => item !== tab));
        const activeTab = current.tab === tab ? (tabs[tabs.length - 1] ?? "files") : current.tab;
        return { ...current, open: tabs.length ? current.open : false, tab: activeTab, tabs };
      });
    },
    [updateComputer],
  );

  const registerComputerTabCloseHandler = useCallback((tab: ComputerTab, handler: () => void) => {
    computerTabCloseHandlersRef.current.set(tab, handler);
    return () => {
      if (computerTabCloseHandlersRef.current.get(tab) === handler) {
        computerTabCloseHandlersRef.current.delete(tab);
      }
    };
  }, []);

  const setComputerWidth = useCallback(
    (width: number) => {
      if (!Number.isFinite(width)) return;
      const clamped = clampComputerWidth(width);
      updateComputer((current) =>
        current.width === clamped ? current : { ...current, width: clamped },
      );
      writeComputerWidth(clamped);
    },
    [updateComputer],
  );

  const setActiveComputerSession = useCallback((identity: SessionViewIdentity | null) => {
    const previous = activeComputerSessionRef.current;
    if (previous && identity && previous.key === identity.key) return;
    const restored = identity ? readSessionView(window.localStorage, identity) : null;
    activeComputerSessionRef.current = identity;
    setActiveComputerSessionKey(identity?.key ?? null);
    setComputer((current) => ({ ...current, open: false, tab: "files", tabs: [] }));
    setBrowser((current) => {
      if (previous) {
        patchSessionView(window.localStorage, previous, { browser: browserSessionView(current) });
      }
      return restored?.browser ? restored.browser : buildInitialBrowser();
    });
  }, []);

  const showFileResource = useCallback(
    (path: string) => {
      const clean = path.trim();
      if (!clean) return;
      updateComputer((current) => ({ ...current, open: true, tab: "files" }));
      setFileOpenRequest((current) => ({
        id: (current?.id ?? 0) + 1,
        path: clean,
      }));
    },
    [updateComputer],
  );

  const requestFileOpen = useCallback((path: string) => {
    const clean = path.trim();
    if (!clean) return;
    openWorkbenchResource({
      kind: "file",
      resourceId: clean,
      title: clean.split("/").at(-1) || "File",
    });
  }, []);

  const requestContextAttach = useCallback(
    (request: { label: string; path?: string; content: string }) => {
      const content = request.content.trim();
      if (!content) return;
      setContextAttachRequest((current) => ({
        id: (current?.id ?? 0) + 1,
        label: request.label.trim() || "context",
        ...(request.path ? { path: request.path } : {}),
        content,
      }));
    },
    [],
  );

  const selectionFor = useCallback(
    (sessionId: SessionId | null | undefined): ToolSelection => {
      if (!sessionId) return EMPTY_SELECTION;
      return selectionsRef.current.get(sessionId) ?? EMPTY_SELECTION;
    },
    // selectionVersion is read implicitly via the Ref; we depend on it so the
    // returned function identity changes when selections mutate.
    [selectionVersion],
  );

  const setSelection = useCallback((sessionId: SessionId, selection: ToolSelection | null) => {
    const map = selectionsRef.current;
    if (!selection) {
      if (!map.delete(sessionId)) return;
    } else {
      const current = map.get(sessionId);
      if (
        current &&
        current.skills === selection.skills &&
        current.promptTemplates === selection.promptTemplates
      ) {
        return;
      }
      map.set(sessionId, selection);
    }
    setSelectionVersion((v) => v + 1);
  }, []);

  const hydrateSelections = useCallback((entries: Iterable<[SessionId, ToolSelection]>) => {
    const map = selectionsRef.current;
    let changed = false;
    for (const [id, selection] of entries) {
      if (!selection) continue;
      const existing = map.get(id);
      if (
        existing &&
        existing.skills === selection.skills &&
        existing.promptTemplates === selection.promptTemplates
      ) {
        continue;
      }
      map.set(id, selection);
      changed = true;
    }
    if (changed) setSelectionVersion((v) => v + 1);
  }, []);

  // Every callback above is useCallback-stable except toggleComputerOpen
  // (depends on computer.open), so this value only changes identity when the
  // panel opens/closes — action-only consumers stay untouched by state churn.
  const actions = useMemo<ToolsActions>(
    () => ({
      setBrowserEnabled,
      setBrowserBackend,
      toggleBrowserBackend,
      toggleBrowser,
      setBrowserUrl,
      setBrowserInput,
      setComputerOpen,
      toggleComputerOpen,
      setComputerTab,
      selectComputerTabWithoutOpening,
      closeComputerTab,
      registerComputerTabCloseHandler,
      setComputerWidth,
      setActiveComputerSession,
      requestFileOpen,
      showFileResource,
      requestContextAttach,
      setSelection,
      hydrateSelections,
    }),
    [
      setBrowserEnabled,
      setBrowserBackend,
      toggleBrowserBackend,
      toggleBrowser,
      setBrowserUrl,
      setBrowserInput,
      setComputerOpen,
      toggleComputerOpen,
      setComputerTab,
      selectComputerTabWithoutOpening,
      closeComputerTab,
      registerComputerTabCloseHandler,
      setComputerWidth,
      setActiveComputerSession,
      requestFileOpen,
      showFileResource,
      requestContextAttach,
      setSelection,
      hydrateSelections,
    ],
  );

  const selections = useMemo<ToolSelectionsValue>(
    () => ({
      fileOpenRequest,
      contextAttachRequest,
      skillCatalogue,
      promptTemplateCatalogue,
      selectionFor,
    }),
    [fileOpenRequest, contextAttachRequest, skillCatalogue, promptTemplateCatalogue, selectionFor],
  );

  const computerValue = useMemo<ComputerToolsValue>(
    () => ({ ...computer, sessionKey: activeComputerSessionKey }),
    [activeComputerSessionKey, computer],
  );

  // Latest-value ref for imperative readers (use-workspace's event handlers).
  // Refreshed post-render, which is always before any event-time read.
  const value = useMemo<ToolsContextValue>(
    () => ({ browser, computer: computerValue, ...selections, ...actions }),
    [browser, computerValue, selections, actions],
  );
  const valueRef = useRef(value);
  useMountSubscription(() => {
    valueRef.current = value;
  }, [value]);

  return (
    <ToolsActionsContext.Provider value={actions}>
      <ComputerToolsContext.Provider value={computerValue}>
        <BrowserToolsContext.Provider value={browser}>
          <ToolSelectionsContext.Provider value={selections}>
            <ToolsRefContext.Provider value={valueRef}>
              <LazyToolsEffectsBridge
                catalogueEnabled={catalogueEnabled}
                onCatalogueLoaded={handleCatalogueLoaded}
              />
              {children}
            </ToolsRefContext.Provider>
          </ToolSelectionsContext.Provider>
        </BrowserToolsContext.Provider>
      </ComputerToolsContext.Provider>
    </ToolsActionsContext.Provider>
  );
}

function useToolsSlice<T>(context: Context<T | null>, hook: string): T {
  const value = useContext(context);
  if (value === null) throw new Error(`${hook} must be used within a ToolsProvider`);
  return value;
}

/** Stable tool callbacks only — never re-renders consumers on tools state churn. */
export function useToolsActions(): ToolsActions {
  return useToolsSlice(ToolsActionsContext, "useToolsActions");
}

/** Computer panel state (open/tab/tabs/width). */
export function useComputerTools(): ComputerToolsValue {
  return useToolsSlice(ComputerToolsContext, "useComputerTools");
}

/** Browser pane state (enabled/backend/url/input). */
export function useBrowserTools(): BrowserState {
  return useToolsSlice(BrowserToolsContext, "useBrowserTools");
}

/** Per-session skill/template selections, catalogues, and open/attach requests. */
export function useToolSelections(): ToolSelectionsValue {
  return useToolsSlice(ToolSelectionsContext, "useToolSelections");
}

/**
 * Ref to the full composed tools value for imperative event-time reads. Unlike
 * `useTools()`, subscribing components never re-render when tools state moves.
 */
export function useToolsRef(): { current: ToolsContextValue } {
  return useToolsSlice(ToolsRefContext, "useToolsRef");
}

/**
 * Composed compatibility view over all four tool contexts. Re-renders on any
 * tools state change, so prefer the narrow hooks; this exists for consumers
 * that hand the full value to prop contracts typed as `ToolsContextValue`.
 */
export function useTools(): ToolsContextValue {
  const actions = useToolsActions();
  const computer = useComputerTools();
  const browser = useBrowserTools();
  const selections = useToolSelections();
  return useMemo(
    () => ({ browser, computer, ...selections, ...actions }),
    [browser, computer, selections, actions],
  );
}

export type {
  ToolSelection,
  ToolSelectionMap,
  BrowserState,
  BrowserBackend,
  ComputerState,
  ComputerTab,
};
