"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ComposerPluginRef, ComposerSkillRef } from "@/lib/agent/composer-context";
import type { SessionId } from "@/lib/agent/sessions/types";
import {
  EMPTY_SELECTION,
  type BrowserState,
  type ComputerState,
  type ComputerTab,
  type ToolSelection,
  type ToolSelectionMap,
} from "./types";
import {
  clampComputerWidth,
  loadBrowserState,
  loadComputerState,
  migrateToolStorage,
  writeBrowserEnabled,
  writeComputerCanvasEnabled,
  writeComputerCanvasText,
  writeComputerTab,
  writeComputerTabs,
  writeComputerWidth,
  uniqueComputerTabs,
} from "./persistence";

export type ToolsContextValue = {
  browser: BrowserState;
  computer: ComputerState;
  /** Workspace-global plugin catalogue (loaded once on mount). */
  pluginCatalogue: ComposerPluginRef[];
  /** Workspace-global skill catalogue (loaded once on mount). */
  skillCatalogue: ComposerSkillRef[];
  /** Per-session selection — empty for sessions that haven't picked tools yet. */
  selectionFor: (sessionId: SessionId | null | undefined) => ToolSelection;
  setBrowserEnabled: (enabled: boolean) => void;
  toggleBrowser: () => void;
  setBrowserUrl: (url: string, input?: string) => void;
  setBrowserInput: (input: string) => void;
  setComputerOpen: (open: boolean) => void;
  toggleComputerOpen: () => void;
  setComputerTab: (tab: ComputerTab) => void;
  closeComputerTab: (tab: ComputerTab) => void;
  setComputerWidth: (width: number) => void;
  setCanvasEnabled: (enabled: boolean) => void;
  toggleCanvas: () => void;
  setCanvasText: (text: string) => void;
  /**
   * Replace the entire selection for a session. Pass `null` to clear it (used
   * when a session is closed / pruned).
   */
  setSelection: (sessionId: SessionId, selection: ToolSelection | null) => void;
  /** Hydrate the selection map from a persisted snapshot (e.g. on workspace boot). */
  hydrateSelections: (entries: Iterable<[SessionId, ToolSelection]>) => void;
};

const ToolsContext = createContext<ToolsContextValue | null>(null);

function buildInitialBrowser(): BrowserState {
  if (typeof window === "undefined") {
    return { enabled: false, url: "", input: "" };
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
  const [pluginCatalogue, setPluginCatalogue] = useState<ComposerPluginRef[]>([]);
  const [skillCatalogue, setSkillCatalogue] = useState<ComposerSkillRef[]>([]);
  const selectionsRef = useRef<Map<SessionId, ToolSelection>>(new Map());
  // Bump on every selection mutation so consumers re-render.
  const [selectionVersion, setSelectionVersion] = useState(0);

  // Discover the workspace-global plugin / skill catalogue once on mount.
  // Previously each ChatPane fetched these independently; now multiple panes
  // share a single fetch.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch("/api/agent/plugins?includeDisabled=1", { cache: "no-store" })
        .then((res) => res.json() as Promise<{ plugins?: ComposerPluginRef[] }>)
        .then((payload) => payload.plugins ?? [])
        .catch(() => [] as ComposerPluginRef[]),
      fetch("/api/agent/skills", { cache: "no-store" })
        .then((res) => res.json() as Promise<{ skills?: ComposerSkillRef[] }>)
        .then((payload) => payload.skills ?? [])
        .catch(() => [] as ComposerSkillRef[]),
    ]).then(([plugins, skills]) => {
      if (cancelled) return;
      setPluginCatalogue(plugins);
      setSkillCatalogue(skills);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent/canvas", { cache: "no-store" })
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{ enabled?: boolean; text?: string }>)
          : Promise.reject(new Error("Canvas fetch failed")),
      )
      .then((payload) => {
        if (cancelled) return;
        setComputer((current) => ({
          ...current,
          canvasEnabled: payload.enabled ?? current.canvasEnabled,
          canvasText: typeof payload.text === "string" ? payload.text : current.canvasText,
        }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const setBrowserEnabled = useCallback((enabled: boolean) => {
    setBrowser((current) => (current.enabled === enabled ? current : { ...current, enabled }));
    writeBrowserEnabled(enabled);
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
    setComputer((current) => ({
      ...current,
      open: !current.open,
      tab: !current.open ? current.tab || "status" : current.tab,
      tabs: uniqueComputerTabs(current.tabs.length ? current.tabs : ["status"]),
    }));
  }, []);

  const setComputerTab = useCallback((tab: ComputerTab) => {
    setComputer((current) => {
      const tabs = uniqueComputerTabs([...current.tabs, tab]);
      writeComputerTabs(tabs);
      return current.tab === tab && current.tabs === tabs
        ? current
        : { ...current, open: true, tab, tabs };
    });
    writeComputerTab(tab);
  }, []);

  const closeComputerTab = useCallback((tab: ComputerTab) => {
    if (tab === "status") return;
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
    void fetch("/api/agent/canvas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }).catch(() => undefined);
  }, []);

  const toggleCanvas = useCallback(() => {
    setComputer((current) => {
      const next = !current.canvasEnabled;
      const tabs = next ? uniqueComputerTabs([...current.tabs, "canvas"]) : current.tabs;
      writeComputerCanvasEnabled(next);
      if (next) writeComputerTabs(tabs);
      void fetch("/api/agent/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      }).catch(() => undefined);
      return {
        ...current,
        canvasEnabled: next,
        open: next ? true : current.open,
        tab: next ? "canvas" : current.tab,
        tabs,
      };
    });
  }, []);

  const setCanvasText = useCallback((text: string) => {
    if (typeof text !== "string") return;
    setComputer((current) =>
      current.canvasText === text ? current : { ...current, canvasText: text },
    );
    writeComputerCanvasText(text);
    void fetch("/api/agent/canvas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => undefined);
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

  const setSelection = useCallback((sessionId: SessionId, selection: ToolSelection | null) => {
    const map = selectionsRef.current;
    if (!selection) {
      if (!map.delete(sessionId)) return;
    } else {
      const current = map.get(sessionId);
      if (current && current.plugins === selection.plugins && current.skills === selection.skills) {
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
        existing.plugins === selection.plugins &&
        existing.skills === selection.skills
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
      pluginCatalogue,
      skillCatalogue,
      selectionFor,
      setBrowserEnabled,
      toggleBrowser,
      setBrowserUrl,
      setBrowserInput,
      setComputerOpen,
      toggleComputerOpen,
      setComputerTab,
      closeComputerTab,
      setComputerWidth,
      setCanvasEnabled,
      toggleCanvas,
      setCanvasText,
      setSelection,
      hydrateSelections,
    }),
    [
      browser,
      computer,
      pluginCatalogue,
      skillCatalogue,
      selectionFor,
      setBrowserEnabled,
      toggleBrowser,
      setBrowserUrl,
      setBrowserInput,
      setComputerOpen,
      toggleComputerOpen,
      setComputerTab,
      closeComputerTab,
      setComputerWidth,
      setCanvasEnabled,
      toggleCanvas,
      setCanvasText,
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

export type { ToolSelection, ToolSelectionMap, BrowserState, ComputerState, ComputerTab };
