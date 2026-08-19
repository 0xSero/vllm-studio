"use client";

import { useState, type ReactNode } from "react";
import { AppPage, PageState, RefreshButton, TabbedPage } from "@/ui";
import { Activity, AlertTriangle, Server, Sparkles } from "@/ui/icon-registry";
import { formatNumber } from "@/lib/formatters";
import type { UsageStats } from "@/lib/types";
import { useUsage } from "./use-usage";
import { UsageSkeleton } from "./usage-skeleton";
import { UsageModelsTab } from "./usage-models-tab";
import { UsageActivityTab } from "./usage-activity-tab";
import { UsageControllerTab } from "./usage-controller-tab";
import { UsageErrorsTab } from "./usage-errors-tab";

type UsageTab = "models" | "activity" | "routes" | "errors";

const USAGE_TABS: Array<{ id: UsageTab; label: string; icon: ReactNode }> = [
  { id: "models", label: "Models", icon: <Sparkles className="h-3.5 w-3.5" /> },
  { id: "activity", label: "Activity", icon: <Activity className="h-3.5 w-3.5" /> },
  { id: "routes", label: "Controller", icon: <Server className="h-3.5 w-3.5" /> },
  { id: "errors", label: "Errors", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
];

const TAB_HEADINGS: Record<UsageTab, { title: string; description: string }> = {
  models: {
    title: "By model",
    description:
      "What each model was asked to do and how fast it did it — prefill, decode, time to first token, and the tail of the latency distribution.",
  },
  activity: {
    title: "Activity",
    description:
      "When the traffic arrives: hour of day, day by day, and the busiest days this machine has handled.",
  },
  routes: {
    title: "Controller",
    description:
      "The process in front of the models — every route it has served, the status codes it returned, and how reliable the agent's tools are.",
  },
  errors: {
    title: "Errors",
    description:
      "Failed requests and failed tool calls, newest first, with the message the controller actually recorded.",
  },
};

/** The left half of the context strip: what window the tab's numbers cover. */
const tabScope = (tab: UsageTab, stats: UsageStats): { scale: string; detail: string } => {
  if (tab === "models") {
    return {
      scale: `${stats.by_model.length} ${stats.by_model.length === 1 ? "model" : "models"}`,
      detail: `${formatNumber(stats.totals.total_requests)} requests · ${formatNumber(stats.totals.total_tokens)} tokens proxied`,
    };
  }
  if (tab === "activity") {
    return {
      scale: `${stats.daily.length} days recorded`,
      detail: `${formatNumber(stats.recent_activity.last_24h_requests)} requests in the last 24 hours`,
    };
  }
  if (tab === "routes") {
    const controller = stats.controller;
    return {
      scale: controller ? `${controller.by_path.length} routes` : "No controller telemetry",
      detail: controller
        ? `${formatNumber(controller.totals.total_requests)} controller requests · ${controller.totals.success_rate.toFixed(1)}% served`
        : "This controller build does not report request stats.",
    };
  }
  const requests = stats.controller?.recent_errors.length ?? 0;
  const tools = stats.controller?.function_calls?.recent_errors.length ?? 0;
  return {
    scale: `${requests + tools} recorded`,
    detail: `${requests} request errors · ${tools} tool-call errors`,
  };
};

/**
 * Usage as four tables.
 *
 * The page used to open on one number at display size and then show three
 * proportional-bar cards, while roughly seventy percent of the payload it
 * already fetched — every throughput field, the whole controller block, the
 * hour-of-day pattern — was normalised and dropped. It is now the Models page's
 * sibling: the same tabbed shell, the same table language, and each tab's stat
 * strip summarising the rows directly beneath it rather than floating free.
 */
export default function UsagePage() {
  const { stats, loading, error, loadStats } = useUsage();
  const [tab, setTab] = useState<UsageTab>("models");

  if (loading && !stats) return <UsageSkeleton />;

  const pageState = PageState({
    loading,
    data: stats,
    hasData: Boolean(stats),
    error,
    onLoad: loadStats,
  });
  if (pageState) return <AppPage>{pageState}</AppPage>;
  if (!stats) return null;

  const heading = TAB_HEADINGS[tab];
  const scope = tabScope(tab, stats);

  return (
    <TabbedPage
      title="Usage"
      description="Everything this controller has proxied — per model, over time, and where it failed."
      width="sm"
      tabs={USAGE_TABS}
      activeTab={tab}
      onSelectTab={setTab}
      actions={
        <RefreshButton
          onRefresh={loadStats}
          loading={loading}
          label="Refresh usage"
          className="h-8 w-8"
        />
      }
    >
      <section>
        <h2 className="text-[length:var(--fs-2xl)] font-medium tracking-[-0.015em] text-(--ui-fg)">
          {heading.title}
        </h2>
        <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">{heading.description}</p>

        {/* One quiet line of context, matching the Models page: the window
            these numbers cover, and how much of it there is. */}
        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-(--ui-separator) pb-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="text-[length:var(--fs-md)] text-(--ui-fg)">{scope.scale}</span>
            <span className="truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
              {scope.detail}
            </span>
          </div>
        </div>

        <div className="mt-6">
          {tab === "models" ? (
            <UsageModelsTab stats={stats} />
          ) : tab === "activity" ? (
            <UsageActivityTab stats={stats} />
          ) : tab === "routes" ? (
            <UsageControllerTab stats={stats} />
          ) : (
            <UsageErrorsTab stats={stats} />
          )}
        </div>
      </section>
    </TabbedPage>
  );
}
