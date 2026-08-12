import { Suspense } from "react";
import { AgentWorkspace } from "@/features/agent/ui/agent-workspace-shell";
import { ToolsEffects } from "@/features/agent/tools/effects";

export default function AgentPage() {
  return (
    <>
      <ToolsEffects />
      <Suspense fallback={null}>
        <AgentWorkspace />
      </Suspense>
    </>
  );
}
