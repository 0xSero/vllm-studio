"use client";

import { createPortal } from "react-dom";
import { useCallback, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderOpen,
  GitBranch,
  Globe2,
  ListChecks,
  Loader2,
  Monitor,
  Plus,
  RefreshCw,
} from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useProjects } from "@/features/agent/projects/context";
import type { GitSummary, Project } from "@/features/agent/projects/types";
import { createBranch, listBranches, switchBranch } from "@/features/agent/projects/api";
import type { GitBranch as GitBranchType } from "@/features/agent/contracts";
import { GoalCard, type GoalDraft } from "@/features/agent/ui/goal-card";
import { GoalStrip } from "@/features/agent/ui/goal-strip";
import { useSessionGoal } from "@/features/agent/ui/use-session-goal";
import { ADD_PROJECT_EVENT } from "@/lib/workspace-events";
import { cx } from "@/ui/utils";
import { POPOVER_SURFACE_CLASS } from "@/ui/popover";
import { handleMenuKeyboard } from "@/ui/menu";
import { QueuedMessageStack } from "@/features/agent/ui/queued-message-stack";
import type { QueuedMessage } from "@/features/agent/messages";
import type { BrowserBackend } from "@/features/agent/tools/types";

const iconButtonClass =
  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-(--fg)/42 transition-colors hover:bg-(--hover) hover:text-(--fg)/82 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--fg)/25";

const listRowClass =
  "flex h-8 w-full items-center gap-2 rounded-[10px] px-2 text-left transition-colors";

const searchInputClass =
  "h-7 w-full min-w-0 rounded-md bg-(--fg)/[0.04] px-2 text-[length:var(--fs-xs)] text-(--fg) outline-none placeholder:text-(--fg)/30 focus:bg-(--fg)/[0.06]";

type ComposerContextView = "root" | "goal" | "projects" | "git";
type ComposerContextPlacement = "above" | "below";

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
  open: controlledOpen,
  onOpenChange,
  onRequestAttach,
  browserToolEnabled,
  browserBackend,
  onToggleBrowserBackend,
  onToggleBrowserTool,
  contextTriggerRef,
  workspaceToolsEnabled = true,
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
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onRequestAttach?: () => void;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  onToggleBrowserBackend: () => void;
  onToggleBrowserTool: () => void;
  contextTriggerRef: RefObject<HTMLButtonElement | null>;
  workspaceToolsEnabled?: boolean;
}) {
  const projects = useProjects();
  const [internalOpen, setInternalOpen] = useState(false);
  const [view, setView] = useState<ComposerContextView>("root");
  const [query, setQuery] = useState("");
  const [panelReady, setPanelReady] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const [panelPresent, setPanelPresent] = useState(open);
  const setOpen = useCallback(
    (next: boolean) => {
      if (next) {
        setView("root");
        setPanelReady(false);
        setPanelPresent(true);
      } else {
        setQuery("");
      }
      if (controlledOpen === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [panelPlacement, setPanelPlacement] = useState<ComposerContextPlacement>("below");
  const [panelMaxHeight, setPanelMaxHeight] = useState(448);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0, width: 320 });
  const positionPanel = useCallback(() => {
    const anchor = contextTriggerRef.current?.closest<HTMLElement>(".agent-composer-box");
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const anchorRect = anchor.getBoundingClientRect();
    const width = Math.min(anchorRect.width, Math.max(0, window.innerWidth - 16));
    const availableAbove = Math.max(0, anchorRect.top - 8);
    const availableBelow = Math.max(0, window.innerHeight - anchorRect.bottom - 8);
    const placement = panel.scrollHeight <= availableBelow ? "below" : "above";
    const left = Math.min(Math.max(8, anchorRect.left), Math.max(8, window.innerWidth - width - 8));
    const top =
      placement === "above"
        ? Math.max(8, anchorRect.top - Math.min(panel.scrollHeight, availableAbove) - 8)
        : anchorRect.bottom + 8;
    setPanelPlacement(placement);
    setPanelMaxHeight(Math.max(96, placement === "above" ? availableAbove : availableBelow));
    setPanelPosition({ top, left, width });
    setPanelReady(true);
  }, [contextTriggerRef]);
  const setPanelNode = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      if (!node || !open) return;
      positionPanel();
      requestAnimationFrame(() => searchRef.current?.focus());
    },
    [open, positionPanel],
  );
  const {
    goal,
    error: goalError,
    patch: patchGoal,
    clear: clearGoal,
  } = useSessionGoal(piSessionId, revision);

  const isRepo = gitSummary?.isRepo === true;
  const gitEnabled = !running && isRepo;

  const submitGoal = useCallback(
    (draft: GoalDraft) => {
      // Every write from this card reactivates. Editing used to send the
      // objective alone, so a re-aimed goal kept its `complete` status — and a
      // non-active goal is excluded from prompt injection, meaning the new
      // objective steered nothing while the card still said "Goal complete".
      void patchGoal({
        objective: draft.objective,
        turnBudget: draft.turnBudget,
        status: "active",
        resetTurns: draft.resetProgress,
      });
    },
    [patchGoal],
  );

  const activeProject = projects.findByPath(cwd) ?? projects.selectedProject;
  // The projects store seeds itself from localStorage synchronously at
  // creation, so the client's very first render already knows the selected
  // project while the server's render cannot. Naming it during hydration is a
  // mismatch, and React responds by throwing away and re-rendering the whole
  // subtree — the composer. Hold the neutral label until after mount, which is
  // one frame, and hydrate clean.
  const [hydrated, setHydrated] = useState(false);
  useMountSubscription(() => setHydrated(true), []);
  // Every source of this name is client-only: `projectName` comes from the
  // pane's restored view state and `activeProject` from the projects store,
  // which seeds from localStorage synchronously. The server can know none of
  // it, so the first client render must say what the server said and only then
  // fill in — otherwise React discards and re-renders the whole composer.
  const label = hydrated
    ? (projectName ?? activeProject?.name ?? "Choose project")
    : "Choose project";
  const hasQueue = queueItems.length > 0;

  useMountSubscription(() => {
    if (!open) {
      setView("root");
      setQuery("");
      return;
    }
    setView("root");
    setQuery("");
    const frame = requestAnimationFrame(() => {
      positionPanel();
      searchRef.current?.focus();
    });
    const observer = new ResizeObserver(positionPanel);
    if (panelRef.current) observer.observe(panelRef.current);
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        panelRef.current?.contains(event.target) ||
        contextTriggerRef.current?.contains(event.target)
      )
        return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      requestAnimationFrame(() => {
        contextTriggerRef.current?.focus();
      });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [contextTriggerRef, open, positionPanel, setOpen]);

  useMountSubscription(() => {
    if (open) {
      setPanelPresent(true);
      return;
    }
    const timeout = window.setTimeout(() => {
      setPanelPresent(false);
      setPanelReady(false);
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [open]);

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
    <>
      {goal ? (
        <GoalStrip
          goal={goal}
          onTogglePause={() =>
            void patchGoal({ status: goal.status === "paused" ? "active" : "paused" })
          }
          onClear={() => void clearGoal()}
          onOpen={() => setOpen(true)}
        />
      ) : null}
      {hasQueue ? (
        <div className="px-1.5 pb-1">
          <QueuedMessageStack
            items={queueItems}
            running={running}
            onEdit={onEditQueued}
            onRemove={onRemoveQueued}
            onSteer={onSteerQueued}
          />
        </div>
      ) : null}
      <section
        data-testid="composer-drawer"
        data-open={open ? "true" : "false"}
        className="agent-composer-project-drawer relative z-20 h-0 w-full overflow-visible text-[length:var(--fs-xs)] md:text-[length:var(--fs-sm)]"
      >
        {panelPresent && typeof document !== "undefined"
          ? createPortal(
              <div
                ref={setPanelNode}
                style={{
                  top: panelPosition.top,
                  left: panelPosition.left,
                  width: panelPosition.width,
                  maxHeight: panelMaxHeight,
                  visibility: panelReady ? "visible" : "hidden",
                }}
                data-placement={panelPlacement}
                data-state={open ? "open" : "closed"}
                className={cx(
                  `composer-context-popover fixed z-[300] overflow-y-auto p-1 text-(--fg) ${POPOVER_SURFACE_CLASS}`,
                  panelReady &&
                    (open ? "composer-popover-enter" : "composer-popover-exit pointer-events-none"),
                )}
                aria-hidden={!open}
                onKeyDown={
                  view === "root"
                    ? (event) =>
                        handleMenuKeyboard(event, () => {
                          setOpen(false);
                          requestAnimationFrame(() => contextTriggerRef.current?.focus());
                        })
                    : undefined
                }
              >
                {view === "root" || view === "projects" ? (
                  <div className="flex items-center gap-1 border-b border-(--border) px-0.5 pb-1.5">
                    {view === "projects" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setView("root");
                          setQuery("");
                        }}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
                        aria-label="Back to context menu"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <input
                      ref={searchRef}
                      autoFocus
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={view === "projects" ? "Search projects…" : "Search context…"}
                      className="h-7 min-w-0 flex-1 rounded-[5px] bg-(--fg)/[0.055] px-2 text-[length:var(--fs-sm)] text-(--fg) outline-none placeholder:text-(--fg)/35 focus:bg-(--fg)/[0.085] focus-visible:ring-1 focus-visible:ring-(--focus-ring)"
                      aria-label={view === "projects" ? "Search projects" : "Search context"}
                    />
                  </div>
                ) : (
                  <ContextViewHeader
                    label={view === "goal" ? "Goal" : "Branches"}
                    onBack={() => {
                      setView("root");
                      setQuery("");
                    }}
                  />
                )}
                {view === "root" ? (
                  <ContextMenuRoot
                    query={query}
                    projectLabel={label}
                    gitBranch={gitBranch}
                    gitSummary={gitSummary}
                    canPickProject={canPickProject}
                    canAttach={Boolean(onRequestAttach)}
                    browserToolEnabled={browserToolEnabled}
                    browserBackend={browserBackend}
                    onAttach={() => {
                      setOpen(false);
                      onRequestAttach?.();
                    }}
                    onGoal={() => {
                      setQuery("");
                      setView("goal");
                    }}
                    onProjects={() => {
                      setQuery("");
                      setView("projects");
                    }}
                    onGit={() => {
                      setQuery("");
                      setView("git");
                    }}
                    onChanges={() => {
                      setOpen(false);
                      onOpenDiff();
                    }}
                    onInitGit={() => {
                      setOpen(false);
                      onInitGit?.();
                    }}
                    onToggleBrowserBackend={onToggleBrowserBackend}
                    onToggleBrowserTool={onToggleBrowserTool}
                    workspaceToolsEnabled={workspaceToolsEnabled}
                  />
                ) : null}
                {view === "goal" ? (
                  <GoalCard
                    goal={goal}
                    running={running}
                    error={goalError}
                    onSubmit={submitGoal}
                    onTogglePause={() =>
                      void patchGoal({ status: goal?.status === "paused" ? "active" : "paused" })
                    }
                    onRestart={() => void patchGoal({ status: "active", resetTurns: true })}
                    onClear={() => void clearGoal()}
                  />
                ) : null}
                {view === "projects" ? (
                  <ProjectList
                    canPickProject={canPickProject}
                    cwd={cwd}
                    projects={projects.projects}
                    activeProjectId={activeProject?.id ?? null}
                    query={query}
                    onPick={pickProject}
                    onAdd={addProject}
                  />
                ) : null}
                {view === "git" && isRepo ? (
                  <GitResourceSections
                    key={cwd}
                    cwd={cwd}
                    enabled={gitEnabled}
                    onBranchSwitched={async () => {
                      await projects.loadGitSummary(cwd);
                      await projects.refresh();
                    }}
                  />
                ) : null}
              </div>,
              document.body,
            )
          : null}
      </section>
    </>
  );
}

function ContextViewHeader({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex h-8 items-center gap-1 border-b border-(--border) px-0.5 pb-1">
      <button
        type="button"
        onClick={onBack}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[5px] text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
        aria-label="Back to context menu"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </button>
      <span className="truncate px-1 text-[length:var(--fs-sm)] font-medium text-(--fg)/85">
        {label}
      </span>
    </div>
  );
}

function ContextMenuRoot({
  query,
  projectLabel,
  gitBranch,
  gitSummary,
  canPickProject,
  canAttach,
  browserToolEnabled,
  browserBackend,
  onAttach,
  onGoal,
  onProjects,
  onGit,
  onChanges,
  onInitGit,
  onToggleBrowserBackend,
  onToggleBrowserTool,
  workspaceToolsEnabled,
}: {
  query: string;
  projectLabel: string;
  gitBranch?: string | null;
  gitSummary?: GitSummary | null;
  canPickProject: boolean;
  canAttach: boolean;
  browserToolEnabled: boolean;
  browserBackend: BrowserBackend;
  onAttach: () => void;
  onGoal: () => void;
  onProjects: () => void;
  onGit: () => void;
  onChanges: () => void;
  onInitGit: () => void;
  onToggleBrowserBackend: () => void;
  onToggleBrowserTool: () => void;
  workspaceToolsEnabled: boolean;
}) {
  const actions = [
    ...(canAttach
      ? [
          {
            key: "files",
            label: "Files",
            detail: "Attach files to this prompt",
            icon: <FileText className="h-3.5 w-3.5" />,
            onClick: onAttach,
            disabled: false,
            drillIn: false,
            group: "session",
          },
        ]
      : []),
    {
      key: "goal",
      label: "Goal",
      detail: "Set or manage the session goal",
      icon: <ListChecks className="h-3.5 w-3.5" />,
      onClick: onGoal,
      disabled: false,
      drillIn: true,
      group: "session",
    },
    {
      key: "browser",
      label: "Browser tools",
      detail: browserToolEnabled ? "On" : "Off",
      icon: <Globe2 className="h-3.5 w-3.5" />,
      onClick: onToggleBrowserTool,
      disabled: !workspaceToolsEnabled,
      drillIn: false,
      group: "tools",
    },
    ...(browserToolEnabled
      ? [
          {
            key: "browser-access",
            label: "Browser access",
            detail: workspaceToolsEnabled
              ? browserBackend === "chrome"
                ? "Personal browser"
                : "Sandbox only"
              : "Built-in sandbox",
            icon: <Monitor className="h-3.5 w-3.5" />,
            onClick: workspaceToolsEnabled ? onToggleBrowserBackend : () => undefined,
            disabled: !workspaceToolsEnabled,
            drillIn: false,
            group: "tools",
          },
        ]
      : []),
    ...(workspaceToolsEnabled
      ? [
          {
            key: "project",
            label: "Project",
            detail: projectLabel,
            icon: <FolderOpen className="h-3.5 w-3.5" />,
            onClick: onProjects,
            disabled: !canPickProject,
            drillIn: true,
            group: "workspace",
          },
        ]
      : []),
    ...(workspaceToolsEnabled && gitSummary
      ? [
          gitSummary.isRepo
            ? {
                key: "git",
                label: "Branch",
                detail: gitBranch ?? "Choose a branch",
                icon: <GitBranch className="h-3.5 w-3.5" />,
                onClick: onGit,
                disabled: false,
                drillIn: true,
                group: "workspace",
              }
            : {
                key: "git",
                label: "Initialize Git",
                detail: "Create a repository for this project",
                icon: <GitBranch className="h-3.5 w-3.5" />,
                onClick: onInitGit,
                disabled: false,
                drillIn: false,
                group: "workspace",
              },
        ]
      : []),
    ...(workspaceToolsEnabled && gitSummary?.isRepo
      ? [
          {
            key: "changes",
            label: "Changes",
            detail: `${gitSummary.additions} added · ${gitSummary.deletions} removed · ${gitSummary.statusCount} files`,
            icon: <ListChecks className="h-3.5 w-3.5" />,
            onClick: onChanges,
            disabled: false,
            drillIn: false,
            group: "workspace",
          },
        ]
      : []),
  ];
  const text = query.trim().toLowerCase();
  const visible = actions.filter(
    (action) => !text || `${action.label} ${action.detail}`.toLowerCase().includes(text),
  );

  return (
    <div role="menu" aria-label="Add context" className="flex flex-col gap-px pt-1">
      {visible.length ? (
        visible.map((action, index) => (
          <div key={action.key} role="none">
            {index > 0 && visible[index - 1]?.group !== action.group ? (
              <div className="my-1 h-px bg-(--border)" aria-hidden />
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={action.onClick}
              disabled={action.disabled}
              className="group flex h-6 min-h-6 w-full items-center gap-2 rounded-[5px] px-2 py-0 text-left text-[length:var(--fs-xs)] transition-[background-color,color] duration-[var(--motion-fast)] hover:bg-(--hover) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-(--focus-ring) disabled:opacity-35"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-(--dim) group-hover:text-(--fg)/80">
                {action.icon}
              </span>
              <span className="min-w-0 flex-1 truncate text-(--fg)/88">{action.label}</span>
              <span className="max-w-[52%] truncate text-right text-(--dim)">{action.detail}</span>
              {action.drillIn ? (
                <ChevronRight className="h-3 w-3 shrink-0 text-(--dim)/65" />
              ) : null}
            </button>
          </div>
        ))
      ) : (
        <div className="px-2 py-3 text-center text-[length:var(--fs-xs)] text-(--dim)">
          No matching context
        </div>
      )}
    </div>
  );
}

function GitResourceSections({
  cwd,
  enabled,
  onBranchSwitched,
}: {
  cwd: string;
  enabled: boolean;
  onBranchSwitched: () => Promise<void>;
}) {
  const [branches, setBranches] = useState<GitBranchType[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBranches(await listBranches(cwd));
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

function ProjectList({
  canPickProject,
  cwd,
  projects,
  activeProjectId,
  query: externalQuery,
  onPick,
  onAdd,
}: {
  canPickProject: boolean;
  cwd: string;
  projects: Project[];
  activeProjectId: string | null;
  query?: string;
  onPick: (project: Project) => void;
  onAdd: () => void;
}) {
  const [query, setQuery] = useState("");
  const effectiveQuery = externalQuery ?? query;
  const text = effectiveQuery.trim().toLowerCase();
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
      {externalQuery === undefined ? (
        <div className="px-2 pb-0.5">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects…"
            className={searchInputClass}
          />
        </div>
      ) : null}
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
