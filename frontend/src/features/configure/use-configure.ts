"use client";

import { useCallback, useState } from "react";
import api from "@/lib/api/client";
import type { RigNodePayload } from "@/lib/api/rigs";
import { readPageCache, writePageCache } from "@/lib/page-data-cache";
import { useAsyncResource } from "@/hooks/use-async-resource";
import type { Rig, RigsPayload } from "@/lib/types";

const RIGS_CACHE_KEY = "configure:rigs";

export interface ConfigureState {
  rigs: Rig[];
  localNodeId: string;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createRig: (name: string) => Promise<void>;
  renameRig: (rigId: string, name: string) => Promise<void>;
  describeRig: (rigId: string, description: string) => Promise<void>;
  deleteRig: (rigId: string) => Promise<void>;
  addNode: (rigId: string, payload: RigNodePayload & { name: string }) => Promise<void>;
  updateNode: (rigId: string, nodeId: string, payload: RigNodePayload) => Promise<void>;
  deleteNode: (rigId: string, nodeId: string) => Promise<void>;
}

export function useConfigure(): ConfigureState {
  const initial = readPageCache<RigsPayload>(RIGS_CACHE_KEY);
  const loadRigs = useCallback(() => api.getRigs(), []);
  const cacheRigs = useCallback(
    (payload: RigsPayload | null) => payload && writePageCache(RIGS_CACHE_KEY, payload),
    [],
  );
  const {
    data: rigsPayload,
    setData: setRigsPayload,
    loading: refreshing,
    error,
    refresh,
  } = useAsyncResource(loadRigs, initial, "Rig configuration unavailable", {
    onLoaded: cacheRigs,
  });
  const reload = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const applyRig = useCallback(
    (rig: Rig) => {
      setRigsPayload((current) => {
        if (!current) return current;
        const rigs = current.rigs.some((entry) => entry.id === rig.id)
          ? current.rigs.map((entry) => (entry.id === rig.id ? rig : entry))
          : [...current.rigs, rig];
        const next = { ...current, rigs };
        writePageCache(RIGS_CACHE_KEY, next);
        return next;
      });
    },
    [setRigsPayload],
  );

  const createRig = useCallback(
    async (name: string) => {
      const result = await api.createRig({ name });
      applyRig(result.rig);
    },
    [applyRig],
  );

  const renameRig = useCallback(
    async (rigId: string, name: string) => {
      const result = await api.updateRig(rigId, { name });
      applyRig(result.rig);
    },
    [applyRig],
  );

  const describeRig = useCallback(
    async (rigId: string, description: string) => {
      const result = await api.updateRig(rigId, { description: description || null });
      applyRig(result.rig);
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
    loading: rigsPayload === null && refreshing,
    refreshing,
    error,
    reload,
    createRig,
    renameRig,
    describeRig,
    deleteRig,
    addNode,
    updateNode,
    deleteNode,
  };
}
