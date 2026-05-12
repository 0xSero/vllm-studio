"use client";

import type { ReactNode } from "react";
import { ContextManagementProvider } from "@/lib/services/context-management";
import { useControllerEvents } from "@/hooks/use-controller-events";
import { ProjectsProvider } from "@/lib/agent/projects/context";
import { ToolsProvider } from "@/lib/agent/tools/context";

function ControllerEventsListener() {
  useControllerEvents();
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ContextManagementProvider>
      <ProjectsProvider>
        <ToolsProvider>
          <ControllerEventsListener />
          {children}
        </ToolsProvider>
      </ProjectsProvider>
    </ContextManagementProvider>
  );
}
