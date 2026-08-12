import { Suspense } from "react";
import { AgentWorkspace } from "@/features/agent/ui/agent-workspace-shell";
import { WorkbenchEffects } from "@/features/agent/workbench/effects";

export default function AgentPage() {
  return (
    <>
      <WorkbenchEffects />
      <Suspense fallback={null}>
        <AgentWorkspace />
      </Suspense>
    </>
  );
}
