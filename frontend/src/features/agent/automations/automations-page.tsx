"use client";

import { Effect } from "effect";
import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/ui";
import { Clock, Plus } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { Automation } from "@shared/agent/automation";
import {
  createAutomation,
  deleteAutomation,
  listAutomationModels,
  listAutomations,
  runAutomation,
  updateAutomation,
  type AutomationModel,
} from "./automation-api";
import { AutomationEditor } from "./automation-editor";
import { AutomationList } from "./automation-list";
import {
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
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  const [models, setModels] = useState<AutomationModel[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AutomationFilter>("all");
  const [action, setAction] = useState<EditorAction>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<AutomationSuggestion | null>(null);
  const [error, setError] = useState("");

  const selected = useMemo(
    () => automations?.find((automation) => automation.id === requestedId) ?? null,
    [automations, requestedId],
  );

  const reload = useCallback(async () => {
    try {
      setAutomations(await Effect.runPromise(listAutomations()));
    } catch (loadError) {
      setAutomations([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load automations");
    }
  }, []);

  useMountSubscription(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), 30_000);
    return () => window.clearInterval(timer);
  }, [reload]);

  useMountSubscription(() => {
    void Effect.runPromise(listAutomationModels())
      .then(setModels)
      .catch((modelError) => {
        setError(modelError instanceof Error ? modelError.message : "Could not load models");
      });
  }, []);

  useMountSubscription(() => {
    if (!selected?.unread) return;
    void Effect.runPromise(updateAutomation(selected.id, { unread: false }))
      .then((updated) => {
        setAutomations(
          (current) =>
            current?.map((automation) => (automation.id === updated.id ? updated : automation)) ??
            [],
        );
      })
      .catch(() => undefined);
  }, [selected?.id, selected?.unread]);

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
        setError(actionError instanceof Error ? actionError.message : "Automation action failed");
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
          ? await perform("save", updateAutomation(selected.id, draft))
          : null;
      if (!result) return;
      setAutomations((current) => {
        const existing = current ?? [];
        const found = existing.some((automation) => automation.id === result.id);
        return found
          ? existing.map((automation) => (automation.id === result.id ? result : automation))
          : [...existing, result].sort((a, b) => a.name.localeCompare(b.name));
      });
      navigate(result);
    },
    [creating, navigate, perform, selected],
  );

  const run = useCallback(
    async (automation: Automation) => {
      const started = await perform("run", runAutomation(automation.id), automation.id);
      if (started) window.setTimeout(() => void reload(), 1_000);
    },
    [perform, reload],
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
      if (!updated) return;
      setAutomations(
        (current) => current?.map((entry) => (entry.id === updated.id ? updated : entry)) ?? [],
      );
    },
    [perform],
  );

  const remove = useCallback(
    async (automation: Automation) => {
      const removed = await perform("delete", deleteAutomation(automation.id), automation.id);
      if (!removed) return;
      setAutomations((current) => current?.filter((entry) => entry.id !== automation.id) ?? []);
      if (automation.id === requestedId) navigate("index");
    },
    [navigate, perform, requestedId],
  );

  const markAllRead = useCallback(async () => {
    const unread = unreadAutomations(automations ?? []);
    if (unread.length === 0) return;
    await Promise.all(
      unread.map((automation) =>
        Effect.runPromise(updateAutomation(automation.id, { unread: false })).catch(() => null),
      ),
    );
    void reload();
  }, [automations, reload]);

  const useSuggestion = useCallback(
    (picked: AutomationSuggestion) => {
      setSuggestion(picked);
      navigate("new");
    },
    [navigate],
  );

  const editorOpen = creating || requestedId !== null;
  const missing = !creating && requestedId !== null && automations !== null && selected === null;

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
          automations={automations ?? []}
          loading={automations === null}
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
            key={creating ? (suggestion?.id ?? "new") : selected?.id}
            automation={selected}
            creating={creating}
            models={models}
            action={action}
            error={error}
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
        <h2 className="mt-4 text-[length:var(--fs-lg)] font-medium">Select an automation</h2>
        <p className="mt-1.5 text-[length:var(--fs-sm)] leading-5 text-(--ui-muted)">
          Review its task and schedule, run it now, pause it, or change its configuration.
        </p>
        <Button
          size="sm"
          onClick={onCreate}
          icon={<Plus className="h-3.5 w-3.5" />}
          className="mt-4"
        >
          New automation
        </Button>
      </div>
    </section>
  );
}

function MissingAutomation({ onClose }: { onClose: () => void }) {
  return (
    <section className="flex min-h-0 flex-1 items-center justify-center px-8 text-center">
      <div className="max-w-sm">
        <h2 className="text-[length:var(--fs-lg)] font-medium">Scheduled task not found</h2>
        <p className="mt-2 text-[length:var(--fs-sm)] text-(--ui-muted)">
          It may have been deleted or is no longer available on this device.
        </p>
        <Button variant="secondary" size="sm" onClick={onClose} className="mt-4">
          Back to automations
        </Button>
      </div>
    </section>
  );
}
