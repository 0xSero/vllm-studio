"use client";

import { useCallback, useMemo, useState } from "react";
import { Schema } from "effect";
import type { WorkerStatus } from "@local-studio/contracts/federation";
import { Select, StatusPill } from "@/ui";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import api from "@/lib/api/client";
import type { ApiClient } from "@/lib/api/create-api-client";
import {
  createHeadApiClient,
  createHeadWorkerApiClient,
  getHeadConnection,
  HEAD_CONNECTION_CHANGED_EVENT,
} from "@/lib/api/head-controller";

const MODEL_MACHINE_STORAGE_KEY = "local-studio:model-machine";
const MODEL_MACHINE_CHANGED_EVENT = "local-studio:model-machine-changed";

const ModelMachineSelectionSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("local") }),
  Schema.Struct({ kind: Schema.Literal("worker"), worker_id: Schema.String }),
]);

export type ModelMachineSelection = typeof ModelMachineSelectionSchema.Type;

export interface ModelMachine {
  key: string;
  name: string;
  detail: string;
  healthy: boolean;
  selection: ModelMachineSelection;
}

const selectionKey = (selection: ModelMachineSelection): string =>
  selection.kind === "local" ? "local" : `worker:${selection.worker_id}`;

const readSelection = (): ModelMachineSelection | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(MODEL_MACHINE_STORAGE_KEY);
    return raw ? Schema.decodeUnknownSync(ModelMachineSelectionSchema)(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
};

const writeSelection = (selection: ModelMachineSelection | null): void => {
  if (typeof window === "undefined") return;
  if (selection) window.localStorage.setItem(MODEL_MACHINE_STORAGE_KEY, JSON.stringify(selection));
  else window.localStorage.removeItem(MODEL_MACHINE_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(MODEL_MACHINE_CHANGED_EVENT, { detail: selection }));
};

const acceleratorSummary = (
  node: {
    readonly cpu_model: string | null;
    readonly accelerators: readonly {
      readonly name: string;
      readonly memory_gb: number | null;
    }[];
  } | null,
): string => {
  if (!node) return "local controller";
  const accelerators = node.accelerators
    .map((accelerator) => {
      const memory = accelerator.memory_gb ? ` · ${accelerator.memory_gb} GB` : "";
      return `${accelerator.name}${memory}`;
    })
    .join(", ");
  return accelerators || node.cpu_model || "local controller";
};

const workerSummary = (worker: WorkerStatus): string =>
  worker.hardware ? acceleratorSummary(worker.hardware) : worker.address;

export function useModelMachines() {
  const [machines, setMachines] = useState<readonly ModelMachine[]>([]);
  const [selection, setSelectionState] = useState<ModelMachineSelection | null>(readSelection);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const connection = getHeadConnection();
    const [localResult, workersResult] = await Promise.allSettled([
      api.getRigs(),
      connection ? createHeadApiClient(connection).getWorkers() : Promise.resolve(null),
    ]);

    const next: ModelMachine[] = [];
    if (localResult.status === "fulfilled") {
      const node = localResult.value.rigs
        .flatMap((rig) => rig.nodes)
        .find((candidate) => candidate.id === localResult.value.local_node_id);
      if (node) {
        next.push({
          key: "local",
          name: `${node.name} (this Mac)`,
          detail: acceleratorSummary(node),
          healthy: true,
          selection: { kind: "local" },
        });
      }
    }

    if (workersResult.status === "fulfilled" && workersResult.value?.mode === "head") {
      for (const worker of workersResult.value.workers) {
        next.push({
          key: `worker:${worker.id}`,
          name: worker.name,
          detail: workerSummary(worker),
          healthy: worker.healthy,
          selection: { kind: "worker", worker_id: worker.id },
        });
      }
    }

    const current = readSelection();
    const selected = current ? next.find((machine) => machine.key === selectionKey(current)) : null;
    if (!selected && next.length === 1) {
      writeSelection(next[0]?.selection ?? null);
      setSelectionState(next[0]?.selection ?? null);
    } else if (!selected && current) {
      writeSelection(null);
      setSelectionState(null);
    }

    setMachines(next);
    const failures = [localResult, workersResult]
      .filter((result) => result.status === "rejected")
      .map((result) =>
        result.status === "rejected" && result.reason instanceof Error
          ? result.reason.message
          : "A controller did not respond",
      );
    setError(failures[0] ?? null);
    setLoading(false);
  }, []);

  useMountSubscription(() => {
    void reload();
  }, [reload]);

  useMountSubscription(() => {
    const syncSelection = () => setSelectionState(readSelection());
    const syncHead = () => void reload();
    window.addEventListener(MODEL_MACHINE_CHANGED_EVENT, syncSelection);
    window.addEventListener(HEAD_CONNECTION_CHANGED_EVENT, syncHead);
    return () => {
      window.removeEventListener(MODEL_MACHINE_CHANGED_EVENT, syncSelection);
      window.removeEventListener(HEAD_CONNECTION_CHANGED_EVENT, syncHead);
    };
  }, [reload]);

  const selectMachine = useCallback(
    (key: string) => {
      const next = machines.find((machine) => machine.key === key)?.selection ?? null;
      writeSelection(next);
      setSelectionState(next);
    },
    [machines],
  );

  const selectedMachine = selection
    ? (machines.find((machine) => machine.key === selectionKey(selection)) ?? null)
    : null;

  const client = useMemo<ApiClient | null>(() => {
    if (!selectedMachine) return null;
    return selectedMachine.selection.kind === "local"
      ? api
      : createHeadWorkerApiClient(selectedMachine.selection.worker_id);
  }, [selectedMachine]);

  return { machines, selectedMachine, client, loading, error, reload, selectMachine };
}

export function ModelMachineSelect({
  machines,
  selectedMachine,
  onSelect,
}: {
  machines: readonly ModelMachine[];
  selectedMachine: ModelMachine | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[length:var(--fs-sm)] text-(--ui-muted)">Run models on</span>
      {selectedMachine ? (
        <StatusPill tone={selectedMachine.healthy ? "good" : "danger"}>
          {selectedMachine.healthy ? "online" : "offline"}
        </StatusPill>
      ) : null}
      <Select
        aria-label="Run models on"
        value={selectedMachine?.key ?? ""}
        onChange={(event) => onSelect(event.target.value)}
        placeholder={machines.length ? "Choose a machine" : "No machines available"}
        className="min-w-56"
        options={machines.map((machine) => ({
          value: machine.key,
          label: machine.healthy
            ? `${machine.name} — ${machine.detail}`
            : `${machine.name} — offline`,
        }))}
      />
    </div>
  );
}
