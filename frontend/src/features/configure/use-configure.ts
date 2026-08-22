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
import {
  clearHeadConnection,
  createHeadApiClient,
  getHeadConnection,
  HEAD_CONNECTION_CHANGED_EVENT,
  type HeadConnection,
} from "@/lib/api/head-controller";

const RIGS_CACHE_KEY = "configure:rigs";
const HEAD_SCOPE_PREFIX = "head:";

const headScopeId = (id: string): string => `${HEAD_SCOPE_PREFIX}${id}`;
const controllerId = (id: string): string =>
  id.startsWith(HEAD_SCOPE_PREFIX) ? id.slice(HEAD_SCOPE_PREFIX.length) : id;
const isHeadScope = (id: string): boolean => id.startsWith(HEAD_SCOPE_PREFIX);

const scopeHeadRigs = (payload: RigsPayload): Rig[] =>
  payload.rigs.map((rig) => ({
    ...rig,
    id: headScopeId(rig.id),
    nodes: rig.nodes.map((node) => ({ ...node, id: headScopeId(node.id) })),
  }));

const disconnectedHeadRig = (connection: HeadConnection): Rig => {
  const now = new Date().toISOString();
  return {
    id: headScopeId("connection"),
    name: "Studio Head",
    description: null,
    nodes: [
      {
        id: headScopeId("connection"),
        name: connection.name,
        hardware_type: "custom",
        role: "head",
        source: "manual",
        hostname: null,
        address: connection.url,
        os: null,
        cpu_model: null,
        cpu_cores: null,
        memory_gb: null,
        accelerators: [],
        notes: null,
      },
    ],
    created_at: now,
    updated_at: now,
  };
};

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
  headConnection: HeadConnection | null;
  headConnected: boolean;
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
  addWorker: (payload: RigNodePayload & { name: string }) => Promise<void>;
  disconnectHead: () => void;
}

export function useConfigure(): ConfigureState {
  const [rigsPayload, setRigsPayload] = useState<RigsPayload | null>(() =>
    readPageCache<RigsPayload>(RIGS_CACHE_KEY),
  );
  const [loading, setLoading] = useState(rigsPayload === null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workers, setWorkers] = useState<readonly WorkerStatus[]>([]);
  const [headConnection, setConnectedHead] = useState<HeadConnection | null>(getHeadConnection);
  const [headConnected, setHeadConnected] = useState(false);
  const [selectedWorkerId, setWorkerId] = useState(getSelectedWorkerId);

  const reload = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const localRigs = await api.getRigs();
      const connection = getHeadConnection();
      setConnectedHead(connection);
      const headPayload = connection
        ? await Promise.all([
            createHeadApiClient(connection).getRigs(),
            createHeadApiClient(connection).getWorkers(),
          ]).catch(() => null)
        : null;
      const nextWorkers = headPayload?.[1].workers ?? [];
      const remoteRigs = headPayload
        ? scopeHeadRigs(withWorkerHardware(headPayload[0], nextWorkers))
        : connection
          ? [disconnectedHeadRig(connection)]
          : [];
      const nextRigs = { ...localRigs, rigs: [...localRigs.rigs, ...remoteRigs] };
      setHeadConnected(Boolean(headPayload));
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

  useMountSubscription(() => {
    const sync = () => {
      setConnectedHead(getHeadConnection());
      void reload();
    };
    window.addEventListener(HEAD_CONNECTION_CHANGED_EVENT, sync);
    return () => window.removeEventListener(HEAD_CONNECTION_CHANGED_EVENT, sync);
  }, [reload]);

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
      if (isHeadScope(rigId)) {
        await createHeadApiClient().deleteRig(controllerId(rigId));
        await reload();
        return;
      }
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
      if (isHeadScope(rigId)) {
        await createHeadApiClient().updateRigNode(
          controllerId(rigId),
          controllerId(nodeId),
          payload,
        );
        await reload();
        return;
      }
      const result = await api.updateRigNode(rigId, nodeId, payload);
      applyRig(result.rig);
    },
    [applyRig, reload],
  );

  const deleteNode = useCallback(
    async (rigId: string, nodeId: string) => {
      if (isHeadScope(rigId)) {
        await createHeadApiClient().deleteRigNode(controllerId(rigId), controllerId(nodeId));
        await reload();
        return;
      }
      const result = await api.deleteRigNode(rigId, nodeId);
      applyRig(result.rig);
    },
    [applyRig, reload],
  );

  const addWorker = useCallback(
    async (payload: RigNodePayload & { name: string }) => {
      const head = createHeadApiClient();
      const rigs = await head.getRigs();
      const target = rigs.rigs[0] ?? (await head.createRig({ name: "Worker pool" })).rig;
      await head.addRigNode(target.id, { ...payload, role: "worker" });
      await reload();
    },
    [reload],
  );

  const disconnectHead = useCallback(() => {
    clearHeadConnection();
    setConnectedHead(null);
    setHeadConnected(false);
    setWorkers([]);
  }, []);

  return {
    rigs: rigsPayload?.rigs ?? [],
    localNodeId: rigsPayload?.local_node_id ?? "local",
    headConnection,
    headConnected,
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
    addWorker,
    disconnectHead,
  };
}
