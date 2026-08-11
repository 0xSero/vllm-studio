"use client";

import { useDashboardData } from "./use-dashboard-data";
import { useFirstRunRedirect } from "@/features/setup/use-first-run-redirect";
import { DashboardConnectionBanner } from "./layout/dashboard-connection-banner";
import { ControlPanel } from "./control-panel/control-panel";
import { LaunchToast } from "./launch-toast";

export default function DashboardPage() {
  useFirstRunRedirect();
  const data = useDashboardData();
  return (
    <div className="min-h-full bg-background text-foreground">
      <DashboardConnectionBanner isConnected={data.isConnected} />
      <div className="mx-auto max-w-[118rem] overflow-x-hidden px-3 py-3 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-6 2xl:px-10">
        <ControlPanel {...data} />
      </div>
      <LaunchToast launching={data.launching} launchProgress={data.launchProgress} />
    </div>
  );
}
