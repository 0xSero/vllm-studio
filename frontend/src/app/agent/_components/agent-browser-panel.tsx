"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity,
  Code2,
  FolderTree,
  GitBranch,
  Globe2,
  PanelRight,
  Plus,
  TerminalSquare,
} from "lucide-react";
import { CloseIcon } from "@/components/icons";
import { normalizeBrowserInput } from "@/lib/agent/tools/browser-url";
import { useTools } from "@/lib/agent/tools/context";
import type { ComputerTab } from "@/lib/agent/tools/types";
import type { Project } from "@/lib/agent/projects/types";
import type { Session } from "@/lib/agent/sessions/types";
import type { AgentModel } from "@/lib/agent/workspace/types";
import { formatTokenCount } from "@/lib/agent/session";
import { AgentBrowser, type AgentBrowserHandle } from "./agent-browser";
import { FilesystemPanel } from "./filesystem-panel";
import { GitDiffPanel } from "./git-diff-panel";
import { TerminalPanel } from "./terminal-panel";
import type { WorkspaceHandles } from "./use-workspace";

type AgentBrowserPanelHandles = Pick<
  WorkspaceHandles,
  "registerComputerAside" | "startComputerResize" | "registerBrowserHandle" | "runBrowserCommand"
>;

type AgentBrowserPanelProps = {
  handles: AgentBrowserPanelHandles;
  activeProject: Project | null;
  focusedTitle: string;
  focusedSession: Session | null;
  sessions: Session[];
  activeModel: AgentModel | null;
  gitSummary?: {
    isRepo: boolean;
    branch?: string | null;
    additions: number;
    deletions: number;
    statusCount: number;
  } | null;
};

export function AgentBrowserPanel({
  handles,
  activeProject,
  focusedTitle,
  focusedSession,
  sessions,
  activeModel,
  gitSummary,
}: AgentBrowserPanelProps) {
  const tools = useTools();
  if (!tools.computer.open) return null;

  const { registerComputerAside, startComputerResize, registerBrowserHandle, runBrowserCommand } =
    handles;
  const isElectron = typeof navigator !== "undefined" && /electron/i.test(navigator.userAgent);
  const submitBrowserUrl = (event: FormEvent) => {
    event.preventDefault();
    const next = normalizeBrowserInput(tools.browser.input, activeProject?.path ?? "");
    if (!next) return;
    tools.setBrowserUrl(next, next);
    void runBrowserCommand("navigate", { url: next });
  };

  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-(--border) bg-(--bg)"
      ref={registerComputerAside}
      style={{ width: `min(${tools.computer.width}px, 48vw)` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        title="Resize computer"
        onMouseDown={startComputerResize}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-(--accent)/20"
      />
      <ComputerHeader
        tab={tools.computer.tab}
        focusedTitle={focusedTitle}
        onSelectTab={tools.setComputerTab}
      />
      <div className="absolute right-2 top-1.5 z-20 flex items-center gap-1">
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => tools.setComputerOpen(false)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-(--dim) hover:bg-(--surface) hover:text-(--fg)"
          title="Close"
          aria-label="Close computer"
        >
          <CloseIcon className="h-3.5 w-3.5 pointer-events-none" />
        </button>
      </div>

      {tools.computer.tab === "status" ? (
        <ComputerStatusPanel
          activeProject={activeProject}
          activeModel={activeModel}
          focusedSession={focusedSession}
          sessions={sessions}
          gitSummary={gitSummary}
        />
      ) : tools.computer.tab === "browser" ? (
        <AgentBrowser
          ref={registerBrowserHandle}
          url={tools.browser.url}
          inputValue={tools.browser.input}
          onInputChange={tools.setBrowserInput}
          onSubmit={submitBrowserUrl}
          onClose={() => tools.setComputerOpen(false)}
          isElectron={isElectron}
        />
      ) : tools.computer.tab === "files" ? (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <FilesystemPanel cwd={activeProject?.path ?? null} />
          </div>
        </section>
      ) : tools.computer.tab === "diff" ? (
        <GitDiffPanel cwd={activeProject?.path ?? null} />
      ) : (
        <TerminalPanel cwd={activeProject?.path ?? null} />
      )}
    </aside>
  );
}

const TAB_LABELS: Record<ComputerTab, string> = {
  status: "Status",
  browser: "Browser",
  files: "Filesystem",
  diff: "Git",
  terminal: "Terminal",
};

const TAB_OPTIONS: Array<{
  tab: ComputerTab;
  label: string;
  description: string;
  icon: typeof Activity;
}> = [
  {
    tab: "browser",
    label: "Browser",
    description: "Web, localhost, and file previews",
    icon: Globe2,
  },
  { tab: "diff", label: "Git", description: "Diffs, branch, commit, and push", icon: GitBranch },
  {
    tab: "files",
    label: "Filesystem",
    description: "Project files and rendered previews",
    icon: FolderTree,
  },
  { tab: "terminal", label: "Terminal", description: "Project shell", icon: TerminalSquare },
];

function ComputerHeader({
  tab,
  focusedTitle,
  onSelectTab,
}: {
  tab: ComputerTab;
  focusedTitle: string;
  onSelectTab: (tab: ComputerTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeIcon =
    tab === "status"
      ? PanelRight
      : (TAB_OPTIONS.find((item) => item.tab === tab)?.icon ?? PanelRight);
  const ActiveIcon = activeIcon;
  return (
    <div className="relative flex h-10 shrink-0 items-center gap-2 border-b border-(--border) px-3 pr-12 text-xs">
      <button
        type="button"
        onClick={() => onSelectTab("status")}
        className={`inline-flex h-7 min-w-0 max-w-[52%] items-center gap-2 rounded-md px-2 ${
          tab === "status" ? "bg-(--surface) text-(--fg)" : "text-(--dim) hover:text-(--fg)"
        }`}
        title={`Computer follows focused session: ${focusedTitle}`}
      >
        <ActiveIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{TAB_LABELS[tab]}</span>
      </button>
      <span className="min-w-0 flex-1 truncate text-[10px] uppercase tracking-wide text-(--dim)">
        {focusedTitle}
      </span>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-(--surface) text-(--fg) hover:bg-(--hover)"
        title="Open computer tab"
        aria-label="Open computer tab"
        aria-expanded={open}
      >
        <Plus className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-10 top-9 z-40 w-64 rounded-md border border-(--border) bg-[#151515] p-1 shadow-[0_12px_36px_rgba(0,0,0,0.65)]">
          <button
            type="button"
            onClick={() => {
              onSelectTab("status");
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs text-(--fg) hover:bg-(--hover)"
          >
            <PanelRight className="h-3.5 w-3.5 text-(--accent)" />
            <span className="min-w-0 flex-1">Status</span>
          </button>
          <div className="my-1 border-t border-(--border)" />
          {TAB_OPTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.tab}
                onClick={() => {
                  onSelectTab(item.tab);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2 rounded px-2 py-2 text-left hover:bg-(--hover)"
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--accent)" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs text-(--fg)">{item.label}</span>
                  <span className="block text-[10px] leading-4 text-(--dim)">
                    {item.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function ComputerStatusPanel({
  activeProject,
  activeModel,
  focusedSession,
  sessions,
  gitSummary,
}: {
  activeProject: Project | null;
  activeModel: AgentModel | null;
  focusedSession: Session | null;
  sessions: Session[];
  gitSummary?: {
    isRepo: boolean;
    branch?: string | null;
    additions: number;
    deletions: number;
    statusCount: number;
  } | null;
}) {
  const tools = useTools();
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
  return (
    <section className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs text-(--dim)">
      <div className="border-b border-(--border) pb-3">
        <div className="truncate text-sm font-medium text-(--fg)">
          {focusedSession?.title ?? "New session"}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-3 font-mono">
          <MiniStat label="session" value={formatTokenCount(sessionTokens)} />
          <MiniStat label="all" value={formatTokenCount(totals.current)} />
          <MiniStat label="msgs" value={String(totals.messages)} />
        </div>
      </div>

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
        <StatusRow
          label="Git"
          value={
            gitSummary?.isRepo
              ? `${gitSummary.branch ?? "detached"} · +${gitSummary.additions} -${gitSummary.deletions} · ${gitSummary.statusCount} files`
              : "Not a repo"
          }
        />
        <StatusRow label="Browser" value={tools.browser.enabled ? tools.browser.url : "Tool off"} />
      </StatusSection>

      <div className="mt-4 border-t border-(--border) pt-3">
        <div className="flex h-8 items-center gap-2">
          <Code2 className="h-3.5 w-3.5 text-(--accent)" />
          <span className="font-medium text-(--fg)">Canvas</span>
          <button
            type="button"
            onClick={() => tools.toggleCanvas()}
            className={`ml-auto h-6 rounded px-2 text-[11px] ${
              tools.computer.canvasEnabled
                ? "bg-(--accent)/15 text-(--accent)"
                : "bg-(--bg) text-(--dim) hover:text-(--fg)"
            }`}
          >
            {tools.computer.canvasEnabled ? "On" : "Off"}
          </button>
        </div>
        {tools.computer.canvasEnabled ? (
          <textarea
            value={tools.computer.canvasText}
            onChange={(event) => tools.setCanvasText(event.target.value)}
            placeholder="Scratch notes for the human and model…"
            className="min-h-44 w-full resize-y bg-transparent p-3 font-mono text-[11px] leading-5 text-(--fg) outline-none placeholder:text-(--dim)"
            spellCheck={false}
          />
        ) : (
          <div className="py-2 text-[11px] leading-5">
            Shared scratch notes for the model and human. Toggle it here or from the composer.
          </div>
        )}
      </div>
    </section>
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
