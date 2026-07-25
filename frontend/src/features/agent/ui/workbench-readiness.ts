import type { AgentModel, WorkspaceControllerStatus } from "@/features/agent/workspace/types";

export type WorkbenchReadinessKind =
  | "connecting"
  | "authentication"
  | "offline"
  | "error"
  | "empty"
  | "starting"
  | "stopped"
  | "ready";

export type WorkbenchReadinessAction = "retry" | "settings" | "models" | "status";

export type WorkbenchReadiness = {
  kind: WorkbenchReadinessKind;
  title: string;
  detail: string;
  placeholder: string;
  model: AgentModel | null;
  primaryAction?: WorkbenchReadinessAction;
  secondaryAction?: WorkbenchReadinessAction;
};

type WorkbenchReadinessInput = {
  models: AgentModel[];
  selectedModelId: string;
  loading: boolean;
  error: string;
  controllerStatus: WorkspaceControllerStatus | null;
};

function modelLabel(model: AgentModel): string {
  return model.rawId || model.name || model.id;
}

function modelCanChat(model: AgentModel): boolean {
  return !model.controllerUrl || model.active;
}

function connectionErrorReadiness(error: string): WorkbenchReadiness {
  const normalized = error.toLowerCase();
  if (normalized.includes("unauthorized") || normalized.includes("401")) {
    return {
      kind: "authentication",
      title: "Controller authentication failed",
      detail: "Workbench could not authenticate with the active controller.",
      placeholder: "Update the controller connection to continue",
      model: null,
      primaryAction: "settings",
      secondaryAction: "retry",
    };
  }
  if (
    normalized.includes("fetch failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("econnrefused") ||
    normalized.includes("socket") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("unreachable")
  ) {
    return {
      kind: "offline",
      title: "Controller unavailable",
      detail: "Workbench cannot reach the active controller yet.",
      placeholder: "Reconnect to the controller to continue",
      model: null,
      primaryAction: "retry",
      secondaryAction: "settings",
    };
  }
  return {
    kind: "error",
    title: "Workbench needs attention",
    detail: error || "The model list could not be loaded.",
    placeholder: "Resolve the controller issue to continue",
    model: null,
    primaryAction: "retry",
    secondaryAction: "settings",
  };
}

export function deriveWorkbenchReadiness({
  models,
  selectedModelId,
  loading,
  error,
  controllerStatus,
}: WorkbenchReadinessInput): WorkbenchReadiness {
  const selected = models.find((model) => model.id === selectedModelId) ?? null;
  if (selected && modelCanChat(selected)) {
    return {
      kind: "ready",
      title: `${modelLabel(selected)} is ready`,
      detail: "Connected to the active controller and ready for your first message.",
      placeholder: "Do anything",
      model: selected,
    };
  }
  if (controllerStatus?.launching || (controllerStatus?.running && !models.some(modelCanChat))) {
    return {
      kind: "starting",
      title: "Your model is starting",
      detail: "Local model startup can take several minutes on the first run.",
      placeholder: "Wait for the model to finish starting",
      model: selected,
      primaryAction: "status",
      secondaryAction: "retry",
    };
  }
  if (loading && models.length === 0) {
    return {
      kind: "connecting",
      title: "Connecting to your controller",
      detail: "Checking for a chat model that is ready to use.",
      placeholder: "Connecting to your controller…",
      model: null,
    };
  }
  if (error) return connectionErrorReadiness(error);
  if (models.length === 0) {
    return {
      kind: "empty",
      title: "No chat models yet",
      detail: "Download or configure a Serve, then launch it to start chatting.",
      placeholder: "Set up a model to start chatting",
      model: null,
      primaryAction: "models",
      secondaryAction: "retry",
    };
  }
  const activeModel = models.find(modelCanChat) ?? null;
  if (activeModel) {
    return {
      kind: "ready",
      title: `${modelLabel(activeModel)} is ready`,
      detail: "Connected to the active controller and ready for your first message.",
      placeholder: "Do anything",
      model: activeModel,
    };
  }
  return {
    kind: "stopped",
    title: selected ? `${modelLabel(selected)} is not running` : "No model is running",
    detail: "Launch a saved Serve, then return to Workbench to start chatting.",
    placeholder: selected ? `Start ${modelLabel(selected)} to chat` : "Start a model to chat",
    model: selected,
    primaryAction: "models",
    secondaryAction: "retry",
  };
}

export function workbenchModelReady(readiness: WorkbenchReadiness): boolean {
  return readiness.kind === "ready";
}
