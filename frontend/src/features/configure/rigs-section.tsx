"use client";

import { useState } from "react";
import { Button, EmptySafeNotice, UiModal, UiModalHeader } from "@/ui";
import { Plus } from "@/ui/icon-registry";
import type { Rig, RigNode } from "@/lib/types";
import type { RigNodePayload } from "@/lib/api/rigs";
import type { ConfigureState } from "./use-configure";
import { InlineRename } from "./inline-rename";
import { RigNodeCard } from "./rig-node-card";
import { NodeFormModal, nodeToForm } from "./node-form-modal";

type NodeTarget = { rigId: string; node: RigNode | null };
type DeleteTarget = { kind: "rig"; rig: Rig } | { kind: "node"; rigId: string; node: RigNode };

const rigSummary = (rig: Rig): string => {
  const deviceCount = rig.nodes.length;
  const totalMemory = rig.nodes.reduce(
    (sum, node) =>
      sum +
      node.accelerators.reduce(
        (nodeSum, accelerator) => nodeSum + (accelerator.memory_gb ?? 0) * accelerator.count,
        0,
      ),
    0,
  );
  const devices = `${deviceCount} device${deviceCount === 1 ? "" : "s"}`;
  return totalMemory > 0 ? `${devices} · ${totalMemory} GB accelerator memory` : devices;
};

function ConfirmDeleteModal({
  title,
  message,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <UiModal isOpen onClose={onCancel}>
      <UiModalHeader title={title} onClose={onCancel} />
      <div className="space-y-4 p-4">
        <p className="text-[length:var(--fs-base)] text-(--ui-muted)">{message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(onCancel);
            }}
          >
            Remove
          </Button>
        </div>
      </div>
    </UiModal>
  );
}

export function RigsSection({ state }: { state: ConfigureState }) {
  const [nodeTarget, setNodeTarget] = useState<NodeTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [creatingRig, setCreatingRig] = useState(false);

  const submitNode = async (payload: RigNodePayload & { name: string }) => {
    if (!nodeTarget) return;
    if (nodeTarget.node) {
      await state.updateNode(nodeTarget.rigId, nodeTarget.node.id, payload);
    } else {
      await state.addNode(nodeTarget.rigId, payload);
    }
  };

  return (
    <div className="space-y-5">
      {state.rigs.map((rig) => {
        const containsLocal = rig.nodes.some((node) => node.id === state.localNodeId);
        return (
          <section
            key={rig.id}
            className="rounded-xl border border-(--ui-border) bg-(--ui-surface-2)/40 p-4"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <InlineRename
                  value={rig.name}
                  label={`rig ${rig.name}`}
                  onRename={(name) => state.renameRig(rig.id, name)}
                  textClassName="text-[length:var(--fs-xl)] font-semibold text-(--ui-fg)"
                />
                <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">{rigSummary(rig)}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => setNodeTarget({ rigId: rig.id, node: null })}
                >
                  Add device
                </Button>
                {containsLocal ? null : (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setDeleteTarget({ kind: "rig", rig })}
                  >
                    Delete rig
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {rig.nodes.map((node) => (
                <RigNodeCard
                  key={node.id}
                  node={node}
                  isLocal={node.id === state.localNodeId}
                  onRename={(name) => state.updateNode(rig.id, node.id, { name })}
                  onEdit={() => setNodeTarget({ rigId: rig.id, node })}
                  onDelete={
                    node.id === state.localNodeId
                      ? undefined
                      : () => setDeleteTarget({ kind: "node", rigId: rig.id, node })
                  }
                />
              ))}
            </div>
            {rig.nodes.length === 0 ? (
              <EmptySafeNotice>
                No devices yet. Add the machines that make up this rig.
              </EmptySafeNotice>
            ) : null}
          </section>
        );
      })}

      <Button
        variant="secondary"
        icon={<Plus className="h-3.5 w-3.5" />}
        loading={creatingRig}
        onClick={() => {
          setCreatingRig(true);
          void state.createRig("New Rig").finally(() => setCreatingRig(false));
        }}
      >
        New rig
      </Button>

      {nodeTarget ? (
        <NodeFormModal
          title={nodeTarget.node ? `Edit ${nodeTarget.node.name}` : "Add device"}
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
              ? `Delete "${deleteTarget.rig.name}" and its ${deleteTarget.rig.nodes.length} device(s)? This does not touch any hardware.`
              : `Remove "${deleteTarget.node.name}" from this rig?`
          }
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
