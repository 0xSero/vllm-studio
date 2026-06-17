"use client";

import { DashboardLayout } from "./layout/dashboard-layout";
import { recordDashboardActivity } from "./use-activity-recorder";
import { useDashboardData } from "./use-dashboard-data";

export default function DashboardPage() {
  const data = useDashboardData();
  recordDashboardActivity(avgGpuUtil(data.gpus));

  return <DashboardLayout {...data} />;
}

function avgGpuUtil(gpus: { utilization_pct?: number; utilization?: number }[]): number {
  if (gpus.length === 0) return 0;
  const sum = gpus.reduce((acc, g) => acc + (g.utilization_pct ?? g.utilization ?? 0), 0);
  return sum / gpus.length;
}
