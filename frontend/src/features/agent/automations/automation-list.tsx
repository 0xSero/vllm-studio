"use client";

import { useRef, useState, type ReactNode } from "react";
import { Alert, Button, MenuItem, SearchInput, SegmentedControl, Spinner } from "@/ui";
import { POPOVER_MENU_CLASS } from "@/ui/popover";
import { AlertCircle, Check, Clock, MoreIcon, Pause, Play, Plus, Trash2 } from "@/ui/icon-registry";
import { useClickOutside } from "@/features/agent/hooks/use-click-outside";
import type { Automation } from "@shared/agent/automation";
import {
  AUTOMATION_SUGGESTIONS,
  filterAutomations,
  nextRunLabel,
  scheduleLabel,
  sourceLabel,
  unreadAutomations,
  type AutomationFilter,
  type AutomationSuggestion,
} from "./automation-model";

const ROW_MENU_CLASS = `absolute right-1 top-7 isolate z-[60] min-w-[168px] ${POPOVER_MENU_CLASS}`;

export function AutomationList({
  automations,
  loading,
  error,
  query,
  filter,
  selectedId,
  runningId,
  pendingId,
  onQueryChange,
  onFilterChange,
  onCreate,
  onSelect,
  onRun,
  onToggleStatus,
  onDelete,
  onMarkAllRead,
  onUseSuggestion,
  onRetry,
}: {
  automations: readonly Automation[];
  loading: boolean;
  error: string;
  query: string;
  filter: AutomationFilter;
  selectedId: string | null;
  runningId: string | null;
  pendingId: string | null;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: AutomationFilter) => void;
  onCreate: () => void;
  onSelect: (automation: Automation) => void;
  onRun: (automation: Automation) => void;
  onToggleStatus: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
  onMarkAllRead: () => void;
  onUseSuggestion: (suggestion: AutomationSuggestion) => void;
  onRetry: () => void;
}) {
  const visible = filterAutomations(automations, query, filter);
  const filtering = query.trim().length > 0 || filter !== "all";
  const unread = unreadAutomations(automations).length;

  return (
    <section className="flex min-h-0 w-full shrink-0 flex-col border-r border-(--ui-border) bg-(--ui-bg)">
      <header className="flex min-h-14 shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-3">
        <div className="min-w-0">
          <h1 className="truncate text-[length:var(--fs-lg)] font-medium text-(--ui-fg)">
            Scheduled tasks
          </h1>
          <p className="mt-0.5 text-[length:var(--fs-xs)] leading-4 text-(--ui-muted)">
            Ask Local Studio to run work on a schedule or monitor for updates
          </p>
        </div>
        <Button size="sm" onClick={onCreate} icon={<Plus className="h-3.5 w-3.5" />}>
          New
        </Button>
      </header>

      <div className="shrink-0 space-y-2 border-b border-(--ui-separator) px-3 pb-3">
        <SearchInput value={query} onChange={onQueryChange} placeholder="Search scheduled tasks" />
        <div className="flex items-center justify-between gap-2">
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
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMarkAllRead}
              icon={<Check className="h-3.5 w-3.5" />}
            >
              Mark all as read
            </Button>
          ) : null}
        </div>
        {error && automations.length > 0 ? (
          <Alert variant="error">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 flex-1">{error}</span>
              <Button variant="ghost" size="sm" onClick={onRetry}>
                Try again
              </Button>
            </div>
          </Alert>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {loading ? (
          <ListMessage>
            <Spinner size="sm" />
            <span>Loading scheduled tasks…</span>
          </ListMessage>
        ) : error && automations.length === 0 ? (
          <div className="flex min-h-48 items-center justify-center px-6 text-center">
            <div className="max-w-xs">
              <AlertCircle className="mx-auto h-5 w-5 text-(--ui-danger)" />
              <p className="mt-3 text-[length:var(--fs-sm)] leading-5 text-(--ui-fg)">
                Failed to load scheduled tasks
              </p>
              <p className="mt-1 text-[length:var(--fs-xs)] leading-4 text-(--ui-muted)">{error}</p>
              <Button variant="secondary" size="sm" onClick={onRetry} className="mt-4">
                Try again
              </Button>
            </div>
          </div>
        ) : visible.length > 0 ? (
          <div role="list" className="flex flex-col gap-0.5">
            {visible.map((automation) => (
              <AutomationRow
                key={automation.id}
                automation={automation}
                selected={automation.id === selectedId}
                running={automation.id === runningId}
                pending={automation.id === pendingId}
                onSelect={() => onSelect(automation)}
                onRun={() => onRun(automation)}
                onToggleStatus={() => onToggleStatus(automation)}
                onDelete={() => onDelete(automation)}
              />
            ))}
          </div>
        ) : filtering ? (
          <ListMessage>No scheduled tasks found</ListMessage>
        ) : (
          <SuggestionGroup onUseSuggestion={onUseSuggestion} />
        )}
      </div>
    </section>
  );
}

function AutomationRow({
  automation,
  selected,
  running,
  pending,
  onSelect,
  onRun,
  onToggleStatus,
  onDelete,
}: {
  automation: Automation;
  selected: boolean;
  running: boolean;
  pending: boolean;
  onSelect: () => void;
  onRun: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, menuOpen, () => setMenuOpen(false));
  const paused = automation.status === "paused";
  const failed = automation.lastRun?.outcome === "error";
  const toggleLabel = paused ? "Resume scheduled task" : "Pause scheduled task";

  return (
    <div
      role="listitem"
      className={`group relative rounded-[var(--ui-radius)] transition-opacity ${
        paused && !selected ? "opacity-60 focus-within:opacity-100 hover:opacity-100" : ""
      } ${menuOpen ? "z-[60]" : ""}`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        className={`flex w-full items-center gap-2 rounded-[var(--ui-radius)] py-2 pl-8 pr-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)/35 ${
          selected ? "bg-(--ui-active) text-(--ui-fg)" : "text-(--ui-fg) hover:bg-(--ui-hover)/60"
        }`}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[length:var(--fs-base)] leading-5">
            {automation.name || "Untitled scheduled task"}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[length:var(--fs-xs)] leading-4 text-(--ui-muted)">
            <span className="min-w-0 truncate">{scheduleLabel(automation.schedule)}</span>
            <RowDot />
            <span className="shrink-0">{running ? "In progress" : nextRunLabel(automation)}</span>
            <RowDot />
            <span className="min-w-0 truncate">{sourceLabel(automation)}</span>
          </span>
        </span>
        <span className="flex w-12 shrink-0 items-center justify-end">
          {automation.unread ? (
            <span
              className="h-1.5 w-1.5 rounded-full bg-(--ui-accent) group-focus-within:opacity-0 group-hover:opacity-0"
              aria-label="Unread run"
            />
          ) : null}
        </span>
      </button>

      <span
        aria-hidden
        className="pointer-events-none absolute left-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-(--ui-muted) group-focus-within:opacity-0 group-hover:opacity-0"
      >
        {running ? (
          <Spinner size="xs" />
        ) : failed ? (
          <AlertCircle className="h-3.5 w-3.5 text-(--ui-danger)" />
        ) : paused ? (
          <Pause className="h-3.5 w-3.5" />
        ) : (
          <Clock className="h-3.5 w-3.5" />
        )}
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={onToggleStatus}
        aria-label={toggleLabel}
        title={toggleLabel}
        className="absolute left-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[var(--rad-xs)] text-(--ui-muted) opacity-0 transition-opacity hover:text-(--ui-fg) focus-visible:opacity-100 disabled:opacity-40 group-focus-within:opacity-100 group-hover:opacity-100"
      >
        {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
      </button>

      <div
        ref={menuRef}
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 transition-opacity ${
          menuOpen
            ? "opacity-100"
            : "opacity-0 focus-within:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
        }`}
      >
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Scheduled task actions"
          aria-expanded={menuOpen}
          className="flex h-6 w-6 items-center justify-center rounded-[var(--rad-xs)] text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg)"
        >
          <MoreIcon className="h-3.5 w-3.5" />
        </button>
        {menuOpen ? (
          <div className={ROW_MENU_CLASS} role="menu">
            <MenuItem
              Icon={Play}
              disabled={pending || running}
              onClick={() => {
                setMenuOpen(false);
                onRun();
              }}
            >
              Run now
            </MenuItem>
            <MenuItem
              Icon={paused ? Play : Pause}
              disabled={pending}
              onClick={() => {
                setMenuOpen(false);
                onToggleStatus();
              }}
            >
              {paused ? "Resume" : "Pause"}
            </MenuItem>
            <MenuItem
              Icon={Trash2}
              danger
              disabled={pending}
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              Delete
            </MenuItem>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RowDot() {
  return (
    <span aria-hidden className="shrink-0 text-(--ui-muted)/60">
      ·
    </span>
  );
}

function SuggestionGroup({
  onUseSuggestion,
}: {
  onUseSuggestion: (suggestion: AutomationSuggestion) => void;
}) {
  return (
    <div className="px-1 pt-2">
      <div className="px-1.5 pb-1 text-[length:var(--fs-xs)] font-medium uppercase tracking-[0.12em] text-(--ui-muted)">
        Suggestions
      </div>
      <div role="list" className="flex flex-col gap-0.5">
        {AUTOMATION_SUGGESTIONS.map((suggestion) => (
          <div key={suggestion.id} role="listitem">
            <button
              type="button"
              onClick={() => onUseSuggestion(suggestion)}
              className="group flex w-full items-center gap-2 rounded-[var(--ui-radius)] px-2 py-2 text-left text-(--ui-fg) transition-colors hover:bg-(--ui-hover)/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ui-accent)/35"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-(--ui-muted)">
                <Clock className="h-3.5 w-3.5 group-hover:hidden" />
                <Plus className="hidden h-3.5 w-3.5 group-hover:block" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[length:var(--fs-base)] leading-5">
                  {suggestion.name}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[length:var(--fs-xs)] leading-4 text-(--ui-muted)">
                  <span className="min-w-0 truncate">{suggestion.description}</span>
                  <RowDot />
                  <span className="shrink-0">{scheduleLabel(suggestion.schedule)}</span>
                </span>
              </span>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ListMessage({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex min-h-48 items-center justify-center gap-2 px-8 text-center text-[length:var(--fs-sm)] leading-5 text-(--ui-muted)"
    >
      {children}
    </div>
  );
}
