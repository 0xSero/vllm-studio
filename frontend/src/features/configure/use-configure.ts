"use client";

import { useCallback, useState } from "react";
import api from "@/lib/api/client";
import type { RigNodePayload } from "@/lib/api/rigs";
import { readPageCache, writePageCache } from "@/lib/page-data-cache";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { Rig, RigsPayload, WorkerStatus } from "@/lib/types";
import {
  getSelectedWorkerId,
  setSelectedWorkerId,
  WORKER_SELECTION_EVENT,
} from "@/lib/api/worker-selection";

const RIGS_CACHE_KEY = "configure:rigs";

const withWorkerHardware = (
  payload: RigsPayload,
  workers: readonly WorkerStatus[],
): RigsPayload => {
  const workerById = new Map(workers.map((worker) => [worker.id, worker]));
  return {
    ...payload,
    rigs: payload.rigs.map((rig) => ({
      ...rig,
      nodes: rig.nodes.map((node) => {
        const hardware = workerById.get(node.id)?.hardware;
        if (!hardware) return node;
        return {
          ...node,
          hardware_type: hardware.hardware_type,
          hostname: hardware.hostname,
          os: hardware.os,
          cpu_model: hardware.cpu_model,
          cpu_cores: hardware.cpu_cores,
          memory_gb: hardware.memory_gb,
          accelerators: [...hardware.accelerators],
        };
      }),
    })),
  };
};

export interface ConfigureState {
  rigs: Rig[];
  localNodeId: string;
  workers: readonly WorkerStatus[];
  selectedWorkerId: string;
  selectWorker: (workerId: string) => void;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createRig: (name: string) => Promise<Rig>;
  deleteRig: (rigId: string) => Promise<void>;
  addNode: (rigId: string, payload: RigNodePayload & { name: string }) => Promise<void>;
  updateNode: (rigId: string, nodeId: string, payload: RigNodePayload) => Promise<void>;
  deleteNode: (rigId: string, nodeId: string) => Promise<void>;
}

export function useConfigure(): ConfigureState {
  const [rigsPayload, setRigsPayload] = useState<RigsPayload | null>(() =>
    readPageCache<RigsPayload>(RIGS_CACHE_KEY),
  );
  const [loading, setLoading] = useState(rigsPayload === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workers, setWorkers] = useState<readonly WorkerStatus[]>([]);
  const [selectedWorkerId, setWorkerId] = useState(getSelectedWorkerId);

  const reload = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [rigs, workerPayload] = await Promise.all([
        api.getRigs(),
        api.getWorkers().catch(() => null),
      ]);
      const nextWorkers = workerPayload?.workers ?? [];
      const nextRigs = withWorkerHardware(rigs, nextWorkers);
      const selected = getSelectedWorkerId();
      if (selected && !nextWorkers.some((worker) => worker.id === selected)) {
        setSelectedWorkerId("");
        setWorkerId("");
      }
      writePageCache(RIGS_CACHE_KEY, nextRigs);
      setRigsPayload(nextRigs);
      setWorkers(nextWorkers);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useMountSubscription(() => {
    void reload();
  }, [reload]);

  useMountSubscription(() => {
    const sync = () => setWorkerId(getSelectedWorkerId());
    window.addEventListener(WORKER_SELECTION_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(WORKER_SELECTION_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const selectWorker = useCallback((workerId: string) => {
    setSelectedWorkerId(workerId);
    setWorkerId(workerId);
  }, []);

  const applyRig = useCallback((rig: Rig) => {
    setRigsPayload((current) => {
      if (!current) return current;
      const rigs = current.rigs.some((entry) => entry.id === rig.id)
        ? current.rigs.map((entry) => (entry.id === rig.id ? rig : entry))
        : [...current.rigs, rig];
      const next = { ...current, rigs };
      writePageCache(RIGS_CACHE_KEY, next);
      return next;
    });
  }, []);

  const createRig = useCallback(
    async (name: string) => {
      const result = await api.createRig({ name });
      applyRig(result.rig);
      return result.rig;
    },
    [applyRig],
  );

  const deleteRig = useCallback(
    async (rigId: string) => {
      await api.deleteRig(rigId);
      await reload();
    },
    [reload],
  );

  const addNode = useCallback(
    async (rigId: string, payload: RigNodePayload & { name: string }) => {
      const result = await api.addRigNode(rigId, payload);
      applyRig(result.rig);
    },
    [applyRig],
  );

  const updateNode = useCallback(
    async (rigId: string, nodeId: string, payload: RigNodePayload) => {
      const result = await api.updateRigNode(rigId, nodeId, payload);
      applyRig(result.rig);
    },
    [applyRig],
  );

  const deleteNode = useCallback(
    async (rigId: string, nodeId: string) => {
      const result = await api.deleteRigNode(rigId, nodeId);
      applyRig(result.rig);
    },
    [applyRig],
  );

  return {
    rigs: rigsPayload?.rigs ?? [],
    localNodeId: rigsPayload?.local_node_id ?? "local",
    workers,
    selectedWorkerId,
    selectWorker,
    loading,
    refreshing,
    error,
    reload,
    createRig,
    deleteRig,
    addNode,
    updateNode,
    deleteNode,
  };
}
