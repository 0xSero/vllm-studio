"use client";

import { ChevronRight, Download, Menu } from "@/ui/icon-registry";
import { Button, Checkbox, SearchInput, Spinner } from "@/ui";
import type { LogSession } from "@/lib/types";
import { LogsSessionsSidebar } from "./logs-sessions-sidebar";

interface LogsViewProps {
  embedded?: boolean;
  sessions: LogSession[];
  filteredSessions: LogSession[];
  selectedSession: string | null;
  hasLogContent: boolean;
  filter: string;
  contentFilter: string;
  loading: boolean;
  loadingContent: boolean;
  autoScroll: boolean;
  autoRefresh: boolean;
  sidebarOpen: boolean;
  logRef: React.RefObject<HTMLDivElement | null>;
  onFilterChange: (value: string) => void;
  onContentFilterChange: (value: string) => void;
  onAutoScrollChange: (value: boolean) => void;
  onAutoRefreshChange: (value: boolean) => void;
  onSidebarToggle: (value: boolean) => void;
  onLoadLogContent: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onDownloadLog: () => void;
  onRenderLogs: () => React.ReactNode;
  onSelectSession: (sessionId: string) => void;
  formatDateTime: (dateValue: string) => string;
}

export function LogsView({
  embedded = false,
  sessions,
  filteredSessions,
  selectedSession,
  hasLogContent,
  filter,
  contentFilter,
  loading,
  loadingContent,
  autoScroll,
  autoRefresh,
  sidebarOpen,
  logRef,
  onFilterChange,
  onContentFilterChange,
  onAutoScrollChange,
  onAutoRefreshChange,
  onSidebarToggle,
  onLoadLogContent,
  onDeleteSession,
  onDownloadLog,
  onRenderLogs,
  onSelectSession,
  formatDateTime,
}: LogsViewProps) {
  if (loading)
    return (
      <div className="flex items-center justify-center h-full bg-(--surface)">
        <div className="flex items-center gap-2 text-(--dim)">
          <Spinner variant="refresh" />
          <span className="text-sm">Loading logs...</span>
        </div>
      </div>
    );

  return (
    <div
      className={`relative flex min-h-0 bg-(--surface) text-(--fg) ${
        embedded
          ? "h-[min(72vh,48rem)] min-h-[24rem] flex-col rounded-md border border-(--border) sm:min-h-[32rem]"
          : "h-full"
      }`}
    >
      <LogsSessionsSidebar
        embedded={embedded}
        sessions={sessions}
        filteredSessions={filteredSessions}
        selectedSession={selectedSession}
        filter={filter}
        sidebarOpen={sidebarOpen}
        onFilterChange={onFilterChange}
        onSidebarToggle={onSidebarToggle}
        onSelectSession={onSelectSession}
        onDeleteSession={onDeleteSession}
        formatDateTime={formatDateTime}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedSession ? (
          <>
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--border) px-2.5 py-2 sm:px-3">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[length:var(--fs-sm)]">
                <Button
                  variant="icon"
                  size="sm"
                  onClick={() => onSidebarToggle(true)}
                  className="shrink-0 md:hidden"
                >
                  <Menu className="h-4 w-4 text-(--dim)" />
                </Button>
                <ChevronRight className="h-3.5 w-3.5 text-(--dim) hidden sm:block flex-shrink-0" />
                <span className="truncate font-mono text-[length:var(--fs-xs)] text-(--fg)">
                  {selectedSession}
                </span>
              </div>
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
                <Checkbox
                  checked={autoRefresh}
                  onChange={onAutoRefreshChange}
                  label="Auto-refresh"
                  className="hidden items-center sm:flex"
                  labelClassName="text-[length:var(--fs-xs)] font-normal"
                />
                <Checkbox
                  checked={autoScroll}
                  onChange={onAutoScrollChange}
                  label="Auto-scroll"
                  className="hidden items-center sm:flex"
                  labelClassName="text-[length:var(--fs-xs)] font-normal"
                />
                <div className="w-px h-4 bg-(--border) hidden sm:block" />
                <SearchInput
                  value={contentFilter}
                  onChange={onContentFilterChange}
                  placeholder="Filter..."
                  className="w-24 sm:w-36 [&_input]:h-7 [&_input]:py-1 [&_input]:text-[length:var(--fs-xs)]"
                />
                <Button variant="icon" size="sm" onClick={onDownloadLog} title="Download">
                  <Download className="h-3.5 w-3.5 text-(--dim)" />
                </Button>
              </div>
            </div>

            {/* Log Content */}
            <div
              ref={logRef}
              className="flex-1 overflow-auto bg-(--surface) p-2 font-mono text-[length:var(--fs-xs)] leading-relaxed sm:p-3"
            >
              {loadingContent ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-2 text-(--dim)">
                    <Spinner variant="refresh" />
                    <span>Loading...</span>
                  </div>
                </div>
              ) : hasLogContent ? (
                onRenderLogs()
              ) : (
                <div className="text-center text-(--dim)">No log content</div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <Button variant="secondary" onClick={() => onSidebarToggle(true)} className="md:hidden">
              <Menu className="h-4 w-4" />
              View Sessions
            </Button>
            <div className="text-center text-(--dim)">
              <p className="text-[length:var(--fs-sm)]">Select a log session to view</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
