"use client";

import { DashboardLayout } from "./layout/dashboard-layout";
import { useDashboardData } from "./use-dashboard-data";
import { useFirstRunRedirect } from "@/features/setup/use-first-run-redirect";

export default function DashboardPage() {
  useFirstRunRedirect();
  const data = useDashboardData();
  return <DashboardLayout {...data} />;
}
