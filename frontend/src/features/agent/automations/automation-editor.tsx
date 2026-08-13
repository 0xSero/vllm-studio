"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Button, FormField, Input, Select } from "@/ui";
import { Pause, Play, Trash2, X } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { Automation, AutomationRun, AutomationSchedule } from "@shared/agent/automation";
import type { AutomationModel } from "./automation-api";
import {
  NEW_AUTOMATION_DRAFT,
  absoluteTime,
  draftFromAutomation,
  draftFromSuggestion,
  draftIsValid,
  folderLabel,
  runOutcomeLabel,
  runProvenance,
  runTranscriptHref,
  scheduleLabel,
  shortRelativeTime,
  statusLabel,
  type AutomationDraft,
  type AutomationSuggestion,
} from "./automation-model";

type EditorAction = "save" | "run" | "status" | "delete" | null;

export function AutomationEditor({
  automation,
  creating,
  suggestion,
  models,
  action,
  error,
  onClose,
  onSave,
  onRun,
  onToggleStatus,
  onDelete,
}: {
  automation: Automation | null;
  creating: boolean;
  suggestion?: AutomationSuggestion | null;
  models: readonly AutomationModel[];
  action: EditorAction;
  error: string;
  onClose: () => void;
  onSave: (draft: AutomationDraft) => void;
  onRun: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<AutomationDraft>(() =>
    automation
      ? draftFromAutomation(automation)
      : suggestion
        ? draftFromSuggestion(NEW_AUTOMATION_DRAFT, suggestion)
        : NEW_AUTOMATION_DRAFT,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  useMountSubscription(() => {
    if (draft.modelId || models.length === 0) return;
    const active = models.find((model) => model.active);
    setDraft((current) => ({ ...current, modelId: active?.id ?? models[0]?.id ?? "" }));
  }, [draft.modelId, models]);

  const updateSchedule = (schedule: AutomationSchedule) => {
    setDraft((current) => ({ ...current, schedule }));
  };
  const busy = action !== null;

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-(--ui-bg)">
      <EditorHeader
        automation={automation}
        creating={creating}
        action={action}
        busy={busy}
        onClose={onClose}
        onRun={onRun}
        onToggleStatus={onToggleStatus}
      />

      <form
        className="min-h-0 flex-1 overflow-y-auto"
        onSubmit={(event) => {
          event.preventDefault();
          if (draftIsValid(draft) && !busy) onSave(draft);
        }}
      >
        <div className="mx-auto w-full max-w-2xl space-y-6 px-5 py-4 sm:px-7">
          <div>
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="New scheduled task"
              aria-label="Scheduled task name"
              autoFocus={creating}
              className="w-full bg-transparent text-[length:var(--fs-2xl)] font-medium leading-8 text-(--ui-fg) outline-none placeholder:text-(--ui-muted)/60"
            />
            <textarea
              value={draft.prompt}
              onChange={(event) =>
                setDraft((current) => ({ ...current, prompt: event.target.value }))
              }
              placeholder="What should the agent do on every run?"
              aria-label="Scheduled task instructions"
              rows={6}
              className="mt-2 w-full resize-y bg-transparent text-[length:var(--fs-base)] leading-6 text-(--ui-fg) outline-none placeholder:text-(--ui-muted)/60"
            />
          </div>

          <EditorSection title="Frequency" summary={scheduleLabel(draft.schedule)}>
            <ScheduleEditor schedule={draft.schedule} onChange={updateSchedule} />
          </EditorSection>

          <EditorSection title="Details">
            <DetailRow
              label="Type"
              value={draft.target?.kind === "thread" ? "Scheduled chat" : "Scheduled task"}
            />
            <DetailRow label="Runs in" value="This device" />
            <FormField label="Model" required>
              <Select
                value={draft.modelId}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, modelId: event.target.value }))
                }
              >
                {models.length === 0 ? <option value="">No models available</option> : null}
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Working directory"
              description={
                draft.target?.kind === "thread"
                  ? "The folder that holds the conversation this task runs inside."
                  : "Optional. Leave empty to use the Local Studio default."
              }
            >
              <Input
                value={draft.cwd}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, cwd: event.target.value }))
                }
                placeholder="/path/to/project"
              />
            </FormField>
          </EditorSection>

          {!creating && automation?.runs.length ? <RunHistory automation={automation} /> : null}

          {error ? <EditorError error={error} /> : null}

          <EditorFooter
            automation={automation}
            creating={creating}
            action={action}
            busy={busy}
            canSave={draftIsValid(draft)}
            confirmDelete={confirmDelete}
            onConfirmDelete={() => setConfirmDelete(true)}
            onCancelDelete={() => setConfirmDelete(false)}
            onDelete={onDelete}
          />
        </div>
      </form>
    </section>
  );
}

function EditorHeader({
  automation,
  creating,
  action,
  busy,
  onClose,
  onRun,
  onToggleStatus,
}: {
  automation: Automation | null;
  creating: boolean;
  action: EditorAction;
  busy: boolean;
  onClose: () => void;
  onRun: () => void;
  onToggleStatus: () => void;
}) {
  const active = automation?.status === "active";
  const nextRun = automation && active ? shortRelativeTime(automation.nextRunAt) : "";
  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 border-b border-(--ui-border) px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[length:var(--fs-sm)] leading-4">
        <span
          className={`shrink-0 font-medium ${active ? "text-(--ui-info)" : "text-(--ui-muted)"}`}
        >
          {creating ? "New" : automation ? statusLabel(automation) : ""}
        </span>
        {nextRun ? (
          <>
            <span aria-hidden className="shrink-0 text-(--ui-muted)/60">
              ·
            </span>
            <span className="min-w-0 truncate text-(--ui-muted)">Next run {nextRun}</span>
          </>
        ) : null}
      </div>
      {!creating && automation ? (
        <>
          <Button
            variant="secondary"
            size="sm"
            loading={action === "run"}
            disabled={busy}
            onClick={onRun}
            icon={<Play className="h-3.5 w-3.5" />}
          >
            Run now
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={action === "status"}
            disabled={busy}
            onClick={onToggleStatus}
            icon={
              automation.status === "paused" ? (
                <Play className="h-3.5 w-3.5" />
              ) : (
                <Pause className="h-3.5 w-3.5" />
              )
            }
          >
            {automation.status === "paused" ? "Resume" : "Pause"}
          </Button>
        </>
      ) : null}
      <Button variant="icon" size="sm" onClick={onClose} aria-label="Close scheduled task details">
        <X className="h-4 w-4" />
      </Button>
    </header>
  );
}

function EditorSection({
  title,
  summary,
  action,
  children,
}: {
  title: string;
  summary?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-(--ui-separator) pt-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">{title}</h3>
        {action ?? (
          <span className="truncate text-[length:var(--fs-xs)] text-(--ui-muted)">{summary}</span>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-[length:var(--fs-sm)] text-(--ui-muted)">{label}</span>
      <span className="min-w-0 truncate text-right text-[length:var(--fs-base)] text-(--ui-fg)">
        {value}
      </span>
    </div>
  );
}

function RunHistory({ automation }: { automation: Automation }) {
  return (
    <EditorSection
      title="Previous runs"
      summary={`${automation.runs.length} ${automation.runs.length === 1 ? "run" : "runs"}`}
    >
      <div role="list" className="-mx-1 flex flex-col">
        {automation.runs.map((run, index) => (
          <RunRow key={`${run.at}-${run.piSessionId ?? index}`} run={run} />
        ))}
      </div>
    </EditorSection>
  );
}

function RunRow({ run }: { run: AutomationRun }) {
  const href = runTranscriptHref(run);
  const provenance = runProvenance(run);
  const failed = run.outcome === "error";
  const body = (
    <>
      <span className="flex w-5 shrink-0 items-center justify-center self-start pt-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${failed ? "bg-(--ui-danger)" : "bg-(--ui-muted)/60"}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className={`shrink-0 text-[length:var(--fs-base)] leading-5 ${failed ? "text-(--ui-danger)" : "text-(--ui-fg)"}`}
          >
            {runOutcomeLabel(run)}
          </span>
          <span className="min-w-0 truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
            {folderLabel(run.cwd)}
          </span>
        </span>
        {provenance ? (
          <span className="mt-0.5 block truncate text-[length:var(--fs-xs)] leading-4 text-(--ui-muted)">
            {provenance}
          </span>
        ) : null}
        {run.error ? (
          <span className="mt-1 block whitespace-pre-wrap text-[length:var(--fs-sm)] leading-5 text-(--ui-danger)">
            {run.error}
          </span>
        ) : run.summary ? (
          <span className="mt-1 line-clamp-2 block whitespace-pre-wrap text-[length:var(--fs-sm)] leading-5 text-(--ui-muted)">
            {run.summary}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 self-start pt-0.5 text-[length:var(--fs-sm)] leading-5 tabular-nums text-(--ui-muted)">
        {shortRelativeTime(run.at)}
      </span>
    </>
  );
  const rowClass = "flex gap-2 rounded-[var(--ui-radius)] px-1 py-2 transition-colors";
  if (!href) {
    return (
      <div
        role="listitem"
        title={`${absoluteTime(run.at)} — transcript unavailable`}
        className={`${rowClass} opacity-60`}
      >
        {body}
      </div>
    );
  }
  return (
    <Link
      role="listitem"
      href={href}
      title={absoluteTime(run.at)}
      className={`${rowClass} hover:bg-(--ui-hover)/40`}
    >
      {body}
    </Link>
  );
}

function EditorError({ error }: { error: string }) {
  return (
    <div
      role="alert"
      className="rounded-[10px] bg-(--ui-danger)/10 px-3 py-2 text-[length:var(--fs-sm)] text-(--ui-danger)"
    >
      {error}
    </div>
  );
}

function EditorFooter({
  automation,
  creating,
  action,
  busy,
  canSave,
  confirmDelete,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
}: {
  automation: Automation | null;
  creating: boolean;
  action: EditorAction;
  busy: boolean;
  canSave: boolean;
  confirmDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-(--ui-border) pt-6">
      {!creating && automation ? (
        confirmDelete ? (
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              loading={action === "delete"}
              disabled={busy}
              onClick={onDelete}
            >
              Delete scheduled task
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onCancelDelete}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onConfirmDelete}
            icon={<Trash2 className="h-3.5 w-3.5" />}
            className="text-(--ui-danger)"
          >
            Delete
          </Button>
        )
      ) : (
        <span />
      )}
      <Button type="submit" loading={action === "save"} disabled={!canSave || busy}>
        {creating ? "Create scheduled task" : "Save"}
      </Button>
    </div>
  );
}

function ScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: AutomationSchedule;
  onChange: (schedule: AutomationSchedule) => void;
}) {
  const mode = schedule.kind === "daily" && schedule.weekdaysOnly ? "weekdays" : schedule.kind;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Repeat">
        <Select
          value={mode}
          onChange={(event) => {
            const next = event.target.value;
            if (next === "interval") onChange({ kind: "interval", minutes: 60 });
            else if (next === "weekly") onChange({ kind: "weekly", day: 1, time: "08:00" });
            else
              onChange({
                kind: "daily",
                time: "08:00",
                ...(next === "weekdays" ? { weekdaysOnly: true } : {}),
              });
          }}
        >
          <option value="interval">Every few minutes or hours</option>
          <option value="daily">Daily</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekly">Weekly</option>
        </Select>
      </FormField>
      {schedule.kind === "interval" ? (
        <FormField label="Every">
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={schedule.minutes}
              onChange={(event) =>
                onChange({
                  kind: "interval",
                  minutes: Math.max(1, Number(event.target.value) || 1),
                })
              }
            />
            <span className="shrink-0 text-[length:var(--fs-sm)] text-(--ui-muted)">minutes</span>
          </div>
        </FormField>
      ) : (
        <FormField label="At">
          <Input
            type="time"
            value={schedule.time}
            onChange={(event) => onChange({ ...schedule, time: event.target.value })}
          />
        </FormField>
      )}
      {schedule.kind === "weekly" ? (
        <FormField label="On">
          <Select
            value={String(schedule.day)}
            onChange={(event) =>
              onChange({ ...schedule, day: Number.parseInt(event.target.value, 10) })
            }
          >
            {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
              (day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ),
            )}
          </Select>
        </FormField>
      ) : null}
    </div>
  );
}
