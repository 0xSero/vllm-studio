import { removeSession, setSession } from "@/features/agent/runtime/store";
import type { AgentModel, WorkspaceAction, WorkspaceState } from "@/features/agent/workspace/types";
import {
  applyUrlNavigation,
  closePane,
  focusPane,
  focusPaneSession,
  openSessionPayloadInPane,
  patchActiveTab,
  patchWorkspaceSession,
  setPaneSession,
  setWorkspaceSplitRatio,
  splitPaneWithPayload,
  splitTabIntoNewPane,
  renameTab,
} from "@/features/agent/workspace/pane-controller";

function chooseModelId(
  models: AgentModel[],
  currentModelId: string,
  preferredModelId?: string,
): string {
  if (preferredModelId && models.some((model) => model.id === preferredModelId)) {
    return preferredModelId;
  }
  if (currentModelId && models.some((model) => model.id === currentModelId)) {
    return currentModelId;
  }
  return models.find((model) => model.active)?.id || models[0]?.id || "";
}

export function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "hydrate": {
      const next = { ...state, ...action.state };
      return { ...next, hydrated: action.hydrated ?? next.hydrated };
    }
    case "setModelsLoading":
      return { ...state, modelsLoading: action.loading };
    case "setModels":
      return {
        ...state,
        models: action.models,
        selectedModel: chooseModelId(action.models, state.selectedModel, action.preferredModelId),
        modelsLoading: false,
      };
    case "setSelectedModel":
      return { ...state, selectedModel: action.modelId };
    case "setSetupWarning":
      return { ...state, setupWarning: action.warning };
    case "setError":
      return { ...state, error: action.error };
    case "setSplitRatio":
      return setWorkspaceSplitRatio(state, action);
    case "focusPane":
      return focusPane(state, action);
    case "focusPaneSession":
      return focusPaneSession(state, action);
    case "closePane":
      return closePane(state, action);
    case "openSessionPayloadInPane":
      return openSessionPayloadInPane(state, action);
    case "splitPaneWithPayload":
      return splitPaneWithPayload(state, action);
    case "renameTab":
      return renameTab(state, action);
    case "splitTab":
      return splitTabIntoNewPane(state, action);
    case "setPaneSession":
      return setPaneSession(state, action);
    case "setDetachedSession":
      return { ...state, sessions: setSession(state.sessions, action.session) };
    case "removeDetachedSession":
      return { ...state, sessions: removeSession(state.sessions, action.sessionId) };
    case "patchSession":
      return patchWorkspaceSession(state, action.sessionId, action.patch);
    case "patchActiveTab":
      return patchActiveTab(state, action);
    case "urlNavRequested": {
      const next = applyUrlNavigation(state, action);
      return next === state
        ? state
        : { ...next, hydrated: action.newSession || Boolean(action.sessionId) || next.hydrated };
    }
    // "notifySessionsChanged" carries no state change; it only drives effects.
    default:
      return state;
  }
}
