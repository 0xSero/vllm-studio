"use client";

import { AppContentColumn, Button, SearchInput, SegmentedControl } from "@/ui";
import { ChevronRight, Clock, Menu, Plus } from "@/ui/icon-registry";
import { useAppStore } from "@/store";
import type { Automation } from "@shared/agent/automation";
import {
  filterAutomations,
  relativeTime,
  scheduleLabel,
  type AutomationFilter,
} from "./automation-model";

export function AutomationList({
  automations,
  loading,
  query,
  filter,
  selectedId,
  onQueryChange,
  onFilterChange,
  onCreate,
  onSelect,
}: {
  automations: readonly Automation[];
  loading: boolean;
  query: string;
  filter: AutomationFilter;
  selectedId: string | null;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: AutomationFilter) => void;
  onCreate: () => void;
  onSelect: (automation: Automation) => void;
}) {
  const setMobileNavOpen = useAppStore((s) => s.setMobileNavOpen);
  const visible = filterAutomations(automations, query, filter);

  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-(--ui-bg)">
      <AppContentColumn>
        <header className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="-ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-(--ui-muted) transition-[background-color,color] duration-[var(--motion-fast)] hover:bg-(--ui-hover) hover:text-(--ui-fg) md:hidden"
            aria-label="Open navigation menu"
            aria-controls="mobile-navigation-drawer"
          >
            <Menu className="pointer-events-none h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[length:var(--fs-lg)] font-medium tracking-[-0.01em] text-(--ui-fg)">
              Automations
            </h1>
            <p className="mt-0.5 text-[length:var(--fs-xs)] leading-4 text-(--ui-muted)">
              Schedule recurring work with Local Studio agents.
            </p>
          </div>
          <Button size="sm" onClick={onCreate} icon={<Plus className="h-3.5 w-3.5" />}>
            New automation
          </Button>
        </header>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <SegmentedControl
            value={filter}
            onChange={onFilterChange}
            size="sm"
            items={[
              { id: "all", label: "All" },
              { id: "active", label: "Active" },
              { id: "paused", label: "Paused" },
            ]}
          />
          <SearchInput
            value={query}
            onChange={onQueryChange}
            placeholder="Search automations"
            className="w-full sm:w-56"
          />
        </div>

        <div className="mt-2.5 flex items-center px-3 text-[length:var(--fs-2xs)] uppercase tracking-[0.06em] text-(--ui-muted)/65">
          <span className="min-w-0 flex-1">Name</span>
          <span className="hidden w-44 sm:block">Schedule</span>
          <span className="hidden w-32 text-right md:block">Status</span>
          <span className="w-6" />
        </div>

        {loading ? (
          <ListMessage title="Loading scheduled tasks…" />
        ) : visible.length === 0 ? (
          <ListMessage
            title={automations.length === 0 ? "No automations yet" : "No matching automations"}
            detail={
              automations.length === 0
                ? "Create one to run a task on a schedule."
                : "Try a different search or status filter."
            }
            action={automations.length === 0 ? onCreate : undefined}
          />
        ) : (
          <div
            role="list"
            className="mt-1 overflow-hidden rounded-[8px] border border-(--ui-separator) bg-(--ui-surface)/45"
          >
            {visible.map((automation) => {
              const selected = automation.id === selectedId;
              const paused = automation.status === "paused";
              return (
                <button
                  key={automation.id}
                  type="button"
                  role="listitem"
                  onClick={() => onSelect(automation)}
                  className={`group flex min-h-12 w-full items-center border-b border-(--ui-separator)/70 px-3 text-left transition-[background-color,color] duration-[var(--motion-fast)] last:border-b-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-(--focus-ring) ${
                    selected ? "bg-(--ui-active)" : "hover:bg-(--ui-hover)/70"
                  }`}
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2.5 pr-3">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        paused
                          ? "bg-(--ui-muted)/45"
                          : automation.lastRun?.outcome === "error"
                            ? "bg-(--ui-danger)"
                            : "bg-(--ui-accent)"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[length:var(--fs-sm)] font-medium text-(--ui-fg)">
                          {automation.name}
                        </span>
                        {automation.unread ? (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--ui-accent)"
                            aria-label="Unread run"
                          />
                        ) : null}
                      </span>
                      <span className="block truncate text-[length:var(--fs-xs)] text-(--ui-muted)/75">
                        {automation.prompt}
                      </span>
                    </span>
                  </span>
                  <span className="hidden w-44 min-w-0 items-center gap-1.5 pr-3 text-[length:var(--fs-xs)] text-(--ui-muted) sm:flex">
                    <Clock className="h-3 w-3 shrink-0" />
                    <span className="truncate">{scheduleLabel(automation.schedule)}</span>
                  </span>
                  <span className="hidden w-32 text-right text-[length:var(--fs-xs)] text-(--ui-muted) md:block">
                    {paused ? "Paused" : `Next ${relativeTime(automation.nextRunAt)}`}
                  </span>
                  <ChevronRight className="ml-2 h-3.5 w-3.5 shrink-0 text-(--ui-muted)/50 transition-transform duration-[var(--motion-fast)] group-hover:translate-x-0.5 group-hover:text-(--ui-muted)" />
                </button>
              );
            })}
          </div>
        )}
      </AppContentColumn>
    </section>
  );
}

function ListMessage({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: () => void;
}) {
  return (
    <div className="mt-1 flex min-h-48 items-center justify-center rounded-[8px] border border-(--ui-separator) bg-(--ui-surface)/35 px-8 text-center">
      <div className="max-w-xs">
        <Clock className="mx-auto h-4 w-4 text-(--ui-muted)/65" />
        <div className="mt-2 text-[length:var(--fs-sm)] font-medium text-(--ui-fg)/90">{title}</div>
        {detail ? (
          <p className="mt-1 text-[length:var(--fs-xs)] leading-4 text-(--ui-muted)">{detail}</p>
        ) : null}
        {action ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={action}
            icon={<Plus className="h-3.5 w-3.5" />}
            className="mt-3"
          >
            New automation
          </Button>
        ) : null}
      </div>
    </div>
  );
}
