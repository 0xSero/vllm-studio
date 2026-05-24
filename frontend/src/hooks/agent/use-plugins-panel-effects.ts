// One-shot hook that fires the initial extensions listing fetch for the
// plugins panel. Lives here because the project-wide policy bans `useEffect`
// inside `src/app/agent/_components/*` — workspace components must delegate
// genuine side effects to `src/hooks/agent/use-*-effects.ts` files.

import { useEffect } from "react";

export function usePluginsPanelInitialLoadEffect(refresh: () => Promise<void>): void {
  useEffect(() => {
    void refresh();
    // Mount-once: we intentionally only run on first mount. The refresh
    // function identity changes whenever the panel mounts, which is the
    // right behaviour for our single-mount needs anyway.
  }, []);
}
