"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { Effect } from "effect";
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
  loadBrowserState,
  loadComputerState,
  migrateToolStorage,
  uniqueComputerTabs,
  writeBrowserBackend,
  writeBrowserEnabled,
  writeComputerCanvasEnabled,
  writeComputerCanvasText,
  writeComputerTab,
  writeComputerTabs,
  writeComputerWidth,
} from "@/features/agent/tools/persistence";

export type ToolsContextValue = {
  browser: BrowserState;
  computer: ComputerState;
  fileOpenRequest: FileOpenRequest | null;
  contextAttachRequest: ContextAttachRequest | null;
  skillCatalogue: ComposerSkillRef[];
  promptTemplateCatalogue: ComposerPromptTemplateRef[];
  selectionFor: (sessionId: SessionId | null | undefined) => ToolSelection;
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
  setCanvasEnabled: (enabled: boolean) => void;
  toggleCanvas: () => void;
  setCanvasText: (text: string) => void;
  setActiveCanvasSession: (sessionId: SessionId | null) => void;
  requestFileOpen: (path: string) => void;
  requestContextAttach: (request: { label: string; path?: string; content: string }) => void;
  /**
   * Replace the entire selection for a session. Pass `null` to clear it (used
   * when a session is closed / pruned).
   */
  setSelection: (sessionId: SessionId, selection: ToolSelection | null) => void;
  hydrateSelections: (entries: Iterable<[SessionId, ToolSelection]>) => void;
};

const ToolsContext = createContext<ToolsContextValue | null>(null);

const canvasSessionQuery = (sessionId: SessionId | null | undefined): string =>
  sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";

function buildInitialBrowser(): BrowserState {
  if (typeof window === "undefined") {
    return { enabled: false, backend: "embedded", url: "", input: "" };
  }
  migrateToolStorage();
  return loadBrowserState();
}

function buildInitialComputer(): ComputerState {
  if (typeof window === "undefined") {
    return {
      open: false,
      tab: "status",
      tabs: ["status"],
      width: 0,
      canvasEnabled: false,
      canvasText: "",
    };
  }
  return loadComputerState();
}

export function ToolsProvider({ children }: { children: ReactNode }) {
  const [browser, setBrowser] = useState<BrowserState>(() => buildInitialBrowser());
  const [computer, setComputer] = useState<ComputerState>(() => buildInitialComputer());
  const [fileOpenRequest, setFileOpenRequest] = useState<FileOpenRequest | null>(null);
  const [contextAttachRequest, setContextAttachRequest] = useState<ContextAttachRequest | null>(
    null,
  );
  const [skillCatalogue, setSkillCatalogue] = useState<ComposerSkillRef[]>([]);
  const [promptTemplateCatalogue, setPromptTemplateCatalogue] = useState<
    ComposerPromptTemplateRef[]
  >([]);
  const selectionsRef = useRef<Map<SessionId, ToolSelection>>(new Map());
  // Bump on every selection mutation so consumers re-render.
  const [selectionVersion, setSelectionVersion] = useState(0);
  const activeCanvasSessionRef = useRef<SessionId | null>(null);
  const [activeCanvasSessionId, setActiveCanvasSessionIdState] = useState<SessionId | null>(null);
  useToolsCatalogueEffects({
    onLoaded: ({ skills, promptTemplates }) => {
      setSkillCatalogue(skills);
      setPromptTemplateCatalogue(promptTemplates);
    },
  });
  useCanvasEffects({ setComputer, sessionId: activeCanvasSessionId });

  const setActiveCanvasSession = useCallback((sessionId: SessionId | null) => {
    activeCanvasSessionRef.current = sessionId;
    setActiveCanvasSessionIdState(sessionId);
  }, []);

  const setBrowserEnabled = useCallback((enabled: boolean) => {
    setBrowser((current) => (current.enabled === enabled ? current : { ...current, enabled }));
    writeBrowserEnabled(enabled);
  }, []);

  const setBrowserBackend = useCallback((backend: BrowserBackend) => {
    setBrowser((current) => (current.backend === backend ? current : { ...current, backend }));
    writeBrowserBackend(backend);
  }, []);

  const toggleBrowserBackend = useCallback(() => {
    setBrowser((current) => {
      const backend = current.backend === "sitegeist" ? "embedded" : "sitegeist";
      writeBrowserBackend(backend);
      return { ...current, backend };
    });
  }, []);

  const toggleBrowser = useCallback(() => {
    setBrowser((current) => {
      const next = !current.enabled;
      writeBrowserEnabled(next);
      return { ...current, enabled: next };
    });
  }, []);

  const setBrowserUrl = useCallback((url: string, input?: string) => {
    if (typeof url !== "string" || !url.trim()) return;
    setBrowser((current) => ({
      ...current,
      url,
      input: input ?? current.input,
    }));
  }, []);

  const setBrowserInput = useCallback((input: string) => {
    if (typeof input !== "string") return;
    setBrowser((current) => ({ ...current, input }));
  }, []);

  const setComputerOpen = useCallback((open: boolean) => {
    if (!open) {
      setBrowser((current) => {
        if (!current.enabled) return current;
        writeBrowserEnabled(false);
        return { ...current, enabled: false };
      });
    }
    setComputer((current) =>
      current.open === open
        ? current
        : {
            ...current,
            open,
            tab: open ? current.tab || "status" : current.tab,
            tabs: uniqueComputerTabs(current.tabs.length ? current.tabs : ["status"]),
          },
    );
  }, []);

  const toggleComputerOpen = useCallback(() => {
    if (computer.open) {
      setBrowser((current) => {
        if (!current.enabled) return current;
        writeBrowserEnabled(false);
        return { ...current, enabled: false };
      });
    }
    setComputer((current) => {
      const nextOpen = !current.open;
      return {
        ...current,
        open: nextOpen,
        tab: nextOpen ? current.tab || "status" : current.tab,
        tabs: uniqueComputerTabs(current.tabs.length ? current.tabs : ["status"]),
      };
    });
  }, [computer.open]);

  const setComputerTab = useCallback((tab: ComputerTab) => {
    setComputer((current) => {
      const tabs = uniqueComputerTabs([...current.tabs, tab]);
      writeComputerTabs(tabs);
      return current.tab === tab && current.tabs === tabs
        ? current
        : { ...current, open: true, tab, tabs };
    });
    writeComputerTab(tab);
    setBrowser((current) => {
      const enabled = tab === "browser";
      if (current.enabled === enabled) return current;
      writeBrowserEnabled(enabled);
      return { ...current, enabled };
    });
  }, []);

  // Register + select a tab WITHOUT force-opening the computer panel. Used when
  // the model drives a background tool (e.g. the browser): it should route to the
  // right tab and pre-select it, but must not pop the panel open on every prompt
  // — the user controls whether the panel is visible.
  const selectComputerTabWithoutOpening = useCallback((tab: ComputerTab) => {
    setComputer((current) => {
      const tabs = uniqueComputerTabs([...current.tabs, tab]);
      writeComputerTabs(tabs);
      writeComputerTab(tab);
      return current.tab === tab && current.tabs === tabs ? current : { ...current, tab, tabs };
    });
    if (tab === "browser") {
      setBrowser((current) => {
        if (current.enabled) return current;
        writeBrowserEnabled(true);
        return { ...current, enabled: true };
      });
    }
  }, []);

  const closeComputerTab = useCallback((tab: ComputerTab) => {
    if (tab === "status" || tab === "tools") return;
    if (tab === "browser") {
      setBrowser((current) => {
        if (!current.enabled) return current;
        writeBrowserEnabled(false);
        return { ...current, enabled: false };
      });
    }
    setComputer((current) => {
      const tabs = uniqueComputerTabs(current.tabs.filter((item) => item !== tab));
      const activeTab = current.tab === tab ? (tabs[tabs.length - 1] ?? "status") : current.tab;
      writeComputerTabs(tabs);
      writeComputerTab(activeTab);
      return { ...current, tab: activeTab, tabs };
    });
  }, []);

  const setComputerWidth = useCallback((width: number) => {
    if (!Number.isFinite(width)) return;
    const clamped = clampComputerWidth(width);
    setComputer((current) =>
      current.width === clamped ? current : { ...current, width: clamped },
    );
    writeComputerWidth(clamped);
  }, []);

  const setCanvasEnabled = useCallback((enabled: boolean) => {
    setComputer((current) =>
      current.canvasEnabled === enabled ? current : { ...current, canvasEnabled: enabled },
    );
    writeComputerCanvasEnabled(enabled);
    // Best-effort server sync; the use-canvas-effects hook owns full hydration
    // and reconciliation. Failures here are harmless because the next mount
    // will re-read the server-side document.
    void Effect.runPromise(syncCanvasEffect(activeCanvasSessionRef.current, { enabled }));
  }, []);

  const toggleCanvas = useCallback(() => {
    setComputer((current) => {
      const next = !current.canvasEnabled;
      const tabs = next ? uniqueComputerTabs([...current.tabs, "canvas"]) : current.tabs;
      writeComputerCanvasEnabled(next);
      if (next) writeComputerTabs(tabs);
      void Effect.runPromise(syncCanvasEffect(activeCanvasSessionRef.current, { enabled: next }));
      return {
        ...current,
        canvasEnabled: next,
        tabs,
        // When enabling the canvas, focus it; when disabling, fall back to status.
        tab: next ? "canvas" : current.tab === "canvas" ? "status" : current.tab,
        open: next ? true : current.open,
      };
    });
  }, []);

  const setCanvasText = useCallback((text: string) => {
    setComputer((current) =>
      current.canvasText === text ? current : { ...current, canvasText: text },
    );
    writeComputerCanvasText(text);
    void Effect.runPromise(
      syncCanvasEffect(activeCanvasSessionRef.current, { enabled: true, text }),
    );
  }, []);

  const requestFileOpen = useCallback((path: string) => {
    const clean = path.trim();
    if (!clean) return;
    setComputer((current) => ({ ...current, open: true, tab: "files" }));
    writeComputerTab("files");
    setFileOpenRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      path: clean,
    }));
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

  const value = useMemo<ToolsContextValue>(
    () => ({
      browser,
      computer,
      fileOpenRequest,
      contextAttachRequest,
      skillCatalogue,
      promptTemplateCatalogue,
      selectionFor,
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
      setComputerWidth,
      setCanvasEnabled,
      toggleCanvas,
      setCanvasText,
      setActiveCanvasSession,
      requestFileOpen,
      requestContextAttach,
      setSelection,
      hydrateSelections,
    }),
    [
      browser,
      computer,
      fileOpenRequest,
      contextAttachRequest,
      skillCatalogue,
      promptTemplateCatalogue,
      selectionFor,
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
      setComputerWidth,
      setCanvasEnabled,
      toggleCanvas,
      setCanvasText,
      setActiveCanvasSession,
      requestFileOpen,
      requestContextAttach,
      setSelection,
      hydrateSelections,
    ],
  );

  return <ToolsContext.Provider value={value}>{children}</ToolsContext.Provider>;
}

export function useTools(): ToolsContextValue {
  const value = useContext(ToolsContext);
  if (!value) throw new Error("useTools must be used within a ToolsProvider");
  return value;
}

export type {
  ToolSelection,
  ToolSelectionMap,
  BrowserState,
  BrowserBackend,
  ComputerState,
  ComputerTab,
};

function useCanvasEffects({
  setComputer,
  sessionId,
}: {
  setComputer: Dispatch<SetStateAction<ComputerState>>;
  sessionId?: SessionId | null;
}): void {
  const subscribe = useCallback(
    (_notify: () => void) => {
      let cancelled = false;
      const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
      void Effect.runPromise(
        loadCanvasEffect(query).pipe(
          Effect.map((payload) => {
            if (cancelled) return;
            setComputer((current) => ({
              ...current,
              canvasEnabled: payload.enabled ?? current.canvasEnabled,
              canvasText: typeof payload.text === "string" ? payload.text : current.canvasText,
            }));
          }),
          Effect.catch(() => Effect.void),
        ),
      );
      return () => {
        cancelled = true;
      };
    },
    [setComputer, sessionId],
  );

  useSyncExternalStore(subscribe, getCanvasSnapshot, getCanvasSnapshot);
}

const getCanvasSnapshot = (): number => 0;

type UseToolsCatalogueEffectsOptions = {
  onLoaded: (payload: {
    skills: ComposerSkillRef[];
    promptTemplates: ComposerPromptTemplateRef[];
  }) => void;
};

function useToolsCatalogueEffects({ onLoaded }: UseToolsCatalogueEffectsOptions): void {
  const onLoadedRef = useRef(onLoaded);
  const subscribe = useCallback((_notify: () => void) => {
    let cancelled = false;
    void Effect.runPromise(
      loadToolsCatalogueEffect().pipe(
        Effect.map((payload) => {
          if (!cancelled) onLoadedRef.current(payload);
        }),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useSyncExternalStore(subscribe, getToolsCatalogueSnapshot, getToolsCatalogueSnapshot);
}

function syncCanvasEffect(
  sessionId: SessionId | null | undefined,
  payload: { enabled: boolean; text?: string },
): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () =>
      fetch(`/api/agent/canvas${canvasSessionQuery(sessionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    catch: () => undefined,
  }).pipe(
    Effect.map(() => undefined),
    Effect.catch(() => Effect.void),
  );
}

function loadCanvasEffect(
  query: string,
): Effect.Effect<{ enabled?: boolean; text?: string }, unknown> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(`/api/agent/canvas${query}`, { cache: "no-store" }),
      catch: (error) => error,
    });
    if (!response.ok) return yield* Effect.fail(new Error("Canvas fetch failed"));
    return yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ enabled?: boolean; text?: string }>,
      catch: (error) => error,
    });
  });
}

function loadToolsCatalogue(): Promise<{
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
}> {
  return Effect.runPromise(loadToolsCatalogueEffect());
}

function loadToolsCatalogueEffect(): Effect.Effect<{
  skills: ComposerSkillRef[];
  promptTemplates: ComposerPromptTemplateRef[];
}> {
  return Effect.gen(function* () {
    const [skills, promptTemplates] = yield* Effect.all([
      loadCatalogueListEffect<ComposerSkillRef>("/api/agent/skills", "skills"),
      loadCatalogueListEffect<ComposerPromptTemplateRef>(
        "/api/agent/prompt-templates",
        "templates",
      ),
    ] as const);
    return { skills, promptTemplates };
  });
}

function loadCatalogueListEffect<TItem>(url: string, key: string): Effect.Effect<TItem[]> {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(url, { cache: "no-store" }),
      catch: (error) => error,
    });
    const payload = yield* Effect.tryPromise({
      try: () => response.json() as Promise<Record<string, TItem[] | undefined>>,
      catch: (error) => error,
    });
    return payload[key] ?? [];
  }).pipe(Effect.catch(() => Effect.succeed([])));
}

const getToolsCatalogueSnapshot = (): number => 0;
