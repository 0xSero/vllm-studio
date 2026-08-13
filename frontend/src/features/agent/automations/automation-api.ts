import { Effect, Schema } from "effect";
import { useCallback, useState, useSyncExternalStore } from "react";
import {
  AutomationResponseSchema,
  AutomationsResponseSchema,
  type Automation,
} from "@shared/agent/automation";
import type { AutomationDraft } from "./automation-model";

const AgentModelSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  active: Schema.optional(Schema.Boolean),
});

const AgentModelsResponseSchema = Schema.Struct({
  models: Schema.Array(AgentModelSchema),
});

const RunResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  started: Schema.Boolean,
});

const DeleteResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
});

export type AutomationModel = typeof AgentModelSchema.Type;

async function errorMessage(response: Response): Promise<string> {
  const fallback = `Request failed with HTTP ${response.status}`;
  try {
    const body = (await response.json()) as unknown;
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function requestJson<A>(
  input: string,
  decode: (input: unknown) => A,
  init?: RequestInit,
): Effect.Effect<A, Error> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(input, { cache: "no-store", ...init });
      if (!response.ok) throw new Error(await errorMessage(response));
      return decode(await response.json());
    },
    catch: (error) => (error instanceof Error ? error : new Error("Automation request failed")),
  });
}

export function listAutomations(): Effect.Effect<Automation[], Error> {
  return Effect.map(
    requestJson("/api/agent/automations", Schema.decodeUnknownSync(AutomationsResponseSchema)),
    ({ automations }) => [...automations],
  );
}

export function listAutomationModels(): Effect.Effect<AutomationModel[], Error> {
  return Effect.map(
    requestJson("/api/agent/models", Schema.decodeUnknownSync(AgentModelsResponseSchema)),
    ({ models }) => [...models],
  );
}

export function createAutomation(draft: AutomationDraft): Effect.Effect<Automation, Error> {
  return Effect.map(
    requestJson("/api/agent/automations", Schema.decodeUnknownSync(AutomationResponseSchema), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    }),
    ({ automation }) => automation,
  );
}

export function updateAutomation(
  id: string,
  patch: Partial<AutomationDraft> & { status?: Automation["status"]; unread?: boolean },
): Effect.Effect<Automation, Error> {
  return Effect.map(
    requestJson(
      `/api/agent/automations/${encodeURIComponent(id)}`,
      Schema.decodeUnknownSync(AutomationResponseSchema),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ),
    ({ automation }) => automation,
  );
}

export function deleteAutomation(id: string): Effect.Effect<boolean, Error> {
  return Effect.map(
    requestJson(
      `/api/agent/automations/${encodeURIComponent(id)}`,
      Schema.decodeUnknownSync(DeleteResponseSchema),
      {
        method: "DELETE",
      },
    ),
    ({ ok }) => ok,
  );
}

export function runAutomation(id: string): Effect.Effect<boolean, Error> {
  return Effect.map(
    requestJson(
      `/api/agent/automations/${encodeURIComponent(id)}/run`,
      Schema.decodeUnknownSync(RunResponseSchema),
      {
        method: "POST",
      },
    ),
    ({ started }) => started,
  );
}

export type AutomationsSnapshot = {
  automations: readonly Automation[];
  loading: boolean;
  error: string;
};

const POLL_INTERVAL_MS = 30_000;
const PENDING: AutomationsSnapshot = { automations: [], loading: true, error: "" };

let snapshot: AutomationsSnapshot = PENDING;
let poll: number | null = null;
const listeners = new Set<() => void>();

function runAt(automation: Automation): number {
  const timestamp = automation.nextRunAt ? new Date(automation.nextRunAt).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function ordered(automations: readonly Automation[]): Automation[] {
  return [...automations].sort(
    (a, b) => runAt(a) - runAt(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

function publish(next: AutomationsSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export async function refreshAutomations(): Promise<void> {
  try {
    const automations = await Effect.runPromise(listAutomations());
    publish({ automations: ordered(automations), loading: false, error: "" });
  } catch (error) {
    publish({
      automations: snapshot.automations,
      loading: false,
      error: error instanceof Error ? error.message : "Could not load scheduled tasks",
    });
  }
}

export function cacheAutomation(automation: Automation): void {
  const known = snapshot.automations.some((entry) => entry.id === automation.id);
  const automations = known
    ? snapshot.automations.map((entry) => (entry.id === automation.id ? automation : entry))
    : [...snapshot.automations, automation];
  publish({ ...snapshot, automations: ordered(automations), loading: false });
}

export function forgetAutomation(id: string): void {
  publish({
    ...snapshot,
    automations: snapshot.automations.filter((automation) => automation.id !== id),
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshAutomations();
    poll = window.setInterval(() => void refreshAutomations(), POLL_INTERVAL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && poll !== null) {
      window.clearInterval(poll);
      poll = null;
    }
  };
}

function readSnapshot(): AutomationsSnapshot {
  return snapshot;
}

function readPendingSnapshot(): AutomationsSnapshot {
  return PENDING;
}

export function useAutomations(): AutomationsSnapshot {
  return useSyncExternalStore(subscribe, readSnapshot, readPendingSnapshot);
}

export type AutomationAction = "save" | "run" | "status" | "delete" | null;

export type AutomationActions = {
  action: AutomationAction;
  pendingId: string | null;
  error: string;
  save: (draft: AutomationDraft, automation: Automation | null) => Promise<Automation | null>;
  run: (automation: Automation) => Promise<void>;
  toggleStatus: (automation: Automation) => Promise<void>;
  remove: (automation: Automation) => Promise<boolean>;
  markAllRead: (automations: readonly Automation[]) => Promise<void>;
};

export function useAutomationActions(): AutomationActions {
  const [action, setAction] = useState<AutomationAction>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const perform = useCallback(
    async <A>(
      nextAction: Exclude<AutomationAction, null>,
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
    async (draft: AutomationDraft, automation: Automation | null) => {
      const result = automation
        ? await perform("save", updateAutomation(automation.id, draft), automation.id)
        : await perform("save", createAutomation(draft));
      if (result) cacheAutomation(result);
      return result;
    },
    [perform],
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
      if (removed) forgetAutomation(automation.id);
      return Boolean(removed);
    },
    [perform],
  );

  const markAllRead = useCallback(async (automations: readonly Automation[]) => {
    const unread = automations.filter((automation) => automation.unread);
    if (unread.length === 0) return;
    await Promise.all(
      unread.map((automation) =>
        Effect.runPromise(updateAutomation(automation.id, { unread: false }))
          .then(cacheAutomation)
          .catch(() => undefined),
      ),
    );
  }, []);

  return { action, pendingId, error, save, run, toggleStatus, remove, markAllRead };
}
