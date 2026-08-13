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
  listAutomationModels,
  updateAutomation,
  useAutomationActions,
  useAutomations,
  type AutomationModel,
} from "./automation-api";
import { AutomationEditor } from "./automation-editor";
import { AutomationList } from "./automation-list";
import {
  NEW_AUTOMATION_DRAFT,
  draftFromSuggestion,
  type AutomationDraft,
  type AutomationFilter,
  type AutomationSuggestion,
} from "./automation-model";

export default function AutomationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("automation");
  const creating = searchParams.get("new") === "1";
  const threadId = searchParams.get("thread");
  const projectId = searchParams.get("project");
  const { automations, loading, error: loadError } = useAutomations();
  const { action, pendingId, error, save, run, toggleStatus, remove, markAllRead } =
    useAutomationActions();
  const [models, setModels] = useState<AutomationModel[]>([]);
  const [modelError, setModelError] = useState("");
  const [threadCwd, setThreadCwd] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AutomationFilter>("all");
  const [suggestion, setSuggestion] = useState<AutomationSuggestion | null>(null);

  const selected = useMemo(
    () => automations.find((automation) => automation.id === requestedId) ?? null,
    [automations, requestedId],
  );

  useMountSubscription(() => {
    void Effect.runPromise(listAutomationModels())
      .then(setModels)
      .catch((failure) => {
        setModelError(failure instanceof Error ? failure.message : "Could not load models");
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

  const saveDraft = useCallback(
    async (draft: AutomationDraft) => {
      const result = await save(draft, creating ? null : selected);
      if (result) navigate(result);
    },
    [creating, navigate, save, selected],
  );

  const removeAutomation = useCallback(
    async (automation: Automation) => {
      const removed = await remove(automation);
      if (removed && automation.id === requestedId) navigate("index");
    },
    [navigate, remove, requestedId],
  );

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
          onDelete={(automation) => void removeAutomation(automation)}
          onMarkAllRead={() => void markAllRead(automations)}
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
            error={error || modelError || loadError}
            onClose={() => navigate("index")}
            onSave={(draft) => void saveDraft(draft)}
            onRun={() => selected && void run(selected)}
            onToggleStatus={() => selected && void toggleStatus(selected)}
            onDelete={() => selected && void removeAutomation(selected)}
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
