"use client";

import { RIG_HARDWARE_TYPE_LABELS, RIG_NODE_ROLE_LABELS } from "@local-studio/contracts/rigs";
import { Button, StatusPill } from "@/ui";
import { SquarePen, Trash2 } from "@/ui/icon-registry";
import type { RigNode } from "@/lib/types";
import { HardwareArt } from "./hardware-art";
import { InlineRename } from "./inline-rename";

const acceleratorSummary = (node: RigNode): string | null => {
  if (node.accelerators.length === 0) return null;
  return node.accelerators
    .map((accelerator) => {
      const memory = accelerator.memory_gb ? ` · ${accelerator.memory_gb} GB` : "";
      const prefix = accelerator.count > 1 ? `${accelerator.count}x ` : "";
      return `${prefix}${accelerator.name}${memory}`;
    })
    .join(", ");
};

export function RigNodeCard({
  node,
  isLocal,
  onRename,
  onEdit,
  onDelete,
}: {
  node: RigNode;
  isLocal: boolean;
  onRename: (name: string) => Promise<void>;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const accelerators = acceleratorSummary(node);
  const facts = [
    node.address ?? node.hostname,
    node.memory_gb ? `${node.memory_gb} GB RAM` : null,
    node.cpu_model,
  ].filter(Boolean);

  return (
    <div className="flex gap-3 rounded-xl border border-(--ui-border) bg-(--ui-surface) p-3">
      <div className="flex w-28 shrink-0 items-center justify-center rounded-lg bg-(--ui-bg) py-1">
        <HardwareArt type={node.hardware_type} className="h-16 w-full opacity-80" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <InlineRename
            value={node.name}
            label={`device ${node.name}`}
            onRename={onRename}
            textClassName="text-[length:var(--fs-lg)] font-medium text-(--ui-fg)"
          />
          <StatusPill tone={node.role === "head" ? "info" : "default"}>
            {RIG_NODE_ROLE_LABELS[node.role]}
          </StatusPill>
          {isLocal ? <StatusPill tone="good">This machine</StatusPill> : null}
        </div>
        <p className="mt-0.5 truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
          {RIG_HARDWARE_TYPE_LABELS[node.hardware_type]}
          {facts.length ? ` · ${facts.join(" · ")}` : ""}
        </p>
        {accelerators ? (
          <p className="mt-1 truncate text-[length:var(--fs-sm)] text-(--ui-fg)/80">
            {accelerators}
          </p>
        ) : null}
        {node.notes ? (
          <p className="mt-1 line-clamp-2 text-[length:var(--fs-xs)] text-(--ui-muted)">
            {node.notes}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Button
          variant="icon"
          size="sm"
          onClick={onEdit}
          title="Edit device"
          icon={<SquarePen className="h-3.5 w-3.5" />}
        />
        {onDelete ? (
          <Button
            variant="icon"
            size="sm"
            onClick={onDelete}
            title="Remove device"
            icon={<Trash2 className="h-3.5 w-3.5" />}
          />
        ) : null}
      </div>
    </div>
  );
}
