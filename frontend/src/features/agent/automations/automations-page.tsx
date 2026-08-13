"use client";

import { Effect } from "effect";
import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/ui";
import { Clock } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { loadProjects } from "@/features/agent/projects/api";
import type { Automation } from "@shared/agent/automation";
import {
  cacheAutomation,
  createAutomation,
  deleteAutomation,
  forgetAutomation,
  listAutomationModels,
  refreshAutomations,
  runAutomation,
  updateAutomation,
  useAutomations,
  type AutomationModel,
} from "./automation-api";
import { AutomationEditor } from "./automation-editor";
import { AutomationList } from "./automation-list";
import {
  NEW_AUTOMATION_DRAFT,
  draftFromSuggestion,
  unreadAutomations,
  type AutomationDraft,
  type AutomationFilter,
  type AutomationSuggestion,
} from "./automation-model";

type EditorAction = "save" | "run" | "status" | "delete" | null;

export default function AutomationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("automation");
  const creating = searchParams.get("new") === "1";
  const threadId = searchParams.get("thread");
  const projectId = searchParams.get("project");
  const { automations, loading, error: loadError } = useAutomations();
  const [models, setModels] = useState<AutomationModel[]>([]);
  const [threadCwd, setThreadCwd] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AutomationFilter>("all");
  const [action, setAction] = useState<EditorAction>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<AutomationSuggestion | null>(null);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => automations.find((automation) => automation.id === requestedId) ?? null,
    [automations, requestedId],
  );

  useMountSubscription(() => {
    void Effect.runPromise(listAutomationModels())
      .then(setModels)
      .catch((modelError) => {
        setError(modelError instanceof Error ? modelError.message : "Could not load models");
      });
  }, []);

  useMountSubscription(() => {
    if (!projectId) return;
    void loadProjects()
      .then((projects) =>
        setThreadCwd(projects.find((entry) => entry.id === projectId)?.path ?? ""),
      )
      .catch(() => undefined);
  }, [projectId]);

  useMountSubscription(() => {
    if (!selected?.unread) return;
    void Effect.runPromise(updateAutomation(selected.id, { unread: false }))
      .then(cacheAutomation)
      .catch(() => undefined);
  }, [selected?.id, selected?.unread]);

  const seed = useMemo<AutomationDraft | null>(() => {
    if (!creating) return null;
    const base = suggestion
      ? draftFromSuggestion(NEW_AUTOMATION_DRAFT, suggestion)
      : NEW_AUTOMATION_DRAFT;
    if (!threadId) return base;
    return {
      ...base,
      cwd: threadCwd || base.cwd,
      target: { kind: "thread", threadId, piSessionId: threadId },
    };
  }, [creating, suggestion, threadCwd, threadId]);

  const navigate = useCallback(
    (target: "index" | "new" | Automation) => {
      if (target === "index") {
        router.push("/agent/automations");
        return;
      }
      if (target === "new") {
        router.push("/agent/automations?new=1");
        return;
      }
      router.push(`/agent/automations?automation=${encodeURIComponent(target.id)}`);
    },
    [router],
  );

  const perform = useCallback(
    async <A,>(
      nextAction: Exclude<EditorAction, null>,
      effect: Effect.Effect<A, Error>,
      id?: string,
    ) => {
      setAction(nextAction);
      setPendingId(id ?? null);
      setError("");
      try {
        return await Effect.runPromise(effect);
      } catch (actionError) {
        setError(
          actionError instanceof Error ? actionError.message : "Scheduled task action failed",
        );
        return null;
      } finally {
        setAction(null);
        setPendingId(null);
      }
    },
    [],
  );

  const save = useCallback(
    async (draft: AutomationDraft) => {
      const result = creating
        ? await perform("save", createAutomation(draft))
        : selected
          ? await perform("save", updateAutomation(selected.id, draft), selected.id)
          : null;
      if (!result) return;
      cacheAutomation(result);
      navigate(result);
    },
    [creating, navigate, perform, selected],
  );

  const run = useCallback(
    async (automation: Automation) => {
      const started = await perform("run", runAutomation(automation.id), automation.id);
      if (started) window.setTimeout(() => void refreshAutomations(), 1_000);
    },
    [perform],
  );

  const toggleStatus = useCallback(
    async (automation: Automation) => {
      const updated = await perform(
        "status",
        updateAutomation(automation.id, {
          status: automation.status === "paused" ? "active" : "paused",
        }),
        automation.id,
      );
      if (updated) cacheAutomation(updated);
    },
    [perform],
  );

  const remove = useCallback(
    async (automation: Automation) => {
      const removed = await perform("delete", deleteAutomation(automation.id), automation.id);
      if (!removed) return;
      forgetAutomation(automation.id);
      if (automation.id === requestedId) navigate("index");
    },
    [navigate, perform, requestedId],
  );

  const markAllRead = useCallback(async () => {
    const unread = unreadAutomations(automations);
    if (unread.length === 0) return;
    await Promise.all(
      unread.map((automation) =>
        Effect.runPromise(updateAutomation(automation.id, { unread: false }))
          .then(cacheAutomation)
          .catch(() => undefined),
      ),
    );
  }, [automations]);

  const useSuggestion = useCallback(
    (picked: AutomationSuggestion) => {
      setSuggestion(picked);
      navigate("new");
    },
    [navigate],
  );

  const editorOpen = creating || requestedId !== null;
  const missing = !creating && requestedId !== null && !loading && selected === null;

  return (
    <div className="flex h-[var(--app-height)] min-h-0 w-full bg-(--ui-bg) text-(--ui-fg)">
      <div
        className={
          editorOpen
            ? "hidden min-h-0 shrink-0 md:flex md:w-[min(380px,38%)]"
            : "flex min-h-0 w-full shrink-0 md:w-[min(380px,38%)]"
        }
      >
        <AutomationList
          automations={automations}
          loading={loading}
          query={query}
          filter={filter}
          selectedId={selected?.id ?? null}
          runningId={action === "run" ? pendingId : null}
          pendingId={pendingId}
          onQueryChange={setQuery}
          onFilterChange={setFilter}
          onCreate={() => navigate("new")}
          onSelect={navigate}
          onRun={(automation) => void run(automation)}
          onToggleStatus={(automation) => void toggleStatus(automation)}
          onDelete={(automation) => void remove(automation)}
          onMarkAllRead={() => void markAllRead()}
          onUseSuggestion={useSuggestion}
        />
      </div>
      {editorOpen ? (
        missing ? (
          <MissingAutomation onClose={() => navigate("index")} />
        ) : (
          <AutomationEditor
            key={creating ? (suggestion?.id ?? threadId ?? "new") : selected?.id}
            automation={selected}
            creating={creating}
            seed={seed}
            models={models}
            action={action}
            error={error || loadError}
            onClose={() => navigate("index")}
            onSave={(draft) => void save(draft)}
            onRun={() => selected && void run(selected)}
            onToggleStatus={() => selected && void toggleStatus(selected)}
            onDelete={() => selected && void remove(selected)}
          />
        )
      ) : (
        <AutomationWelcome onCreate={() => navigate("new")} />
      )}
    </div>
  );
}

function AutomationWelcome({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="hidden min-h-0 flex-1 items-center justify-center px-8 md:flex">
      <div className="max-w-sm text-left">
        <span className="flex h-9 w-9 items-center justify-center rounded-[var(--ui-radius)] border border-(--ui-separator) bg-(--ui-surface) text-(--ui-muted)">
          <Clock className="h-4 w-4" />
        </span>
        <h2 className="mt-4 text-[length:var(--fs-lg)] font-medium">
          Select a scheduled task to view
        </h2>
        <p className="mt-1.5 text-[length:var(--fs-sm)] leading-5 text-(--ui-muted)">
          Review its task and schedule, run it now, pause it, or change how it runs.
        </p>
        <Button size="sm" onClick={onCreate} className="mt-4">
          New scheduled task
        </Button>
      </div>
    </section>
  );
}

function MissingAutomation({ onClose }: { onClose: () => void }) {
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center px-8 text-center">
      <div className="max-w-sm">
        <h2 className="text-[length:var(--fs-lg)] font-medium">Scheduled task unavailable</h2>
        <p className="mt-2 text-[length:var(--fs-sm)] leading-5 text-(--ui-muted)">
          This scheduled task may have been deleted or is no longer available on this device.
        </p>
        <Button variant="secondary" size="sm" onClick={onClose} className="mt-4">
          Back to scheduled tasks
        </Button>
      </div>
    </section>
  );
}
