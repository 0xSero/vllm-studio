"use client";

import { useCallback, useState } from "react";
import type { ControllerMode, WorkerStatus } from "@local-studio/contracts/federation";
import { Select, StatusPill } from "@/ui";
import api from "@/lib/api/client";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  getSelectedWorkerId,
  setSelectedWorkerId,
  WORKER_SELECTION_EVENT,
} from "@/lib/api/worker-selection";

export function useManagementWorkers() {
  const [mode, setMode] = useState<ControllerMode | null>(null);
  const [workers, setWorkers] = useState<readonly WorkerStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api.getWorkers();
      setMode(payload.mode);
      setWorkers(payload.workers);
      setError(null);
      return payload;
    } catch (cause) {
      const status = cause instanceof Error ? (cause as Error & { status?: number }).status : null;
      if (status === 404) {
        setMode("standalone");
        setWorkers([]);
        setError(null);
        return null;
      }
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useMountSubscription(() => {
    void reload();
  }, [reload]);

  return { mode, workers, loading, error, reload };
}

export function useSelectedWorker(workers: readonly WorkerStatus[], resolved: boolean) {
  const [selectedWorkerId, setWorkerId] = useState(getSelectedWorkerId);

  useMountSubscription(() => {
    const sync = () => setWorkerId(getSelectedWorkerId());
    window.addEventListener(WORKER_SELECTION_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WORKER_SELECTION_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useMountSubscription(() => {
    if (!resolved) return;
    const current = getSelectedWorkerId();
    if (!current || workers.some((worker) => worker.id === current)) return;
    setSelectedWorkerId("");
    setWorkerId("");
  }, [resolved, workers]);

  const selectWorker = useCallback((workerId: string) => {
    setSelectedWorkerId(workerId);
    setWorkerId(workerId);
  }, []);

  return {
    selectedWorkerId,
    selectedWorker: workers.find((worker) => worker.id === selectedWorkerId) ?? null,
    selectWorker,
  };
}

export function ManagementWorkerSelect({
  workers,
  selectedWorkerId,
  onSelect,
}: {
  workers: readonly WorkerStatus[];
  selectedWorkerId: string;
  onSelect: (workerId: string) => void;
}) {
  const selectedWorker = workers.find((worker) => worker.id === selectedWorkerId);
  return (
    <div className="flex items-center gap-2">
      {selectedWorker ? (
        <StatusPill tone={selectedWorker.healthy ? "good" : "danger"}>
          {selectedWorker.healthy ? "online" : "offline"}
        </StatusPill>
      ) : null}
      <Select
        aria-label="Management Worker"
        value={selectedWorkerId}
        onChange={(event) => onSelect(event.target.value)}
        placeholder={workers.length ? "Select Worker" : "No Workers connected"}
        className="min-w-44"
        options={workers.map((worker) => ({
          value: worker.id,
          label: worker.healthy ? worker.name : `${worker.name} (offline)`,
        }))}
      />
    </div>
  );
}
