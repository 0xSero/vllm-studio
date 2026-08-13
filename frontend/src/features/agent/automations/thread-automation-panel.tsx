"use client";

import { Effect } from "effect";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Spinner } from "@/ui";
import { ChevronDown, Clock, Pause, Plus } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { Automation } from "@shared/agent/automation";
import {
  listAutomationModels,
  useAutomationActions,
  useAutomations,
  type AutomationModel,
} from "./automation-api";
import { AutomationEditor } from "./automation-editor";
import {
  NEW_AUTOMATION_DRAFT,
  nextRunLabel,
  threadAutomations,
  type AutomationDraft,
} from "./automation-model";

const PANEL_STATE_KEY = "agent.threadScheduledTasks";

type PanelState = { open: boolean; automationId: string | null };

function readPanelState(piSessionId: string): PanelState {
  if (typeof window === "undefined") return { open: false, automationId: null };
  try {
    const raw = window.localStorage.getItem(PANEL_STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, PanelState>) : {};
    const entry = parsed[piSessionId];
    return entry && typeof entry.open === "boolean"
      ? { open: entry.open, automationId: entry.automationId ?? null }
      : { open: false, automationId: null };
  } catch {
    return { open: false, automationId: null };
  }
}

function writePanelState(piSessionId: string, state: PanelState): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(PANEL_STATE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, PanelState>) : {};
    window.localStorage.setItem(
      PANEL_STATE_KEY,
      JSON.stringify({ ...parsed, [piSessionId]: state }),
    );
  } catch {
    return;
  }
}

export function ThreadAutomationPanel({ piSessionId, cwd }: { piSessionId: string; cwd: string }) {
  const { automations } = useAutomations();
  const actions = useAutomationActions();
  const [state, setState] = useState<PanelState>(() => readPanelState(piSessionId));
  const [models, setModels] = useState<AutomationModel[]>([]);
  const tasks = useMemo(
    () => threadAutomations(automations, piSessionId),
    [automations, piSessionId],
  );

  const update = useCallback(
    (next: PanelState) => {
      setState(next);
      writePanelState(piSessionId, next);
    },
    [piSessionId],
  );

  useMountSubscription(() => {
    if (!state.open || models.length > 0) return;
    void Effect.runPromise(listAutomationModels())
      .then(setModels)
      .catch(() => undefined);
  }, [models.length, state.open]);

  const selected = state.automationId
    ? (tasks.find((task) => task.id === state.automationId) ?? null)
    : null;
  const creating = state.open && selected === null;
  const seed = useMemo<AutomationDraft>(
    () => ({
      ...NEW_AUTOMATION_DRAFT,
      cwd,
      target: { kind: "thread", threadId: piSessionId, piSessionId },
    }),
    [cwd, piSessionId],
  );

  if (tasks.length === 0 && !state.open) return null;

  if (!state.open) {
    return (
      <PanelShell>
        <div className="flex flex-wrap items-center gap-1.5">
          {tasks.map((task) => (
            <TaskChip
              key={task.id}
              task={task}
              running={actions.action === "run" && actions.pendingId === task.id}
              onOpen={() => update({ open: true, automationId: task.id })}
            />
          ))}
          <button
            type="button"
            onClick={() => update({ open: true, automationId: null })}
            className="flex items-center gap-1.5 rounded-full bg-(--fg)/[0.05] px-2.5 py-1 text-[length:var(--fs-sm)] text-(--fg)/60 transition-colors hover:bg-(--fg)/[0.08] hover:text-(--fg)/85"
          >
            <Plus className="h-3 w-3" />
            New scheduled task
          </button>
        </div>
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <div className="overflow-hidden rounded-[var(--rad-lg)] border border-(--border) bg-(--surface)/60">
        <div className="flex items-center gap-2 border-b border-(--separator) px-3 py-1.5">
          <Clock className="h-3.5 w-3.5 shrink-0 text-(--dim)" />
          <span className="text-[length:var(--fs-sm)] text-(--fg)/80">Scheduled tasks</span>
          <span className="text-[length:var(--fs-sm)] text-(--dim)">{tasks.length}</span>
          <div className="ml-auto flex items-center gap-1">
            {creating ? null : (
              <button
                type="button"
                onClick={() => update({ open: true, automationId: null })}
                aria-label="New scheduled task"
                title="New scheduled task"
                className="flex h-6 w-6 items-center justify-center rounded-[var(--rad-xs)] text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => update({ open: false, automationId: state.automationId })}
              aria-label="Collapse scheduled tasks"
              title="Collapse scheduled tasks"
              className="flex h-6 w-6 items-center justify-center rounded-[var(--rad-xs)] text-(--dim) transition-colors hover:bg-(--hover) hover:text-(--fg)"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {tasks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1 border-b border-(--separator) px-2 py-1.5">
            {tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => update({ open: true, automationId: task.id })}
                aria-current={task.id === selected?.id ? "true" : undefined}
                className={`max-w-48 truncate rounded-full px-2 py-0.5 text-[length:var(--fs-sm)] transition-colors ${
                  task.id === selected?.id
                    ? "bg-(--active) text-(--fg)"
                    : "text-(--dim) hover:bg-(--hover) hover:text-(--fg)"
                }`}
              >
                {task.name || "Untitled scheduled task"}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex max-h-[min(46vh,420px)] min-h-0 flex-col">
          <AutomationEditor
            key={selected?.id ?? "new"}
            automation={selected}
            creating={creating}
            seed={seed}
            models={models}
            action={actions.action}
            error={actions.error}
            compact
            onClose={() => update({ open: false, automationId: state.automationId })}
            onSave={(draft) => {
              void actions.save(draft, selected).then((saved) => {
                if (saved) update({ open: true, automationId: saved.id });
              });
            }}
            onRun={() => selected && void actions.run(selected)}
            onToggleStatus={() => selected && void actions.toggleStatus(selected)}
            onDelete={() => {
              if (!selected) return;
              const next = tasks.find((task) => task.id !== selected.id) ?? null;
              void actions.remove(selected).then((removed) => {
                if (removed) update({ open: next !== null, automationId: next?.id ?? null });
              });
            }}
          />
        </div>
      </div>
    </PanelShell>
  );
}

function PanelShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto mb-1.5 w-full max-w-[calc(var(--composer-w)*0.9)]">{children}</div>
  );
}

function TaskChip({
  task,
  running,
  onOpen,
}: {
  task: Automation;
  running: boolean;
  onOpen: () => void;
}) {
  const paused = task.status === "paused";
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${task.name} — ${nextRunLabel(task)}`}
      className="flex items-center gap-1.5 rounded-full bg-(--fg)/[0.05] px-2.5 py-1 text-[length:var(--fs-sm)] text-(--fg)/75 transition-colors hover:bg-(--fg)/[0.08] hover:text-(--fg)/90"
    >
      {running ? (
        <Spinner size="xs" />
      ) : paused ? (
        <Pause className="h-3 w-3 text-(--dim)" />
      ) : (
        <Clock className="h-3 w-3 text-(--dim)" />
      )}
      <span className="max-w-44 truncate">{task.name || "Untitled scheduled task"}</span>
      <span className="text-(--fg)/40">{nextRunLabel(task)}</span>
    </button>
  );
}
