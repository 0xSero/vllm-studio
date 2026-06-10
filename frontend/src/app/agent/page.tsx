import { Suspense } from "react";
import { AgentWorkspace } from "@/features/agent/ui/agent-workspace";

export default function AgentPage() {
  return (
    <Suspense fallback={null}>
      <AgentWorkspace />
    </Suspense>
  );
}
