"use client";

import type { DashboardLayoutProps } from "./dashboard-types";
import { DashboardConnectionBanner } from "./dashboard-connection-banner";
import { ControlPanel } from "../control-panel/control-panel";
import { LaunchToast } from "../launch-toast";

export function DashboardLayout(props: DashboardLayoutProps) {
  return (
    <div className="min-h-full bg-background text-foreground">
      <DashboardConnectionBanner isConnected={props.isConnected} />
      <div className="mx-auto max-w-[118rem] overflow-x-hidden px-2 py-2 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-4 2xl:px-6">
        <ControlPanel {...props} />
      </div>
      <LaunchToast launching={props.launching} launchProgress={props.launchProgress} />
    </div>
  );
}
