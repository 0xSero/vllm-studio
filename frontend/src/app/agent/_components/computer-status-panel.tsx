"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Code2, Loader2 } from "lucide-react";
import { formatTokenCount } from "@/lib/agent/session";
import { useTools } from "@/lib/agent/tools/context";
import type { Project } from "@/lib/agent/projects/types";
import type { Session } from "@/lib/agent/sessions/types";
import type { AgentModel } from "@/lib/agent/workspace/types";

type GitSummary = {
  isRepo: boolean;
  branch?: string | null;
  additions: number;
  deletions: number;
  statusCount: number;
} | null;

export function ComputerStatusPanel({
  activeProject,
  activeModel,
  focusedSession,
  sessions,
  gitSummary,
  onCompactSession,
}: {
  activeProject: Project | null;
  activeModel: AgentModel | null;
  focusedSession: Session | null;
  sessions: Session[];
  gitSummary?: GitSummary;
  onCompactSession?: () => Promise<void>;
}) {
  const tools = useTools();
  const [compacting, setCompacting] = useState(false);
  const totals = useMemo(
    () =>
      sessions.reduce(
        (acc, session) => ({
          read: acc.read + (session.tokenStats?.read ?? 0),
          write: acc.write + (session.tokenStats?.write ?? 0),
          current: acc.current + (session.tokenStats?.current ?? 0),
          messages: acc.messages + session.messages.length,
          queued: acc.queued + (session.queue?.length ?? 0),
          running:
            acc.running + (session.status === "running" || session.status === "starting" ? 1 : 0),
        }),
        { read: 0, write: 0, current: 0, messages: 0, queued: 0, running: 0 },
      ),
    [sessions],
  );
  const contextWindow = activeModel?.contextWindow ?? 0;
  const sessionTokens = focusedSession?.tokenStats?.current ?? 0;
  const sessionRunning =
    focusedSession?.status === "running" || focusedSession?.status === "starting";
  const compactDisabled =
    compacting ||
    sessionRunning ||
    !focusedSession?.piSessionId ||
    !activeModel ||
    !onCompactSession;
  const shouldCompact = Boolean(focusedSession?.contextUsage?.shouldCompact);
  const compactFocusedSession = async () => {
    if (compactDisabled) return;
    setCompacting(true);
    try {
      await onCompactSession?.();
    } finally {
      setCompacting(false);
    }
  };
  return (
    <section className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs text-(--dim)">
      <SessionSummary
        title={focusedSession?.title ?? "New session"}
        sessionTokens={sessionTokens}
        allTokens={totals.current}
        messageCount={totals.messages}
      />

      <StatusSection title="Session">
        <StatusRow label="State" value={focusedSession?.status ?? "idle"} />
        <StatusRow
          label="Model"
          value={activeModel?.name ?? focusedSession?.modelId ?? "No model"}
        />
        <StatusRow
          label="Context"
          value={`${formatTokenCount(sessionTokens)} / ${formatTokenCount(contextWindow)}`}
        />
        <StatusActionRow label="Compact">
          <button
            type="button"
            onClick={() => void compactFocusedSession()}
            disabled={compactDisabled}
            className={`inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] ${
              shouldCompact
                ? "text-(--accent) ring-1 ring-(--accent)/40"
                : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
            } disabled:pointer-events-none disabled:opacity-30`}
            title={
              shouldCompact
                ? "Context near limit - compact this session"
                : "Compact this session context"
            }
          >
            {compacting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {compacting ? "Compacting" : "Compact"}
          </button>
        </StatusActionRow>
        <StatusRow
          label="Read / write"
          value={`${formatTokenCount(totals.read)} / ${formatTokenCount(totals.write)}`}
        />
        <StatusRow label="Queue" value={`${totals.queued} queued · ${totals.running} running`} />
      </StatusSection>

      <StatusSection title="Workspace">
        <StatusRow label="Project" value={activeProject?.name ?? "No project"} />
        <StatusRow
          label="Directory"
          value={activeProject?.path ?? focusedSession?.cwd ?? "No directory"}
        />
        <StatusRow label="Git" value={formatGitSummary(gitSummary ?? null)} />
        <StatusRow label="Browser" value={tools.browser.enabled ? tools.browser.url : "Tool off"} />
      </StatusSection>

      <CanvasPeek />
    </section>
  );
}

function formatGitSummary(gitSummary: GitSummary): string {
  if (!gitSummary?.isRepo) return "Not a repo";
  return `${gitSummary.branch ?? "detached"} · +${gitSummary.additions} -${gitSummary.deletions} · ${gitSummary.statusCount} files`;
}

function SessionSummary({
  title,
  sessionTokens,
  allTokens,
  messageCount,
}: {
  title: string;
  sessionTokens: number;
  allTokens: number;
  messageCount: number;
}) {
  return (
    <div className="border-b border-(--border) pb-3">
      <div className="truncate text-sm font-medium text-(--fg)">{title}</div>
      <div className="mt-2 grid grid-cols-3 gap-3 font-mono">
        <MiniStat label="session" value={formatTokenCount(sessionTokens)} />
        <MiniStat label="all" value={formatTokenCount(allTokens)} />
        <MiniStat label="msgs" value={String(messageCount)} />
      </div>
    </div>
  );
}

function CanvasPeek() {
  const tools = useTools();
  return (
    <div className="mt-4 border-t border-(--border) pt-3">
      <div className="flex h-8 items-center gap-2">
        <Code2 className="h-3.5 w-3.5 text-(--accent)" />
        <span className="font-medium text-(--fg)">Canvas</span>
        <button
          type="button"
          onClick={() => tools.setComputerTab("canvas")}
          className="ml-auto h-6 rounded px-2 text-[11px] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
        >
          Open
        </button>
        <button
          type="button"
          onClick={tools.toggleCanvas}
          className={`h-6 rounded px-2 text-[11px] ${
            tools.computer.canvasEnabled
              ? "bg-(--accent)/15 text-(--accent)"
              : "bg-(--bg) text-(--dim) hover:text-(--fg)"
          }`}
        >
          {tools.computer.canvasEnabled ? "On" : "Off"}
        </button>
      </div>
      <div className="mt-2 max-h-28 overflow-hidden rounded-md bg-(--surface)/50 p-2 font-mono text-[11px] leading-5 text-(--dim)">
        {tools.computer.canvasText.trim() || "No canvas notes yet."}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[9px] uppercase tracking-wide text-(--dim)">{label}</div>
      <div className="mt-1 truncate text-[13px] text-(--fg)">{value}</div>
    </div>
  );
}

function StatusSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 border-t border-(--border) pt-3">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-(--dim)">{title}</div>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] gap-3 py-0.5">
      <span className="text-[10px] text-(--dim)">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-[11px] text-(--fg)" title={value}>
        {value}
      </span>
    </div>
  );
}

function StatusActionRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-center gap-3 py-0.5">
      <span className="text-[10px] text-(--dim)">{label}</span>
      <span className="flex min-w-0 justify-end">{children}</span>
    </div>
  );
}
