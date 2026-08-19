"use client";

import { useMemo, useState } from "react";
import { Button, ConfirmDeleteModal, ModelButton } from "@/ui";
import { Plus, RefreshCw, Trash2 } from "@/ui/icon-registry";
import { cx } from "@/ui/utils";
import type { Rig, RigNode } from "@/lib/types";
import type { RigNodePayload } from "@/lib/api/rigs";
import {
  GroupRow,
  HeadCell,
  TableFrame,
  TableNotice,
  TableSkeleton,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import type { ConfigureState } from "./use-configure";
import { RigNodeRow, nodeAcceleratorGb } from "./rig-node-row";
import { NodeFormModal, nodeToForm } from "./node-form-modal";

type NodeTarget = { rigId: string; node: RigNode | null };
type DeleteTarget = { kind: "rig"; rig: Rig } | { kind: "node"; rigId: string; node: RigNode };
type SortKey = "machine" | "gpu" | "ram";

const MACHINE_COLUMNS = [
  "Machine",
  "Role",
  "Accelerators",
  "GPU memory",
  "RAM / CPU",
  "Status",
] as const;

const rigTitle = (rig: Rig): string => (rig.name === "My Rig" ? "Your machines" : rig.name);

const nodeRam = (node: RigNode): number => node.memory_gb ?? 0;

/**
 * Head node first, then by name — the default order is the topology, not an
 * alphabet, because "which box is in charge" is the first thing an operator
 * looks for. Sorting by a number is an explicit act.
 */
const compareNodes = (sort: { key: SortKey; desc: boolean }) => {
  const direction = sort.desc ? -1 : 1;
  return (a: RigNode, b: RigNode) => {
    if (sort.key === "gpu") return (nodeAcceleratorGb(a) - nodeAcceleratorGb(b)) * direction;
    if (sort.key === "ram") return (nodeRam(a) - nodeRam(b)) * direction;
    const byRole = Number(b.role === "head") - Number(a.role === "head");
    return byRole !== 0 ? byRole : a.name.localeCompare(b.name);
  };
};

/**
 * Machines as one table rather than one card per group.
 *
 * Every rig used to restate the same six facts in its own bordered box, which
 * made the numbers impossible to compare across groups. Here the rig is a group
 * row inside a single table: the columns are declared once, and two machines in
 * two different groups line up on the same right edge.
 */
export function RigsSection({ state }: { state: ConfigureState }) {
  const [nodeTarget, setNodeTarget] = useState<NodeTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [creatingRig, setCreatingRig] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "machine",
    desc: false,
  });

  const groups = useMemo(
    () =>
      state.rigs.map((rig) => {
        const nodes = [...rig.nodes].sort(compareNodes(sort));
        return {
          rig,
          nodes,
          totalGb: nodes.reduce((sum, node) => sum + nodeAcceleratorGb(node), 0),
          containsLocal: nodes.some((node) => node.id === state.localNodeId),
        };
      }),
    [state.rigs, state.localNodeId, sort],
  );

  const machines = groups.flatMap((group) => group.nodes);
  const peakGpuGb = machines.reduce((peak, node) => Math.max(peak, nodeAcceleratorGb(node)), 0);
  const poolGb = groups.reduce((sum, group) => sum + group.totalGb, 0);
  const detected = machines.filter((node) => node.source === "detected").length;

  const submitNode = async (payload: RigNodePayload & { name: string }) => {
    if (!nodeTarget) return;
    if (nodeTarget.node) {
      await state.updateNode(nodeTarget.rigId, nodeTarget.node.id, payload);
    } else {
      await state.addNode(nodeTarget.rigId, payload);
    }
  };

  const toggle = (key: SortKey) =>
    setSort((current) => ({ key, desc: current.key === key ? !current.desc : true }));
  const head = (key: SortKey) => ({
    active: sort.key === key,
    desc: sort.desc,
    onSort: () => toggle(key),
  });

  return (
    <div className="space-y-7">
      {/* One quiet line of context, the way the Models tabs open: the pool every
          machine below contributes to, and where those machines came from. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-(--ui-separator) pb-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[length:var(--fs-md)] text-(--ui-fg)">
            {poolGb > 0 ? `${poolGb} GB pool` : "No GPUs detected"}
          </span>
          <span className="truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
            {machines.length
              ? `${machines.length} ${machines.length === 1 ? "machine" : "machines"} across ${groups.length} ${groups.length === 1 ? "group" : "groups"} — ${detected} detected, ${machines.length - detected} added by hand`
              : "Add each computer that contributes CPU, memory, or GPUs."}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void state.reload()}
          disabled={state.refreshing}
          title="Rescan hardware"
          aria-label="Rescan hardware"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg) disabled:opacity-45"
        >
          <RefreshCw className={cx("h-3.5 w-3.5", state.refreshing ? "animate-spin" : "")} />
        </button>
      </div>

      {state.loading && groups.length === 0 ? (
        <TableSkeleton columns={MACHINE_COLUMNS} minWidthClass="min-w-[52rem]" rows={3} />
      ) : (
        <TableFrame minWidthClass="min-w-[52rem]">
          <thead>
            <tr>
              <HeadCell {...head("machine")}>Machine</HeadCell>
              <HeadCell numeric>Role</HeadCell>
              <HeadCell numeric>Accelerators</HeadCell>
              <HeadCell {...head("gpu")} numeric title="GPU memory this machine adds to the pool">
                GPU memory
              </HeadCell>
              <HeadCell {...head("ram")} numeric>
                RAM / CPU
              </HeadCell>
              <HeadCell numeric>Status</HeadCell>
            </tr>
          </thead>
          {groups.map(({ rig, nodes, totalGb, containsLocal }) => (
            <tbody key={rig.id}>
              <GroupRow
                colSpan={6}
                label={rigTitle(rig)}
                blurb={rig.description || undefined}
                right={
                  <span className="inline-flex items-center gap-2">
                    <span>
                      {nodes.length} {nodes.length === 1 ? "machine" : "machines"}
                      {totalGb ? ` · ${totalGb} GB GPU` : ""}
                    </span>
                    <ModelButton
                      onClick={() => setNodeTarget({ rigId: rig.id, node: null })}
                      tone="primary"
                    >
                      <Plus className="h-3 w-3" />
                      Add
                    </ModelButton>
                    {!containsLocal ? (
                      <ModelButton
                        onClick={() => setDeleteTarget({ kind: "rig", rig })}
                        tone="danger"
                        title={`Delete ${rigTitle(rig)}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </ModelButton>
                    ) : null}
                  </span>
                }
              />
              {nodes.length ? (
                nodes.map((node) => (
                  <RigNodeRow
                    key={node.id}
                    node={node}
                    isLocal={node.id === state.localNodeId}
                    peakGpuGb={peakGpuGb}
                    onEdit={() => setNodeTarget({ rigId: rig.id, node })}
                    onDelete={
                      node.id === state.localNodeId
                        ? undefined
                        : () => setDeleteTarget({ kind: "node", rigId: rig.id, node })
                    }
                  />
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <TableNotice
                      title="No machines yet"
                      body="Add each computer that contributes CPU, memory, or GPUs to this group."
                      action={
                        <ModelButton
                          onClick={() => setNodeTarget({ rigId: rig.id, node: null })}
                          tone="primary"
                        >
                          <Plus className="h-3 w-3" />
                          Add machine
                        </ModelButton>
                      }
                    />
                  </td>
                </tr>
              )}
            </tbody>
          ))}
        </TableFrame>
      )}

      <Button
        variant="ghost"
        icon={<Plus className="h-3.5 w-3.5" />}
        loading={creatingRig}
        onClick={() => {
          setCreatingRig(true);
          void state.createRig("New Rig").finally(() => setCreatingRig(false));
        }}
      >
        New machine group
      </Button>

      {nodeTarget ? (
        <NodeFormModal
          title={nodeTarget.node ? `Edit ${nodeTarget.node.name}` : "Add machine"}
          initial={nodeTarget.node ? nodeToForm(nodeTarget.node) : undefined}
          detected={nodeTarget.node?.source === "detected"}
          onClose={() => setNodeTarget(null)}
          onSubmit={submitNode}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDeleteModal
          title={deleteTarget.kind === "rig" ? "Delete rig" : "Remove device"}
          message={
            deleteTarget.kind === "rig"
              ? `Delete "${deleteTarget.rig.name}" and its ${deleteTarget.rig.nodes.length} device(s)? No hardware is touched.`
              : `Remove "${deleteTarget.node.name}" from this rig?`
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
