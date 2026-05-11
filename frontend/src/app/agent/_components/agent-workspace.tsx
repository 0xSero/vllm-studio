"use client";

import { AgentWorkspaceShell } from "./agent-workspace-shell";
import { useWorkspace } from "./use-workspace";

export function AgentWorkspace() {
  const { state, dispatch, handles } = useWorkspace();
  return <AgentWorkspaceShell state={state} dispatch={dispatch} handles={handles} />;
}
