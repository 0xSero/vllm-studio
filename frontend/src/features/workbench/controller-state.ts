"use client";

import { useSyncExternalStore } from "react";
import { Effect, Schema } from "effect";
import { SESSION_PREFS_CHANGED_EVENT } from "@/lib/workspace-events";
import {
  WorkbenchEventSchema,
  WorkbenchProjectionSchema,
  type WorkbenchCommand,
  type WorkbenchProjection,
  type WorkbenchResourceKind,
} from "@local-studio/contracts/workbench";

const initialProjection: WorkbenchProjection = {
  revision: 0,
  profileId: "default",
  deviceId: "local",
  viewId: "primary",
  preferences: {
    lifecycleMode: "embedded",
    remoteCacheLimitMb: 512,
    sidebarWidth: 280,
    sidebarPinnedOpen: true,
    sidebarSectionOrder: ["projects", "chats"],
  },
  projects: [],
  tasks: [],
};

const decodeProjection = Schema.decodeUnknownSync(WorkbenchProjectionSchema);
const decodeEvent = Schema.decodeUnknownSync(WorkbenchEventSchema);
const listeners = new Set<() => void>();
let projection = initialProjection;
let source: EventSource | null = null;
let started = false;
let rendererViewId: string | null = null;

function workbenchViewId(): string {
  if (rendererViewId) return rendererViewId;
  if (typeof window === "undefined") return "primary";
  const storageKey = "local-studio.workbench.view-id";
  try {
    const stored = window.sessionStorage.getItem(storageKey)?.trim();
    if (stored) return (rendererViewId = stored);
    const created = `view-${crypto.randomUUID()}`;
    window.sessionStorage.setItem(storageKey, created);
    return (rendererViewId = created);
  } catch {
    return (rendererViewId = `view-${crypto.randomUUID()}`);
  }
}

function workbenchUrl(path: string): string {
  const params = new URLSearchParams({ viewId: workbenchViewId() });
  return `${path}?${params.toString()}`;
}

function publish(next: WorkbenchProjection): void {
  if (next.revision < projection.revision) return;
  projection = next;
  for (const listener of listeners) listener();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_PREFS_CHANGED_EVENT));
}

const loadProjection = Effect.tryPromise({
  try: async () => {
    const response = await fetch(workbenchUrl("/api/proxy/api/workbench"), { cache: "no-store" });
    if (!response.ok) throw new Error(`Workbench request failed with HTTP ${response.status}`);
    return decodeProjection(await response.json());
  },
  catch: (cause) => (cause instanceof Error ? cause : new Error("Workbench request failed")),
});

export function refreshWorkbench(): Effect.Effect<WorkbenchProjection, Error> {
  return Effect.tap(loadProjection, (next) => Effect.sync(() => publish(next)));
}

const start = Effect.sync(() => {
  if (started || typeof window === "undefined") return;
  started = true;
  void Effect.runPromise(refreshWorkbench()).catch(() => undefined);
  source = new EventSource(workbenchUrl("/api/proxy/api/workbench/events"));
  source.addEventListener("workbench", (event) => {
    if (!(event instanceof MessageEvent) || typeof event.data !== "string") return;
    try {
      publish(decodeEvent(JSON.parse(event.data)).projection);
    } catch {
      return;
    }
  });
});

export function subscribeWorkbench(listener: () => void): () => void {
  listeners.add(listener);
  Effect.runSync(start);
  return () => listeners.delete(listener);
}

export function getWorkbenchProjection(): WorkbenchProjection {
  return projection;
}

export function useWorkbenchProjection(): WorkbenchProjection {
  return useSyncExternalStore(subscribeWorkbench, getWorkbenchProjection, () => initialProjection);
}

export function useWorkbenchPreferences(): WorkbenchProjection["preferences"] {
  return useWorkbenchProjection().preferences;
}

export function dispatchWorkbenchCommand(
  command: Omit<WorkbenchCommand, "commandId" | "actorId">,
): Effect.Effect<WorkbenchProjection, Error> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(workbenchUrl("/api/proxy/api/workbench/commands"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...command,
          commandId: crypto.randomUUID(),
          actorId: workbenchViewId(),
        }),
      });
      if (!response.ok) throw new Error(`Workbench command failed with HTTP ${response.status}`);
      const next = decodeProjection(await response.json());
      publish(next);
      return next;
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error("Workbench command could not be applied"),
  });
}

export function setWorkbenchSidebar(input: {
  sidebarWidth?: number;
  sidebarPinnedOpen?: boolean;
  sidebarSectionOrder?: readonly string[];
}): void {
  void Effect.runPromise(
    dispatchWorkbenchCommand({
      kind: "set_sidebar",
      ...input,
    }),
  );
}

export function openWorkbenchResource(input: {
  kind: WorkbenchResourceKind;
  resourceId: string;
  title: string;
}): void {
  const taskId = projection.selectedTaskId;
  if (!taskId) return;
  void Effect.runPromise(
    dispatchWorkbenchCommand({
      kind: "open_tab",
      taskId,
      tabId: `${input.kind}:${taskId}:${input.resourceId}`,
      resourceKind: input.kind,
      resourceId: input.resourceId,
      title: input.title,
      closable: true,
    }),
  );
}
