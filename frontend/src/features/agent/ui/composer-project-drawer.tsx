"use client";

import { useCallback, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FilePenLine,
  FolderOpen,
  GitBranch,
  ListChecks,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Target,
  Trash2,
  X,
} from "@/ui/icon-registry";
import { GitBranchIcon } from "@/ui/icons";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useProjects } from "@/features/agent/projects/context";
import type { GitSummary, Project } from "@/features/agent/projects/types";
import {
  addProjectFromPath,
  addWorktree,
  createBranch,
  listBranches,
  listWorktrees,
  removeWorktree,
  switchBranch,
} from "@/features/agent/projects/api";
import type { GitBranch as GitBranchType, GitWorktree } from "@/features/agent/contracts";
import { clearSessionGoal, loadSessionGoal, updateSessionGoal } from "@/features/agent/runtime/api";
import type { GoalStatus, SessionGoal, SessionGoalPatch } from "@shared/agent/session-goal";
import { ADD_PROJECT_EVENT } from "@/lib/workspace-events";
import { cx } from "@/ui/utils";
import { QueuedMessageStack } from "@/features/agent/ui/queued-message-stack";
import type { QueuedMessage } from "@/features/agent/messages";

const STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Pursuing goal",
  paused: "Goal paused",
  blocked: "Goal blocked",
  complete: "Goal complete",
  budget_limited: "Goal out of budget",
};

function formatElapsed(sinceIso: string): string {
  const elapsedMs = Date.now() - new Date(sinceIso).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "";
  const minutes = Math.floor(elapsedMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

const iconButtonClass =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-(--fg)/42 transition-colors hover:bg-(--hover) hover:text-(--fg)/82 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--fg)/25";

const listRowClass =
  "flex h-8 w-full items-center gap-2 rounded-[10px] px-2 text-left transition-colors";

const searchInputClass =
  "h-7 w-full min-w-0 rounded-md bg-(--fg)/[0.04] px-2 text-[length:var(--fs-xs)] text-(--fg) outline-none placeholder:text-(--fg)/30 focus:bg-(--fg)/[0.06]";

export function ComposerProjectDrawer({
  piSessionId,
  revision,
  projectName,
  cwd,
  gitBranch,
  gitSummary,
  onInitGit,
  onOpenDiff,
  canPickProject,
  onProjectPicked,
  queueItems,
  running,
  onEditQueued,
  onRemoveQueued,
  onSteerQueued,
}: {
  piSessionId: string | null;
  revision: number;
  projectName: string | null;
  cwd: string;
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  onInitGit?: () => void;
  onOpenDiff: () => void;
  canPickProject: boolean;
  onProjectPicked: (project: Project) => void;
  queueItems: QueuedMessage[];
  running: boolean;
  onEditQueued: (queueId: string, text: string) => void;
  onRemoveQueued: (queueId: string) => void;
  onSteerQueued: (queueId: string) => void;
}) {
  const projects = useProjects();
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState<SessionGoal | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const isRepo = gitSummary?.isRepo === true;
  const gitEnabled = !running && isRepo;

  useMountSubscription(() => {
    if (!piSessionId) {
      setGoal(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const next = await loadSessionGoal(piSessionId);
      if (!cancelled) setGoal(next);
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [piSessionId, revision]);

  const patchGoal = useCallback(
    async (patch: SessionGoalPatch) => {
      if (!piSessionId) return;
      try {
        setGoal(await updateSessionGoal(piSessionId, patch));
      } catch {}
    },
    [piSessionId],
  );

  const removeGoal = useCallback(async () => {
    if (!piSessionId) return;
    try {
      await clearSessionGoal(piSessionId);
      setGoal(null);
      setEditing(false);
    } catch {}
  }, [piSessionId]);

  const activeProject = projects.findByPath(cwd) ?? projects.selectedProject;
  const label = projectName ?? activeProject?.name ?? "Choose project";
  const hasQueue = queueItems.length > 0;
  const paused = goal?.status === "paused";

  const startEditing = () => {
    if (!goal) return;
    setDraft(goal.objective);
    setEditing(true);
    setOpen(true);
  };

  const saveObjective = async () => {
    const objective = draft.trim();
    if (!objective) return;
    await patchGoal({ objective });
    setEditing(false);
  };

  const pickProject = (project: Project) => {
    projects.selectProject(project);
    onProjectPicked(project);
    setOpen(false);
  };

  const addProject = () => {
    setOpen(false);
    window.dispatchEvent(new Event(ADD_PROJECT_EVENT));
  };

  return (
    <section
      data-testid="composer-drawer"
      className="relative z-0 mx-auto -mb-3 w-[calc(100%_-_26px)] max-w-[calc(var(--composer-w)*0.9_-_26px)] overflow-hidden rounded-[var(--composer-radius-inner)] border border-(--border) bg-(--fg)/[0.022] pb-2 text-[length:var(--fs-xs)] shadow-[var(--composer-elevation-inner)] md:pb-3 md:text-[length:var(--fs-sm)] backdrop-blur-sm [corner-shape:superellipse(1.5)] sm:w-[calc(90%_-_26px)]"
    >
      <DrawerSummaryButton
        open={open}
        onToggle={() => setOpen((value) => !value)}
        label={label}
        queueCount={queueItems.length}
        goalObjective={goal?.objective ?? null}
      />
      {hasQueue ? (
        <div className="px-1.5 pb-0.5">
          <QueuedMessageStack
            items={queueItems}
            running={running}
            onEdit={onEditQueued}
            onRemove={onRemoveQueued}
            onSteer={onSteerQueued}
          />
        </div>
      ) : null}
      {open ? (
        <div className="flex max-h-[62vh] flex-col gap-0.5 overflow-y-auto px-1.5 pt-1">
          {goal ? (
            <GoalCard
              goal={goal}
              editing={editing}
              draft={draft}
              onDraftChange={setDraft}
              onStartEditing={startEditing}
              onCancelEditing={() => setEditing(false)}
              onSave={() => void saveObjective()}
              onTogglePause={() => void patchGoal({ status: paused ? "active" : "paused" })}
              onRemove={() => void removeGoal()}
            />
          ) : null}
          <GitRow
            gitSummary={gitSummary}
            gitBranch={gitBranch}
            onInitGit={onInitGit}
            onOpenDiff={() => {
              setOpen(false);
              onOpenDiff();
            }}
          />
          <ProjectList
            canPickProject={canPickProject}
            cwd={cwd}
            projects={projects.projects}
            activeProjectId={activeProject?.id ?? null}
            onPick={pickProject}
            onAdd={addProject}
          />
          {isRepo ? (
            <GitResourceSections
              key={cwd}
              cwd={cwd}
              enabled={gitEnabled}
              onBranchSwitched={async () => {
                await projects.loadGitSummary(cwd);
                await projects.refresh();
              }}
              onWorktreePicked={async (path: string) => {
                try {
                  const project = await addProjectFromPath(path);
                  projects.upsertProject(project);
                  pickProject(project);
                } catch {}
              }}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function GitResourceSections({
  cwd,
  enabled,
  onBranchSwitched,
  onWorktreePicked,
}: {
  cwd: string;
  enabled: boolean;
  onBranchSwitched: () => Promise<void>;
  onWorktreePicked: (path: string) => Promise<void>;
}) {
  const [branches, setBranches] = useState<GitBranchType[] | null>(null);
  const [worktrees, setWorktrees] = useState<GitWorktree[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextBranches, nextWorktrees] = await Promise.all([
        listBranches(cwd),
        listWorktrees(cwd),
      ]);
      setBranches(nextBranches);
      setWorktrees(nextWorktrees);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load git state");
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useMountSubscription(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (action: () => Promise<void>, fallback: string) => {
      if (!enabled) return;
      setBusy(true);
      setError(null);
      try {
        await action();
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : fallback);
      } finally {
        setBusy(false);
      }
    },
    [enabled, load],
  );

  if (error) {
    return (
      <div className={cx(listRowClass, "text-(--err)/80")}>
        <span className="min-w-0 flex-1 truncate">{error}</span>
        <button
          type="button"
          onClick={() => void load()}
          className={iconButtonClass}
          aria-label="Retry loading git state"
          title="Retry"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <>
      <BranchSection
        branches={branches}
        loading={loading}
        busy={busy}
        enabled={enabled}
        onSwitch={(name) =>
          void run(async () => {
            await switchBranch(cwd, name);
            await onBranchSwitched();
          }, "Failed to switch branch")
        }
        onCreate={(name) =>
          void run(async () => {
            await createBranch(cwd, name);
            await onBranchSwitched();
          }, "Failed to create branch")
        }
      />
      <WorktreeSection
        worktrees={worktrees}
        loading={loading}
        busy={busy}
        enabled={enabled}
        cwd={cwd}
        onSwitch={(path) => void run(() => onWorktreePicked(path), "Failed to open worktree")}
        onCreate={(branch, path) =>
          void run(async () => {
            await addWorktree(cwd, branch, path);
            await onWorktreePicked(path);
          }, "Failed to create worktree")
        }
        onRemove={(path) =>
          void run(async () => {
            await removeWorktree(cwd, path);
          }, "Failed to remove worktree")
        }
      />
    </>
  );
}

function useFilteredItems<T>(items: T[], nameOf: (item: T) => string, query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => nameOf(item).toLowerCase().includes(q));
}

function BranchSection({
  branches,
  loading,
  busy,
  enabled,
  onSwitch,
  onCreate,
}: {
  branches: GitBranchType[] | null;
  loading: boolean;
  busy: boolean;
  enabled: boolean;
  onSwitch: (name: string) => void;
  onCreate: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const filtered = useFilteredItems(branches ?? [], (branch) => branch.name, query);

  const submitCreate = () => {
    const name = draftName.trim();
    if (!name) return;
    onCreate(name);
    setDraftName("");
    setCreating(false);
  };

  return (
    <SectionShell
      icon={<GitBranch className="h-3.5 w-3.5 shrink-0 text-(--fg)/46" />}
      label="Branches"
      count={branches?.length ?? 0}
      addLabel="New branch"
      addDisabled={!enabled}
      onAdd={() => setCreating((value) => !value)}
      query={query}
      onQueryChange={setQuery}
      placeholder="Search branches…"
      loading={loading}
      itemsLoaded={branches !== null}
      emptyLabel="No branches"
      empty={branches !== null && filtered.length === 0}
      create={
        creating ? (
          <div className="flex items-center gap-1 px-2 pb-0.5">
            <input
              autoFocus
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitCreate();
                if (event.key === "Escape") setCreating(false);
              }}
              placeholder="Branch name"
              className={searchInputClass}
              aria-label="New branch name"
            />
            <button
              type="button"
              disabled={!draftName.trim() || busy}
              onClick={submitCreate}
              className={`${iconButtonClass} bg-(--fg)/90 text-(--bg) hover:bg-(--fg) hover:text-(--bg) disabled:opacity-35`}
              aria-label="Create branch"
              title="Create branch"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null
      }
    >
      {filtered.map((branch) => (
        <button
          key={branch.name}
          type="button"
          disabled={busy || branch.current || !enabled}
          onClick={() => onSwitch(branch.name)}
          className={cx(
            listRowClass,
            branch.current ? "bg-(--hover)/50 text-(--fg)/90" : "hover:bg-(--hover)",
            "disabled:opacity-60",
          )}
          title={branch.remote ? `Remote branch ${branch.name}` : `Switch to ${branch.name}`}
        >
          {branch.current ? (
            <Check className="h-3.5 w-3.5 shrink-0 text-(--accent)" />
          ) : (
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-(--fg)/34" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {branch.name}
            {branch.remote ? <span className="text-(--dim)"> (remote)</span> : null}
          </span>
          {!branch.current && enabled ? (
            <ChevronRight className="h-3 w-3 shrink-0 text-(--fg)/30" />
          ) : null}
        </button>
      ))}
    </SectionShell>
  );
}

function WorktreeSection({
  cwd,
  worktrees,
  loading,
  busy,
  enabled,
  onSwitch,
  onCreate,
  onRemove,
}: {
  cwd: string;
  worktrees: GitWorktree[] | null;
  loading: boolean;
  busy: boolean;
  enabled: boolean;
  onSwitch: (path: string) => void;
  onCreate: (branch: string, path: string) => void;
  onRemove: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draftBranch, setDraftBranch] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const filtered = useFilteredItems(worktrees ?? [], (worktree) => worktree.path, query);

  const startCreate = () => {
    const branch = draftBranch.trim();
    const path = draftPath.trim();
    if (!branch || !path) return;
    onCreate(branch, path);
    setDraftBranch("");
    setDraftPath("");
    setCreating(false);
  };

  return (
    <SectionShell
      icon={<GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-(--fg)/46" />}
      label="Worktrees"
      count={worktrees?.length ?? 0}
      addLabel="New worktree"
      addDisabled={!enabled}
      onAdd={() => setCreating((value) => !value)}
      query={query}
      onQueryChange={setQuery}
      placeholder="Search worktrees…"
      loading={loading}
      itemsLoaded={worktrees !== null}
      emptyLabel="No worktrees"
      empty={worktrees !== null && filtered.length === 0}
      create={
        creating ? (
          <div className="flex flex-col gap-1 px-2 pb-0.5">
            <input
              autoFocus
              value={draftBranch}
              onChange={(event) => setDraftBranch(event.target.value)}
              placeholder="Branch (e.g. feat/new-thing)"
              className={searchInputClass}
              aria-label="New worktree branch"
            />
            <input
              value={draftPath}
              onChange={(event) => setDraftPath(event.target.value)}
              placeholder={defaultWorktreePath(cwd, draftBranch)}
              className={searchInputClass}
              aria-label="New worktree path"
            />
            <div className="flex justify-end gap-1">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className={iconButtonClass}
                aria-label="Cancel creating worktree"
                title="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={!draftBranch.trim() || busy}
                onClick={startCreate}
                className={`${iconButtonClass} bg-(--fg)/90 text-(--bg) hover:bg-(--fg) hover:text-(--bg) disabled:opacity-35`}
                aria-label="Create worktree"
                title="Create worktree"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ) : null
      }
    >
      {filtered.map((worktree) => (
        <div key={worktree.path} className="group flex min-w-0 items-center">
          <button
            type="button"
            disabled={busy || worktree.current || !enabled}
            onClick={() => onSwitch(worktree.path)}
            className={cx(
              listRowClass,
              "min-w-0 flex-1",
              worktree.current ? "bg-(--hover)/50 text-(--fg)/90" : "hover:bg-(--hover)",
              "disabled:opacity-60",
            )}
            title={worktree.current ? "Current working tree" : `Open worktree at ${worktree.path}`}
          >
            {worktree.current ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-(--accent)" />
            ) : (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-(--fg)/34" strokeWidth={1.7} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[length:var(--fs-xs)]">
                {worktree.branch ?? "detached"}
              </span>
              <span className="block truncate text-[length:var(--fs-xs)] text-(--fg)/40">
                {worktree.path}
              </span>
            </span>
          </button>
          {!worktree.current && enabled ? (
            <button
              type="button"
              onClick={() => onRemove(worktree.path)}
              className="mr-1 shrink-0 rounded-md p-1 text-(--fg)/40 opacity-0 transition-opacity hover:bg-(--fg)/[0.06] hover:text-(--err) group-hover:opacity-100"
              aria-label="Remove worktree"
              title="Remove worktree"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ))}
    </SectionShell>
  );
}

function SectionShell({
  icon,
  label,
  count,
  addLabel,
  addDisabled,
  onAdd,
  query,
  onQueryChange,
  placeholder,
  loading,
  itemsLoaded,
  emptyLabel,
  empty,
  create,
  children,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  addLabel: string;
  addDisabled: boolean;
  onAdd: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  loading: boolean;
  itemsLoaded: boolean;
  emptyLabel: string;
  empty: boolean;
  create?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex h-7 w-full items-center gap-1.5 rounded-[10px] px-2 text-[length:var(--fs-sm)] font-medium text-(--fg)/52">
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count > 0 ? <span className="text-(--fg)/34">{count}</span> : null}
        {!addDisabled ? (
          <button
            type="button"
            onClick={onAdd}
            className={iconButtonClass}
            aria-label={addLabel}
            title={addLabel}
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        ) : null}
      </div>
      <div className="px-2 pb-0.5">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          className={searchInputClass}
        />
      </div>
      {create}
      {loading && !itemsLoaded ? (
        <div className={cx(listRowClass, "text-(--fg)/40")}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Loading…</span>
        </div>
      ) : itemsLoaded && empty ? (
        <div className={cx(listRowClass, "text-(--fg)/40")}>{emptyLabel}</div>
      ) : (
        <div className="max-h-44 overflow-y-auto">{children}</div>
      )}
    </div>
  );
}

function defaultWorktreePath(cwd: string, branch: string): string {
  const cleaned = branch.trim().replace(/\//g, "-") || "worktree";
  const parent = cwd.slice(0, cwd.lastIndexOf("/") + 1) || "./";
  return `${parent}${cleaned}`;
}

function GitRow({
  gitSummary,
  gitBranch,
  onInitGit,
  onOpenDiff,
}: {
  gitSummary?: GitSummary | null;
  gitBranch?: string | null;
  onInitGit?: () => void;
  onOpenDiff: () => void;
}) {
  if (gitSummary?.isRepo) {
    return (
      <button
        type="button"
        onClick={onOpenDiff}
        className={cx(listRowClass, "hover:bg-(--hover)")}
        title="View changes"
      >
        <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-(--fg)/56" />
        <span className="min-w-0 flex-1 truncate text-(--fg)/72">
          {gitBranch ?? gitSummary.branch ?? "git"}
        </span>
        <span className="flex shrink-0 items-center gap-1 font-mono text-[length:var(--fs-xs)] tabular-nums">
          <span className="text-(--ok)">+{gitSummary.additions}</span>
          <span className="text-(--err)">-{gitSummary.deletions}</span>
          {gitSummary.statusCount > 0 ? (
            <span className="text-(--dim)">· {gitSummary.statusCount} files</span>
          ) : null}
        </span>
      </button>
    );
  }
  if (gitSummary && !gitSummary.isRepo && onInitGit) {
    return (
      <button
        type="button"
        onClick={onInitGit}
        className={cx(listRowClass, "text-(--fg)/56 hover:bg-(--hover) hover:text-(--fg)/82")}
      >
        <GitBranchIcon className="h-3.5 w-3.5 shrink-0" />
        Initialize git
      </button>
    );
  }
  return null;
}

function ProjectList({
  canPickProject,
  cwd,
  projects,
  activeProjectId,
  onPick,
  onAdd,
}: {
  canPickProject: boolean;
  cwd: string;
  projects: Project[];
  activeProjectId: string | null;
  onPick: (project: Project) => void;
  onAdd: () => void;
}) {
  const [query, setQuery] = useState("");
  const text = query.trim().toLowerCase();
  const filtered = projects.filter(
    (project) =>
      !text ||
      project.name.toLowerCase().includes(text) ||
      project.path.toLowerCase().includes(text),
  );

  if (!canPickProject) {
    return (
      <div className={cx(listRowClass, "text-(--fg)/56")}>
        <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--fs-xs)]">
          {cwd || "No working directory"}
        </span>
      </div>
    );
  }
  return (
    <div>
      <div className="flex h-7 w-full items-center gap-1.5 rounded-[10px] px-2 text-[length:var(--fs-sm)] font-medium text-(--fg)/52">
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-(--fg)/46" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate">Projects</span>
        {projects.length > 0 ? <span className="text-(--fg)/34">{projects.length}</span> : null}
        <button
          type="button"
          onClick={onAdd}
          className={iconButtonClass}
          aria-label="Add project"
          title="Add project"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
      <div className="px-2 pb-0.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects…"
          className={searchInputClass}
        />
      </div>
      <div className="flex max-h-44 flex-col overflow-y-auto">
        {filtered.map((project) => {
          const active = project.id === activeProjectId;
          return (
            <button
              key={project.id}
              type="button"
              onClick={() => onPick(project)}
              className={cx(listRowClass, active ? "bg-(--hover)/60" : "hover:bg-(--hover)")}
            >
              <span
                className={cx(
                  "h-1.5 w-1.5 shrink-0 rounded-full",
                  active ? "bg-(--accent)" : "bg-(--dim)/35",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-(--fg)/78">{project.name}</span>
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <div className={cx(listRowClass, "text-(--fg)/40")}>No matching projects</div>
        ) : null}
        <button
          type="button"
          onClick={onAdd}
          className={cx(listRowClass, "text-(--fg)/56 hover:bg-(--hover) hover:text-(--fg)/82")}
        >
          <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Add project…
        </button>
      </div>
    </div>
  );
}

function GoalCard({
  goal,
  editing,
  draft,
  onDraftChange,
  onStartEditing,
  onCancelEditing,
  onSave,
  onTogglePause,
  onRemove,
}: {
  goal: SessionGoal;
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSave: () => void;
  onTogglePause: () => void;
  onRemove: () => void;
}) {
  const paused = goal.status === "paused";
  const terminal =
    goal.status === "complete" || goal.status === "blocked" || goal.status === "budget_limited";
  return (
    <div className="rounded-[14px] bg-(--fg)/[0.03] px-2.5 py-2">
      <div className="flex items-center gap-2">
        <Target
          className={cx(
            "h-4 w-4 shrink-0",
            goal.status === "active"
              ? "text-(--fg)/56"
              : goal.status === "blocked"
                ? "text-(--err)"
                : "text-(--fg)/34",
          )}
        />
        <span className="shrink-0 font-medium text-(--fg)/82">{STATUS_LABEL[goal.status]}</span>
        <span className="min-w-0 flex-1 truncate text-(--fg)/48" title={goal.objective}>
          {goal.objective}
        </span>
        <span className="shrink-0 tabular-nums text-(--fg)/40">
          {formatElapsed(goal.createdAt)}
          {goal.turnBudget ? ` · ${goal.turnsUsed}/${goal.turnBudget}` : ""}
        </span>
        <button
          type="button"
          onClick={onStartEditing}
          className={iconButtonClass}
          aria-label="Edit goal"
          title="Edit goal"
        >
          <FilePenLine className="h-3.5 w-3.5" />
        </button>
        {!terminal ? (
          <button
            type="button"
            onClick={onTogglePause}
            className={iconButtonClass}
            aria-label={paused ? "Resume goal" : "Pause goal"}
            title={paused ? "Resume goal" : "Pause goal"}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onRemove}
          className={iconButtonClass}
          aria-label="Clear goal"
          title="Clear goal"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {editing ? (
        <div className="pt-1.5">
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancelEditing();
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                onSave();
              }
            }}
            rows={2}
            autoFocus
            className="max-h-28 min-h-14 w-full resize-none rounded-xl border border-(--border) bg-transparent px-2.5 py-2 leading-relaxed text-(--fg)/72 outline-none placeholder:text-(--fg)/30"
            aria-label="Goal objective"
          />
          <div className="flex justify-end gap-1 pt-1">
            <button
              type="button"
              onClick={onCancelEditing}
              className={iconButtonClass}
              aria-label="Cancel editing goal"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!draft.trim()}
              className={`${iconButtonClass} bg-(--fg)/90 text-(--bg) hover:bg-(--fg) hover:text-(--bg) disabled:opacity-35`}
              aria-label="Save goal"
              title="Save goal"
            >
              <Save className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DrawerSummaryButton({
  open,
  onToggle,
  label,
  queueCount,
  goalObjective,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
  queueCount: number;
  goalObjective: string | null;
}) {
  const hasQueue = queueCount > 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex h-7 w-full items-center gap-2 px-2.5 text-left text-(--fg)/78 transition-colors hover:bg-(--fg)/[0.03] md:h-8 md:gap-2.5 md:px-3"
    >
      {hasQueue ? (
        <ListChecks
          className="h-3.5 w-3.5 shrink-0 text-(--fg)/56 md:h-4 md:w-4"
          strokeWidth={1.7}
        />
      ) : (
        <FolderOpen
          className="h-3.5 w-3.5 shrink-0 text-(--fg)/56 md:h-4 md:w-4"
          strokeWidth={1.7}
        />
      )}
      <span className="min-w-0 flex-1 truncate">
        {hasQueue ? `${queueCount} queued message${queueCount === 1 ? "" : "s"}` : label}
      </span>
      {goalObjective && !open && !hasQueue ? (
        <span className="min-w-0 max-w-[45%] truncate text-(--fg)/40" title={goalObjective}>
          {goalObjective}
        </span>
      ) : null}
      {goalObjective || hasQueue ? (
        <ChevronDown
          className={cx(
            "h-3.5 w-3.5 shrink-0 text-(--fg)/36 transition-transform",
            open && "rotate-180",
          )}
          strokeWidth={1.75}
        />
      ) : null}
    </button>
  );
}
