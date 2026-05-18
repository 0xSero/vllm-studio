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
      style={{ width: `${tools.computer.width}px`, minWidth: "max(280px, 25%)", maxWidth: "65%" }}
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
        openTabs={tools.computer.tabs}
        onSelectTab={tools.setComputerTab}
        onCloseTab={tools.closeComputerTab}
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
      ) : tools.computer.tab === "canvas" ? (
        <CanvasPanel />
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
  canvas: "Canvas",
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
    tab: "canvas",
    label: "Canvas",
    description: "Shared scratchboard for human and model",
    icon: Code2,
  },
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
  openTabs,
  onSelectTab,
  onCloseTab,
}: {
  tab: ComputerTab;
  openTabs: ComputerTab[];
  onSelectTab: (tab: ComputerTab) => void;
  onCloseTab: (tab: ComputerTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const tabMeta = (candidate: ComputerTab) =>
    candidate === "status"
      ? { label: "Status", icon: PanelRight }
      : {
          label: TAB_LABELS[candidate],
          icon: TAB_OPTIONS.find((item) => item.tab === candidate)?.icon ?? PanelRight,
        };
  const menuOptions = [
    {
      tab: "status" as const,
      label: "Status",
      description: "Session and workspace summary",
      icon: PanelRight,
    },
    ...TAB_OPTIONS,
  ].filter((item) => !openTabs.includes(item.tab));
  return (
    <div className="relative flex h-10 shrink-0 items-center gap-1 border-b border-(--border) px-2 pr-12 text-xs">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {openTabs.map((openTab) => {
          const meta = tabMeta(openTab);
          const Icon = meta.icon;
          return (
            <div
              key={openTab}
              className={`group inline-flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 ${
                tab === openTab ? "bg-(--surface) text-(--fg)" : "text-(--dim) hover:text-(--fg)"
              }`}
              title={meta.label}
            >
              <button
                type="button"
                onClick={() => onSelectTab(openTab)}
                className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[9rem] truncate">{meta.label}</span>
              </button>
              {openTab !== "status" ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(openTab);
                  }}
                  className="ml-0.5 hidden h-4 w-4 items-center justify-center rounded text-(--dim) hover:bg-(--hover) hover:text-(--fg) group-hover:inline-flex"
                  aria-label={`Close ${meta.label}`}
                  title={`Close ${meta.label}`}
                >
                  <CloseIcon className="h-2.5 w-2.5" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <span className="min-w-0 flex-1" />
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
          {menuOptions.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-(--dim)">All computer tabs are open.</div>
          ) : null}
          {menuOptions.map((item) => {
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
    </section>
  );
}

function CanvasPanel() {
  const tools = useTools();
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-(--border) px-3 text-xs">
        <Code2 className="h-3.5 w-3.5 text-(--accent)" />
        <span className="font-medium text-(--fg)">Canvas</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-(--dim)">
          Shared scratchboard for the human and model
        </span>
        <button
          type="button"
          onClick={tools.toggleCanvas}
          className={`h-6 rounded px-2 text-[11px] ${
            tools.computer.canvasEnabled
              ? "bg-(--accent)/15 text-(--accent)"
              : "bg-(--surface) text-(--dim) hover:text-(--fg)"
          }`}
        >
          {tools.computer.canvasEnabled ? "On" : "Off"}
        </button>
      </div>
      <textarea
        value={tools.computer.canvasText}
        onChange={(event) => tools.setCanvasText(event.target.value)}
        placeholder="Scratch notes, live plan, links, state, or anything the model should keep in view..."
        className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12px] leading-6 text-(--fg) outline-none placeholder:text-(--dim)"
        spellCheck={false}
      />
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
