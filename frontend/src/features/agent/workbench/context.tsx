"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { workbenchStore, type WorkbenchState } from "@/features/agent/workbench/store";

const WorkbenchContext = createContext<StoreApi<WorkbenchState>>(workbenchStore);

export function WorkbenchProvider({
  store,
  children,
}: {
  store: StoreApi<WorkbenchState>;
  children: ReactNode;
}) {
  return <WorkbenchContext.Provider value={store}>{children}</WorkbenchContext.Provider>;
}

export function useWorkbench<T>(selector: (state: WorkbenchState) => T): T {
  const store = useContext(WorkbenchContext);
  return useStore(store, selector);
}
