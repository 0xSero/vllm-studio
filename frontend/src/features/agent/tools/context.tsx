"use client";

import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useShallow } from "zustand/react/shallow";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  toolsRef,
  useToolsStore,
  type ToolsActions,
  type ToolsContextValue,
  type ToolSelectionsValue,
} from "@/features/agent/tools/store";

type CataloguePayload = Pick<ToolSelectionsValue, "skillCatalogue" | "promptTemplateCatalogue">;
type Bridge = ComponentType<{
  catalogueEnabled: boolean;
  onCatalogueLoaded: (payload: {
    skills: CataloguePayload["skillCatalogue"];
    promptTemplates: CataloguePayload["promptTemplateCatalogue"];
  }) => void;
}>;

let bridgePromise: Promise<Bridge> | null = null;

function ToolEffects({ enabled }: { enabled: boolean }) {
  const [Bridge, setBridge] = useState<Bridge | null>(null);
  useMountSubscription(() => {
    useToolsStore.getState().initialize();
    if (!enabled || Bridge) return;
    let cancelled = false;
    bridgePromise ??= import("@/features/agent/tools/effects-bridge").then(
      (module) => module.ToolsEffectsBridge,
    );
    void bridgePromise.then((component) => {
      if (!cancelled) setBridge(() => component);
    });
    return () => {
      cancelled = true;
    };
  }, [Bridge, enabled]);
  return enabled && Bridge ? (
    <Bridge
      catalogueEnabled
      onCatalogueLoaded={({ skills, promptTemplates }) =>
        useToolsStore.getState().setCatalogues({ skills, promptTemplates })
      }
    />
  ) : null;
}

export function ToolsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <ToolEffects enabled={pathname === "/agent" || pathname === "/quick"} />
      {children}
    </>
  );
}

const actionSelector = (state: ToolsContextValue): ToolsActions => ({
  setBrowserEnabled: state.setBrowserEnabled,
  setBrowserBackend: state.setBrowserBackend,
  toggleBrowserBackend: state.toggleBrowserBackend,
  toggleBrowser: state.toggleBrowser,
  setBrowserUrl: state.setBrowserUrl,
  setBrowserInput: state.setBrowserInput,
  setComputerOpen: state.setComputerOpen,
  toggleComputerOpen: state.toggleComputerOpen,
  setComputerTab: state.setComputerTab,
  selectComputerTabWithoutOpening: state.selectComputerTabWithoutOpening,
  closeComputerTab: state.closeComputerTab,
  setComputerWidth: state.setComputerWidth,
  setActiveComputerSession: state.setActiveComputerSession,
  requestFileOpen: state.requestFileOpen,
  requestContextAttach: state.requestContextAttach,
  setSelection: state.setSelection,
  hydrateSelections: state.hydrateSelections,
});

export function useToolsActions(): ToolsActions {
  return useToolsStore(useShallow(actionSelector));
}

export function useComputerTools() {
  return useToolsStore((state) => state.computer);
}

export function useBrowserTools() {
  return useToolsStore((state) => state.browser);
}

export function useToolSelections(): ToolSelectionsValue {
  const selected = useToolsStore(
    useShallow((state) => ({
      fileOpenRequest: state.fileOpenRequest,
      contextAttachRequest: state.contextAttachRequest,
      skillCatalogue: state.skillCatalogue,
      promptTemplateCatalogue: state.promptTemplateCatalogue,
      selectionFor: state.selectionFor,
      selections: state.selections,
    })),
  );
  return selected;
}

export function useToolsRef(): { current: ToolsContextValue } {
  return toolsRef;
}

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

export type { ToolsContextValue } from "@/features/agent/tools/store";
export type {
  ToolSelection,
  BrowserState,
  BrowserBackend,
  ComputerState,
  ComputerTab,
} from "@/features/agent/tools/types";
