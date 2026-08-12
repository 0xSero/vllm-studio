import type { StoreApi } from "zustand";
import { subscribeRuntimeActivity } from "@/features/agent/runtime/api";
import { applyRuntimeActivity } from "@/features/agent/workspace/pane-controller";
import type { WorkbenchState } from "@/features/agent/workbench/store";

const stores = new Set<StoreApi<WorkbenchState>>();
let close: (() => void) | null = null;

export function connectWorkspaceRuntime(store: StoreApi<WorkbenchState>): () => void {
  stores.add(store);
  close ??= subscribeRuntimeActivity((payload) => {
    stores.forEach((activeStore) =>
      activeStore.setState((state) => applyRuntimeActivity(state, payload), true),
    );
  }).close;
  return () => {
    stores.delete(store);
    if (stores.size > 0) return;
    close?.();
    close = null;
  };
}
