"use client";

import { AgentWorkspaceShell } from "@/features/agent/ui/agent-workspace-shell";
import { useWorkspace } from "@/features/agent/ui/use-workspace";

export function AgentWorkspace() {
  const { state, dispatch, handles } = useWorkspace();
  return <AgentWorkspaceShell state={state} dispatch={dispatch} handles={handles} />;
}
