import { useEffect } from "react";

export function useAgentWorkspaceNavigationEffects(runNavigation: () => void): void {
  useEffect(() => {
    runNavigation();
  }, [runNavigation]);
}
