import { useEffect } from "react";

export function useGitDiffPanelEffects(load: () => Promise<void>): void {
  useEffect(() => {
    void load();
  }, [load]);
}
