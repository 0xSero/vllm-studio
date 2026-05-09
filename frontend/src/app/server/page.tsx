"use client";

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useLogs } from "@/app/logs/hooks/use-logs";
import { useSidebarStatus } from "@/hooks/use-sidebar-status";
import { getStoredBackendUrl } from "@/lib/backend-url";

type Tab = "logs" | "docs";

export default function ServerPage() {
  const status = useSidebarStatus();
  const {
    filteredSessions,
    selectedSession,
    loadingContent,
    autoScroll,
    logRef,
    setAutoScroll,
    loadLogContent,
    renderLogs,
    handleSelectSession,
    hasLogContent,
  } = useLogs();
  const [tab, setTab] = useState<Tab>("logs");
  const backendUrl = useMemo(() => getStoredBackendUrl() || "http://127.0.0.1:8080", []).replace(
    /\/+$/,
    "",
  );
  const docsUrl = `${backendUrl}/api/docs`;

  return (
    <main className="flex h-full min-h-0 flex-col bg-(--bg) text-(--fg)">
      <header className="border-b border-(--border) px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-(--dim)">Server</div>
            <h1 className="mt-1 text-[20px] font-semibold tracking-[-0.015em]">Controller</h1>
            <p className="mt-1 text-xs text-(--dim)">{backendUrl}</p>
          </div>
          <div className="flex items-center gap-2">
            <HealthPill label="controller" ok={status.online} />
            <HealthPill label="inference" ok={status.inferenceOnline} />
            <button
              type="button"
              onClick={() => (selectedSession ? loadLogContent(selectedSession) : undefined)}
              className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingContent ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <section className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="min-h-0 border-b border-(--border) p-3 lg:border-b-0 lg:border-r">
          <div className="mb-3 text-[10px] uppercase tracking-[0.16em] text-(--dim)">
            Server Health
          </div>
          <dl className="space-y-2 text-xs">
            <InfoRow label="Controller" value={status.online ? "online" : "offline"} />
            <InfoRow label="Inference" value={status.activityLine} />
            <InfoRow label="Model" value={status.model ?? "none"} />
          </dl>
          <div className="mt-5 flex gap-1">
            <TabButton active={tab === "logs"} onClick={() => setTab("logs")}>
              Server Logs
            </TabButton>
            <TabButton active={tab === "docs"} onClick={() => setTab("docs")}>
              API Docs
            </TabButton>
          </div>
          <div className="mt-3 max-h-[42vh] overflow-y-auto">
            {filteredSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => {
                  setTab("logs");
                  handleSelectSession(session.id);
                }}
                className={`mb-1 block w-full truncate rounded px-2 py-1.5 text-left text-[11px] ${
                  selectedSession === session.id
                    ? "bg-(--active) text-(--fg)"
                    : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
                }`}
                title={session.id}
              >
                {session.recipe_name || session.model || session.id}
              </button>
            ))}
          </div>
        </aside>

        <div className="min-h-0 p-4">
          {tab === "logs" ? (
            <section className="flex h-full min-h-[32rem] flex-col overflow-hidden border border-(--border) bg-(--surface)">
              <div className="flex min-h-10 items-center justify-between border-b border-(--border) px-3">
                <div className="truncate font-mono text-xs text-(--dim)">
                  {selectedSession ?? "select a log stream"}
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-(--dim)">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(event) => setAutoScroll(event.target.checked)}
                  />
                  auto-scroll
                </label>
              </div>
              <div
                ref={logRef}
                className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5 text-(--fg)"
              >
                {loadingContent ? (
                  <div className="text-(--dim)">Loading logs…</div>
                ) : hasLogContent ? (
                  renderLogs()
                ) : (
                  <div className="text-(--dim)">No log content selected.</div>
                )}
              </div>
            </section>
          ) : (
            <section className="flex h-full min-h-[32rem] flex-col overflow-hidden border border-(--border) bg-(--surface)">
              <div className="flex min-h-10 items-center justify-between border-b border-(--border) px-3 text-xs">
                <span>OpenAPI reference</span>
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-(--dim) hover:text-(--fg)"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <iframe
                src={docsUrl}
                title="Controller API docs"
                className="min-h-0 flex-1 bg-white"
              />
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

function HealthPill({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[10px] ${
        ok
          ? "border-(--hl2)/35 bg-(--hl2)/10 text-(--hl2)"
          : "border-(--err)/35 bg-(--err)/10 text-(--err)"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-(--hl2)" : "bg-(--err)"}`} />
      {label}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-(--dim)">{label}</dt>
      <dd className="min-w-0 truncate text-right font-mono">{value}</dd>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded-md px-2 text-[11px] ${
        active ? "bg-(--active) text-(--fg)" : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
      }`}
    >
      {children}
    </button>
  );
}
