"use client";

import { RIG_HARDWARE_TYPE_LABELS, RIG_NODE_ROLE_LABELS } from "@local-studio/contracts/rigs";
import type { RigAccelerator, RigNode } from "@/lib/types";
import {
  BarCell,
  DataRow,
  EndCell,
  LeadCell,
  NumCell,
  RowAction,
  StatusText,
} from "@/features/recipes/recipes-content/catalog-table-shell";
import { HardwareArt } from "./hardware-art";

/** GPU memory a node contributes, in GB — the number machines are compared on. */
export const nodeAcceleratorGb = (node: RigNode): number =>
  node.accelerators.reduce(
    (sum, accelerator) => sum + (accelerator.memory_gb ?? 0) * accelerator.count,
    0,
  );

/**
 * The accelerator column is a count and a part number, nothing else.
 *
 * The old card joined count, name, memory, memory type and bandwidth into one
 * sentence; once each of those facts has its own right-aligned column the
 * sentence is what stops you scanning down the table.
 */
const acceleratorNames = (accelerators: readonly RigAccelerator[]): string =>
  accelerators.map((accelerator) => `${accelerator.count}× ${accelerator.name}`).join(", ");

const acceleratorDetail = (accelerators: readonly RigAccelerator[]): string => {
  const memoryTypes = [...new Set(accelerators.map((a) => a.memory_type).filter(Boolean))];
  const bandwidth = accelerators.find((a) => a.memory_bandwidth_gbs)?.memory_bandwidth_gbs;
  return [memoryTypes.join(" / "), bandwidth ? `${bandwidth} GB/s` : null]
    .filter(Boolean)
    .join(" · ");
};

export function RigNodeRow({
  node,
  isLocal,
  peakGpuGb,
  onEdit,
  onDelete,
}: {
  node: RigNode;
  isLocal: boolean;
  /** Largest GPU pool in the table, so every meter is drawn on one scale. */
  peakGpuGb: number;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const endpoint = [node.hostname, node.address].filter(
    (value, index, all) => value && all.indexOf(value) === index,
  );
  const hardware = RIG_HARDWARE_TYPE_LABELS[node.hardware_type];
  const gpuGb = nodeAcceleratorGb(node);
  const accelerators = acceleratorNames(node.accelerators);
  const cpu = node.cpu_model && node.cpu_model !== "unknown" ? node.cpu_model : null;

  return (
    <DataRow onOpen={onEdit} ariaLabel={`Edit ${node.name}`}>
      <LeadCell>
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-md border border-(--border) bg-(--surface-3)">
            <HardwareArt type={node.hardware_type} className="h-4 w-full opacity-90" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[length:var(--fs-md)] font-medium text-(--fg)">
              {node.name}
            </span>
            <span className="block truncate text-[length:var(--fs-xs)] text-(--dim)/70">
              {endpoint.length ? `${hardware} · ${endpoint.join(" · ")}` : hardware}
            </span>
          </span>
        </div>
      </LeadCell>

      <NumCell sub={isLocal ? "this machine" : null}>{RIG_NODE_ROLE_LABELS[node.role]}</NumCell>

      <NumCell sub={acceleratorDetail(node.accelerators) || null} title={accelerators || undefined}>
        {accelerators || "—"}
      </NumCell>

      {gpuGb > 0 ? (
        <BarCell share={peakGpuGb > 0 ? gpuGb / peakGpuGb : 0} title="GPU memory this machine adds">
          {`${gpuGb} GB`}
        </BarCell>
      ) : (
        <NumCell>—</NumCell>
      )}

      <NumCell sub={cpu ?? (node.cpu_cores ? `${node.cpu_cores} cores` : null)}>
        {node.memory_gb ? `${node.memory_gb} GB` : "—"}
      </NumCell>

      <EndCell>
        <div className="flex items-center justify-end gap-2">
          <StatusText tone={node.source === "detected" ? "ok" : "dim"}>{node.source}</StatusText>
          <RowAction onClick={onEdit} title={`Edit ${node.name}`}>
            Edit
          </RowAction>
          {onDelete ? (
            <RowAction alwaysVisible onClick={onDelete} tone="danger" title={`Remove ${node.name}`}>
              Remove
            </RowAction>
          ) : null}
        </div>
      </EndCell>
    </DataRow>
  );
}
