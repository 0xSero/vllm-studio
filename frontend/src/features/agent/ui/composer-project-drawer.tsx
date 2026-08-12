"use client";

import { useCallback, useState } from "react";
import {
  ChevronDown,
  FilePenLine,
  FolderOpen,
  ListChecks,
  Pause,
  Play,
  Plus,
  Save,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { GitBranchIcon } from "@/ui/icons";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useProjectsStore } from "@/features/agent/projects/store";
import type { GitSummary, Project } from "@/features/agent/projects/types";
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
  const projects = useProjectsStore();
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState<SessionGoal | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

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

  const activeProject = projects.findByPath(cwd) ?? projects.selectedProject();
  const label = projectName ?? activeProject?.name ?? "Choose project";
  const hasQueue = queueItems.length > 0;
  const paused = goal?.status === "paused";
  const terminal =
    goal?.status === "complete" || goal?.status === "blocked" || goal?.status === "budget_limited";

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
        <div className="flex flex-col gap-0.5 px-1.5 pt-1">
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
        </div>
      ) : null}
    </section>
  );
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
    <div className="flex max-h-56 flex-col overflow-y-auto">
      {projects.map((project) => {
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
      <button
        type="button"
        onClick={onAdd}
        className={cx(listRowClass, "text-(--fg)/56 hover:bg-(--hover) hover:text-(--fg)/82")}
      >
        <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        Add project…
      </button>
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

/** The always-visible drawer row. It names the project normally, and steps
 *  aside for the queue count while messages are waiting — that backlog is the
 *  more urgent thing to know. */
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
