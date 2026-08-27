"use client";

import { useMemo, useState } from "react";
import { ConfirmDeleteModal, ModelButton } from "@/ui";
import { Plus, RefreshCw } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";
import type { Rig, RigNode } from "@/lib/types";
import type { RigNodePayload } from "@/lib/api/rigs";
import { TableNotice } from "@/features/recipes/recipes-content/catalog-table-shell";
import { MachineCardSkeleton } from "./configure-skeleton";
import type { ConfigureState } from "./use-configure";
import { MachineCard, machineGpuGb } from "./machine-card";
import { NodeFormModal, nodeToForm, type NodeGroupChoice } from "./node-form-modal";
import { connectHead } from "./head-connection";

type NodeTarget =
  | { mode: "add" }
  | { mode: "edit"; rigId: string; node: RigNode }
  | { mode: "head"; node: RigNode };
type DeleteTarget = { kind: "rig"; rig: Rig } | { kind: "node"; rigId: string; node: RigNode };

/** The rig the controller seeds on first boot is not a name anyone chose. */
const rigTitle = (rig: Rig): string => (rig.name === "My Rig" ? "Your machines" : rig.name);

/**
 * Head node first, then by name — the default order is the topology, not an
 * alphabet, because "which box is in charge" is the first thing an operator
 * looks for.
 */
const compareNodes = (a: RigNode, b: RigNode) => {
  const byRole = Number(b.role === "head") - Number(a.role === "head");
  return byRole !== 0 ? byRole : a.name.localeCompare(b.name);
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const isHeadScope = (id: string): boolean => id.startsWith("head:");
const workerId = (id: string): string => (isHeadScope(id) ? id.slice("head:".length) : id);

/**
 * Everything this workspace can run a model on.
 *
 * The page opens here because this is the only question Configure exists to
 * answer: how much hardware do I have, and does the app see it correctly. The
 * pool at the top is the same number the Models page checks a model against, so
 * a machine missing from this list is a model that silently will not fit.
 */
export function MachinesSection({ state }: { state: ConfigureState }) {
  const [nodeTarget, setNodeTarget] = useState<NodeTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const groupTitle = (rig: Rig): string =>
    isHeadScope(rig.id) ? (state.headConnection?.name ?? "Studio Head") : rigTitle(rig);

  const groups = useMemo(
    () =>
      state.rigs.map((rig) => {
        const nodes = [...rig.nodes].sort(compareNodes);
        return {
          rig,
          nodes,
          gpuGb: nodes.reduce((sum, node) => sum + machineGpuGb(node), 0),
          containsLocal: nodes.some((node) => node.id === state.localNodeId),
        };
      }),
    [state.rigs, state.localNodeId],
  );

  const machines = groups.flatMap((group) => group.nodes);
  const poolGb = groups.reduce((sum, group) => sum + group.gpuGb, 0);
  const localGroups = groups.filter((group) => !isHeadScope(group.rig.id));
  const defaultRigId =
    localGroups.find((group) => group.containsLocal)?.rig.id ?? localGroups[0]?.rig.id ?? null;
  // One group is the shipped default and naming it on screen says nothing. The
  // band only appears once there is a second group to tell it apart from.
  const showGroupBands = groups.length > 1;

  const submitNode = async (
    payload: RigNodePayload & { name: string },
    group: NodeGroupChoice | null,
  ) => {
    if (!nodeTarget) return;
    if (nodeTarget.mode === "head" || payload.role === "head") {
      if (!payload.address) throw new Error("Enter the Head controller URL");
      await connectHead({
        name: payload.name,
        url: payload.address,
        apiKey: payload.api_key,
        nodeAddress: payload.hostname ?? "",
      });
      await state.reload();
      return;
    }
    if (nodeTarget.mode === "edit") {
      await state.updateNode(nodeTarget.rigId, nodeTarget.node.id, payload);
      return;
    }
    if (payload.role === "worker") {
      await state.addWorker(payload);
      return;
    }
    if (!group) throw new Error("Choose a group for this machine");
    const rigId = group.kind === "new" ? (await state.createRig(group.name)).id : group.rigId;
    await state.addNode(rigId, payload);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-(--ui-separator) pb-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[length:var(--fs-md)] tabular-nums text-(--ui-fg)">
            {poolGb > 0 ? `${poolGb} GB of GPU memory` : "No GPUs detected"}
          </span>
          <span className="truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
            {machines.length
              ? `across ${plural(machines.length, "machine")}`
              : "Add the computer whose GPUs this workspace should use."}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void state.reload()}
            disabled={state.refreshing}
            title="Re-read the hardware on this machine"
            aria-label="Rescan hardware"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg) disabled:opacity-45"
          >
            <RefreshCw className={cx("h-3.5 w-3.5", state.refreshing ? "animate-spin" : "")} />
          </button>
          <ModelButton tone="primary" onClick={() => setNodeTarget({ mode: "add" })}>
            <Plus className="h-3 w-3" />
            Add machine
          </ModelButton>
        </div>
      </div>

      {state.loading && groups.length === 0 ? (
        <MachineCardSkeleton />
      ) : machines.length === 0 ? (
        <TableNotice
          title="No machines yet"
          body="Local hardware is detected automatically — if nothing appeared, rescan. Add a machine by hand only when another computer contributes GPUs over the network."
          action={
            <ModelButton tone="primary" onClick={() => setNodeTarget({ mode: "add" })}>
              <Plus className="h-3 w-3" />
              Add machine
            </ModelButton>
          }
        />
      ) : (
        groups.map(({ rig, nodes, gpuGb, containsLocal }) => (
          <section key={rig.id} className="space-y-2">
            {showGroupBands ? (
              <div className="flex items-baseline justify-between gap-3 px-1 pt-1">
                <div className="flex min-w-0 items-baseline gap-2.5">
                  <span className="shrink-0 text-[length:var(--fs-xs)] font-medium text-(--dim)">
                    {groupTitle(rig)}
                  </span>
                  {rig.description ? (
                    <span className="truncate text-[length:var(--fs-xs)] text-(--dim)/60">
                      {rig.description}
                    </span>
                  ) : null}
                </div>
                <span className="flex shrink-0 items-center gap-2 text-[length:var(--fs-xs)] tabular-nums text-(--dim)/60">
                  <span>
                    {plural(nodes.length, "machine")}
                    {gpuGb ? ` · ${gpuGb} GB` : ""}
                  </span>
                  {!containsLocal && !isHeadScope(rig.id) ? (
                    <ModelButton
                      tone="danger"
                      onClick={() => setDeleteTarget({ kind: "rig", rig })}
                      title={`Delete the ${groupTitle(rig)} group`}
                    >
                      Delete group
                    </ModelButton>
                  ) : null}
                </span>
              </div>
            ) : null}
            {nodes.length ? (
              nodes.map((node) => (
                <MachineCard
                  key={node.id}
                  node={node}
                  isLocal={node.id === state.localNodeId}
                  worker={state.workers.find((worker) => worker.id === workerId(node.id))}
                  connectionStatus={
                    node.role === "head" && isHeadScope(node.id)
                      ? state.headConnected
                        ? "online"
                        : "offline"
                      : undefined
                  }
                  onEdit={() =>
                    setNodeTarget(
                      node.role === "head" && isHeadScope(node.id)
                        ? { mode: "head", node }
                        : { mode: "edit", rigId: rig.id, node },
                    )
                  }
                  onRemove={
                    node.role === "head" && isHeadScope(node.id)
                      ? state.disconnectHead
                      : node.id === state.localNodeId
                        ? undefined
                        : () => setDeleteTarget({ kind: "node", rigId: rig.id, node })
                  }
                />
              ))
            ) : (
              <p className="px-1 text-[length:var(--fs-xs)] text-(--dim)/60">
                Empty — no machine has been added to this group.
              </p>
            )}
          </section>
        ))
      )}

      {nodeTarget ? (
        <NodeFormModal
          title={nodeTarget.mode === "add" ? "Add machine" : `Edit ${nodeTarget.node.name}`}
          initial={nodeTarget.mode === "add" ? undefined : nodeToForm(nodeTarget.node)}
          detected={nodeTarget.mode === "edit" && nodeTarget.node.source === "detected"}
          groups={
            nodeTarget.mode !== "edit"
              ? {
                  options: localGroups.map(({ rig }) => ({ id: rig.id, label: rigTitle(rig) })),
                  defaultRigId,
                }
              : undefined
          }
          hasHead={Boolean(state.headConnection)}
          onClose={() => setNodeTarget(null)}
          onSubmit={submitNode}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDeleteModal
          title={deleteTarget.kind === "rig" ? "Delete group" : "Remove machine"}
          message={
            deleteTarget.kind === "rig"
              ? `Delete the "${groupTitle(deleteTarget.rig)}" group and the ${plural(deleteTarget.rig.nodes.length, "machine")} in it? No hardware is touched.`
              : `Remove "${deleteTarget.node.name}"? Its GPUs stop counting toward the pool.`
          }
          confirmLabel="Remove"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() =>
            deleteTarget.kind === "rig"
              ? state.deleteRig(deleteTarget.rig.id)
              : state.deleteNode(deleteTarget.rigId, deleteTarget.node.id)
          }
        />
      ) : null}
    </div>
  );
}
