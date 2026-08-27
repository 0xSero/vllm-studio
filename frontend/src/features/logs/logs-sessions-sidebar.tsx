"use client";

import type { ReactNode } from "react";
import { ChevronLeft, Trash2 } from "@/ui/icon-registry";
import { Button, SearchInput, StatusPill } from "@/ui";
import { Drawer, DrawerOverlay } from "@/ui/drawer";
import type { LogSession } from "@/lib/types";

export function LogsSessionsSidebar({
  embedded = false,
  sessions,
  filteredSessions,
  selectedSession,
  filter,
  sidebarOpen,
  onFilterChange,
  onSidebarToggle,
  onSelectSession,
  onDeleteSession,
  formatDateTime,
}: {
  embedded?: boolean;
  sessions: LogSession[];
  filteredSessions: LogSession[];
  selectedSession: string | null;
  filter: string;
  sidebarOpen: boolean;
  onFilterChange: (value: string) => void;
  onSidebarToggle: (value: boolean) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  formatDateTime: (dateValue: string) => string;
}) {
  const countLabel =
    filter.trim() && filteredSessions.length !== sessions.length
      ? `${filteredSessions.length} of ${sessions.length}`
      : String(sessions.length);
  const countNoun = filteredSessions.length === 1 ? "session" : "sessions";

  const renderSessionRow = (session: LogSession) => (
    <div
      key={session.id}
      role="button"
      tabIndex={0}
      aria-pressed={selectedSession === session.id}
      onClick={() => onSelectSession(session.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectSession(session.id);
        }
      }}
      className={`w-full cursor-pointer border-b border-(--separator) px-2.5 py-2 text-left transition-colors group ${
        selectedSession === session.id ? "bg-(--surface)" : "hover:bg-(--hover)"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="truncate text-[length:var(--fs-sm)] font-medium text-(--fg)">
            {session.model || session.id}
          </div>
          <div className="mt-0.5 text-[length:var(--fs-xs)] text-(--dim)">
            {formatDateTime(session.created_at)}
          </div>
          {session.backend && (
            <StatusPill tone="info" variant="badge" className="mt-1">
              {session.backend}
            </StatusPill>
          )}
        </div>
        <Button
          variant="icon"
          size="sm"
          disabled={session.id === "controller"}
          onClick={(event) => {
            event.stopPropagation();
            onDeleteSession(session.id);
          }}
          className={`p-1 text-(--dim) opacity-0 group-hover:opacity-100 transition-all ${
            session.id === "controller" ? "cursor-not-allowed opacity-20" : "hover:text-(--err)"
          }`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div className="shrink-0 border-b border-(--border) bg-(--surface)">
        <div className="flex flex-wrap items-center gap-2 px-2.5 py-2">
          <h1 className="text-[length:var(--fs-sm)] font-medium text-(--dim)">Log Sessions</h1>
          <span className="text-[length:var(--fs-xs)] text-(--dim)/70">{countLabel}</span>
          <SearchInput
            value={filter}
            onChange={onFilterChange}
            placeholder="Filter..."
            className="ml-auto w-32 [&_input]:h-7 [&_input]:text-[length:var(--fs-xs)]"
          />
        </div>
        <div className="flex min-h-8 gap-1 overflow-x-auto px-2.5 pb-2">
          {filteredSessions.length === 0 ? (
            <span className="py-1 text-[length:var(--fs-xs)] text-(--dim)">No log files found</span>
          ) : (
            filteredSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelectSession(session.id)}
                aria-pressed={selectedSession === session.id}
                className={`max-w-52 shrink-0 truncate rounded-[4px] border px-2 py-1 text-left text-[length:var(--fs-xs)] transition-colors ${
                  selectedSession === session.id
                    ? "border-(--ui-border-heavy) bg-(--ui-active) text-(--ui-fg)"
                    : "border-(--ui-separator) text-(--ui-muted) hover:bg-(--ui-hover) hover:text-(--ui-fg)"
                }`}
                title={`${session.model || session.id} · ${formatDateTime(session.created_at)}`}
              >
                {session.model || session.id}
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  /** One body, two hosts: the docked desktop column and the mobile drawer used
   * to render this markup twice, which is how the two copies drifted apart. */
  const renderPanel = (collapseAction?: ReactNode) => (
    <>
      <div className="border-b border-(--border) px-2.5 py-2">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-[length:var(--fs-sm)] font-medium text-(--dim)">Log Sessions</h1>
          {collapseAction}
        </div>
        <SearchInput value={filter} onChange={onFilterChange} placeholder="Filter..." />
      </div>
      <div className="flex-1 overflow-y-auto">
        {filteredSessions.length === 0 ? (
          <div className="p-3 text-center text-[length:var(--fs-sm)] text-(--dim)">
            No log files found
          </div>
        ) : (
          filteredSessions.map(renderSessionRow)
        )}
      </div>
      <div className="border-t border-(--border) px-2.5 py-2 text-[length:var(--fs-xs)] text-(--dim)">
        {countLabel} {countNoun}
      </div>
    </>
  );

  return (
    <>
      <div className="hidden w-56 shrink-0 flex-col border-r border-(--border) bg-(--surface) md:flex">
        {renderPanel()}
      </div>

      {sidebarOpen ? (
        <DrawerOverlay side="left" onClose={() => onSidebarToggle(false)} className="md:hidden">
          <Drawer side="left" width={256} className="h-full bg-(--surface)">
            {renderPanel(
              <Button variant="icon" size="sm" onClick={() => onSidebarToggle(false)}>
                <ChevronLeft className="h-4 w-4 text-(--dim)" />
              </Button>,
            )}
          </Drawer>
        </DrawerOverlay>
      ) : null}
    </>
  );
}
