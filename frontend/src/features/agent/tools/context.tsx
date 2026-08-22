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
import type {
  ToolsCatalogue,
  ToolsEffectsBridgeProps,
} from "@/features/agent/tools/effects-bridge";
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
  writeComputerTab,
  writeComputerTabs,
  writeComputerWidth,
} from "@/features/agent/tools/persistence";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  computerSessionView,
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
  setComputerWidth: (width: number) => void;
  setActiveComputerSession: (identity: SessionViewIdentity | null) => void;
  requestFileOpen: (path: string) => void;
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
    computer: ComputerState;
  };

const ToolsActionsContext = createContext<ToolsActions | null>(null);
const ComputerToolsContext = createContext<ComputerState | null>(null);
const BrowserToolsContext = createContext<BrowserState | null>(null);
const ToolSelectionsContext = createContext<ToolSelectionsValue | null>(null);
// Stable ref to the composed value for imperative (event-time) readers that
// must not re-render on tools churn — see `useToolsRef`.
const ToolsRefContext = createContext<{ current: ToolsContextValue } | null>(null);

function LazyToolsEffectsBridge(props: ToolsEffectsBridgeProps) {
  const enabled = props.catalogueEnabled;
  const [Bridge, setBridge] = useState<ComponentType<ToolsEffectsBridgeProps> | null>(null);

  useMountSubscription(() => {
    if (!enabled || Bridge) return;
    let cancelled = false;
    void import("@/features/agent/tools/effects-bridge").then((mod) => {
      if (!cancelled) setBridge(() => mod.ToolsEffectsBridge);
    });
    return () => {
      cancelled = true;
    };
  }, [Bridge, enabled]);

  return enabled && Bridge ? <Bridge {...props} /> : null;
}

export function ToolsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const catalogueEnabled = pathname === "/agent";
  const [browser, setBrowser] = useState<BrowserState>(() => {
    if (typeof window === "undefined")
      return { enabled: false, backend: "embedded", url: "", input: "" };
    migrateToolStorage();
    return loadBrowserState();
  });
  const [computer, setComputer] = useState<ComputerState>(() =>
    typeof window === "undefined"
      ? { open: false, tab: "status", tabs: ["status"], width: 0 }
      : loadComputerState(),
  );
  const activeComputerSessionRef = useRef<SessionViewIdentity | null>(null);
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
  const updateComputer = useCallback<Dispatch<SetStateAction<ComputerState>>>((update) => {
    setComputer((current) => {
      const next = typeof update === "function" ? update(current) : update;
      if (next === current) return current;
      const identity = activeComputerSessionRef.current;
      if (identity) {
        patchSessionView(window.localStorage, identity, { computer: computerSessionView(next) });
      }
      return next;
    });
  }, []);
  const handleCatalogueLoaded = useCallback(({ skills, promptTemplates }: ToolsCatalogue) => {
    setSkillCatalogue(skills);
    setPromptTemplateCatalogue(promptTemplates);
  }, []);

  const selectionFor = useCallback(
    (sessionId: SessionId | null | undefined): ToolSelection => {
      if (!sessionId) return EMPTY_SELECTION;
      return selectionsRef.current.get(sessionId) ?? EMPTY_SELECTION;
    },
    // selectionVersion is read implicitly via the Ref; we depend on it so the
    // returned function identity changes when selections mutate.
    [selectionVersion],
  );

  // One memo for the whole action surface: every callback closes over stable
  // setters only, so this value never changes identity — action-only consumers
  // stay untouched by tools state churn.
  const actions = useMemo<ToolsActions>(() => {
    const enableBrowser = (enabled: boolean) => {
      setBrowser((current) => {
        if (current.enabled === enabled) return current;
        writeBrowserEnabled(enabled);
        return { ...current, enabled };
      });
    };
    // Register + select a tab. `open` false keeps the computer panel closed:
    // used when the model drives a background tool (e.g. the browser), which
    // should route to the right tab and pre-select it, but must not pop the
    // panel open on every prompt — the user controls whether it is visible.
    const openTab = (tab: ComputerTab, open: boolean) => {
      updateComputer((current) => {
        const tabs = uniqueComputerTabs([...current.tabs, tab]);
        writeComputerTabs(tabs);
        writeComputerTab(tab);
        return current.tab === tab && current.tabs === tabs
          ? current
          : { ...current, ...(open ? { open: true } : null), tab, tabs };
      });
      if (tab === "browser") enableBrowser(true);
    };
    const sameSelection = (a: ToolSelection | undefined, b: ToolSelection) =>
      Boolean(a && a.skills === b.skills && a.promptTemplates === b.promptTemplates);

    return {
      setBrowserEnabled: (enabled) => {
        setBrowser((current) => (current.enabled === enabled ? current : { ...current, enabled }));
        writeBrowserEnabled(enabled);
      },
      setBrowserBackend: (backend) => {
        setBrowser((current) => (current.backend === backend ? current : { ...current, backend }));
        writeBrowserBackend(backend);
      },
      toggleBrowserBackend: () => {
        setBrowser((current) => {
          const backend = current.backend === "chrome" ? "embedded" : "chrome";
          writeBrowserBackend(backend);
          return { ...current, backend };
        });
      },
      toggleBrowser: () => {
        setBrowser((current) => {
          const next = !current.enabled;
          writeBrowserEnabled(next);
          return { ...current, enabled: next };
        });
      },
      setBrowserUrl: (url, input) => {
        if (typeof url !== "string" || !url.trim()) return;
        setBrowser((current) => ({ ...current, url, input: input ?? current.input }));
      },
      setBrowserInput: (input) => {
        if (typeof input !== "string") return;
        setBrowser((current) => ({ ...current, input }));
      },
      setComputerOpen: (open) => {
        updateComputer((current) => computerPanelVisibility(current, open));
      },
      toggleComputerOpen: () => {
        updateComputer((current) => computerPanelVisibility(current, !current.open));
      },
      setComputerTab: (tab) => openTab(tab, true),
      selectComputerTabWithoutOpening: (tab) => openTab(tab, false),
      closeComputerTab: (tab) => {
        if (tab === "status" || tab === "tools") return;
        if (tab === "browser") enableBrowser(false);
        updateComputer((current) => {
          const tabs = uniqueComputerTabs(current.tabs.filter((item) => item !== tab));
          const activeTab = current.tab === tab ? (tabs[tabs.length - 1] ?? "status") : current.tab;
          writeComputerTabs(tabs);
          writeComputerTab(activeTab);
          return { ...current, tab: activeTab, tabs };
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
        const previous = activeComputerSessionRef.current;
        if (previous?.key === identity?.key) return;
        setComputer((current) => {
          if (previous) {
            patchSessionView(window.localStorage, previous, {
              computer: computerSessionView(current),
            });
          }
          activeComputerSessionRef.current = identity;
          const restored = identity
            ? readSessionView(window.localStorage, identity)?.computer
            : null;
          return restored ? { ...current, ...restored } : { ...current, open: false };
        });
      },
      requestFileOpen: (path) => {
        const clean = path.trim();
        if (!clean) return;
        updateComputer((current) => ({ ...current, open: true, tab: "files" }));
        writeComputerTab("files");
        setFileOpenRequest((current) => ({ id: (current?.id ?? 0) + 1, path: clean }));
      },
      requestContextAttach: (request) => {
        const content = request.content.trim();
        if (!content) return;
        setContextAttachRequest((current) => ({
          id: (current?.id ?? 0) + 1,
          label: request.label.trim() || "context",
          ...(request.path ? { path: request.path } : {}),
          content,
        }));
      },
      setSelection: (sessionId, selection) => {
        const map = selectionsRef.current;
        if (!selection) {
          if (!map.delete(sessionId)) return;
        } else {
          if (sameSelection(map.get(sessionId), selection)) return;
          map.set(sessionId, selection);
        }
        setSelectionVersion((v) => v + 1);
      },
      hydrateSelections: (entries) => {
        const map = selectionsRef.current;
        let changed = false;
        for (const [id, selection] of entries) {
          if (!selection || sameSelection(map.get(id), selection)) continue;
          map.set(id, selection);
          changed = true;
        }
        if (changed) setSelectionVersion((v) => v + 1);
      },
    };
  }, [updateComputer]);

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

  // Latest-value ref for imperative readers (use-workspace's event handlers).
  // Refreshed post-render, which is always before any event-time read.
  const value = useMemo<ToolsContextValue>(
    () => ({ browser, computer, ...selections, ...actions }),
    [browser, computer, selections, actions],
  );
  const valueRef = useRef(value);
  useMountSubscription(() => {
    valueRef.current = value;
  }, [value]);

  return (
    <ToolsActionsContext.Provider value={actions}>
      <ComputerToolsContext.Provider value={computer}>
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
export function useComputerTools(): ComputerState {
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
