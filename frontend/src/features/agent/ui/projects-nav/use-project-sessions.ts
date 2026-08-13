"use client";

import { useCallback, useRef, useState } from "react";
import { Schema } from "effect";
import { ThreadSummarySchema, type ThreadSummary } from "@shared/agent/thread";
import { safeJson } from "@/features/agent/safe-json";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { useProjectSessionsReloadEffect } from "./use-projects-nav-effects";

const ProjectSessionsResponseSchema = Schema.Struct({
  sessions: Schema.Array(ThreadSummarySchema),
});
const decodeProjectSessionsResponse = Schema.decodeUnknownOption(ProjectSessionsResponseSchema);

export function useProjectSessions(
  projectPath: string,
  limit: number,
): {
  sessions: ThreadSummary[] | null;
  loading: boolean;
  unavailable: boolean;
} {
  const [sessions, setSessions] = useState<ThreadSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [sessionsProjectPath, setSessionsProjectPath] = useState(projectPath);
  const requestSequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    const request = ++requestSequence.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setLoading(true);
    setUnavailable(false);
    try {
      const response = await fetch(
        `/api/agent/sessions?cwd=${encodeURIComponent(projectPath)}&since=7d&limit=${limit}`,
        { cache: "no-store", signal: nextController.signal },
      );
      if (!response.ok) {
        if (request === requestSequence.current) setUnavailable(true);
        return;
      }
      const decoded = decodeProjectSessionsResponse(await safeJson<unknown>(response));
      if (request !== requestSequence.current) return;
      if (decoded._tag !== "Some") return setUnavailable(true);
      setSessions([...decoded.value.sessions]);
    } catch {
      if (request === requestSequence.current) setUnavailable(true);
    } finally {
      if (request === requestSequence.current) {
        controller.current = null;
        setLoading(false);
      }
    }
  }, [projectPath, limit]);

  useMountSubscription(() => {
    setSessionsProjectPath(projectPath);
    setSessions(null);
    setLoading(true);
    setUnavailable(false);
    return () => {
      requestSequence.current += 1;
      controller.current?.abort();
      controller.current = null;
    };
  }, [projectPath]);
  useProjectSessionsReloadEffect(reload);

  if (sessionsProjectPath !== projectPath) {
    return { sessions: null, loading: true, unavailable: false };
  }
  return { sessions, loading, unavailable };
}
