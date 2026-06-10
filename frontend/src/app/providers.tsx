"use client";

import type { ReactNode } from "react";
import { useControllerEvents } from "@/hooks/use-controller-events";
import { ProjectsProvider } from "@/features/agent/projects/context";
import { ToolsProvider } from "@/features/agent/tools/context";

function ControllerEventsListener() {
  useControllerEvents();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ProjectsProvider>
      <ToolsProvider>
        <ControllerEventsListener />
        {children}
      </ToolsProvider>
    </ProjectsProvider>
  );
}
