"use client";

import type { ReactNode } from "react";
import { useControllerEvents } from "@/hooks/use-controller-events";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { initAppStoreListeners } from "@/store";
import { ProjectsProvider } from "@/features/agent/projects/context";
import { ToolsProvider } from "@/features/agent/tools/context";

function GlobalListeners() {
  useControllerEvents();
  useMountSubscription(() => {
    initAppStoreListeners();
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ProjectsProvider>
      <ToolsProvider>
        <GlobalListeners />
        {children}
      </ToolsProvider>
    </ProjectsProvider>
  );
}
