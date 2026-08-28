"use client";

import { useMemo, useState } from "react";
import { DownloadCloud, ExternalLink } from "@/ui/icon-registry";
import { ModelButton, StatusPill } from "@/ui";
import { ModelLogo } from "@/ui/model-logo";
import { ResourceDrawer, ResourceDrawerSection, ResourceFact } from "@/ui/resource-drawer";
import type { RegistryRecommendations } from "@/lib/api/registry";
import type { ModelDownload } from "@/lib/types";
import { modelIdFromPath } from "@/lib/huggingface";
import { downloadProgressText } from "./downloads-tab";
import { formatGb } from "./model-fit";
import {
  DataRow,
  EndCell,
  GroupRow,
  HeadCell,
  IdentityCell,
  NumCell,
  RowAction,
  TableFrame,
  TableNotice,
} from "./catalog-table-shell";
import type { HydratedRegistryRow } from "./use-registry";

const COLUMNS = 6;

const statusPill = (status: string) =>
  status === "validated" ? (
    <StatusPill tone="good">validated</StatusPill>
  ) : (
    <StatusPill tone="info">candidate</StatusPill>
  );

const capabilitiesOf = (row: HydratedRegistryRow["row"]): string[] => {
  const capabilities: string[] = [];
  if (row.capabilities.tools) capabilities.push("tools");
  if (row.capabilities.reasoning) capabilities.push("reasoning");
  if (row.capabilities.vision) capabilities.push("vision");
  return capabilities;
};

const repositoryOf = (instance: HydratedRegistryRow["instance"]): string | null => {
  if (!instance || instance === "error") return null;
  const repository = instance["repository"];
  return typeof repository === "string" && repository.includes("/") ? repository : null;
};

const weightsOf = (
  row: HydratedRegistryRow,
): { precision?: unknown; size_gb?: unknown } | null => {
  if (row.instance && row.instance !== "error") {
    const weights = row.instance["weights"];
    if (weights && typeof weights === "object") return weights as { precision?: unknown; size_gb?: unknown };
  }
  return null;
};

const precisionOf = (row: HydratedRegistryRow): string | null => {
  const precision = weightsOf(row)?.["precision"];
  return typeof precision === "string" && precision.length > 0 ? precision : null;
};

const sizeGbOf = (row: HydratedRegistryRow): number | null => {
  const size = weightsOf(row)?.["size_gb"];
  return typeof size === "number" && size > 0 ? size : null;
};

const contextOf = (row: HydratedRegistryRow): string | null => {
  if (!row.recipe || row.recipe === "error") return null;
  const serving = row.recipe["serving"];
  const tokens =
    serving && typeof serving === "object"
      ? (serving as Record<string, unknown>)["configured_max_context_tokens"]
      : null;
  return typeof tokens === "number" && tokens > 0 ? `${Math.round(tokens / 1024)}K` : null;
};

const hardwareNameOf = (row: HydratedRegistryRow): string =>
  row.hardware && row.hardware !== "error"
    ? String(row.hardware["name"] ?? row.row.hardware_id)
    : row.row.hardware_id;

const revisionOf = (row: HydratedRegistryRow): string | null => {
  if (row.instance && row.instance !== "error") {
    const revision = row.instance["revision"];
    if (typeof revision === "string" && revision.length > 0) return revision;
  }
  return null;
};

const revisionShort = (revision: string): string =>
  revision.length > 12 ? `${revision.slice(0, 12)}…` : revision;

const downloadLabel = (
  entry: HydratedRegistryRow,
  downloadsByModel: Map<string, ModelDownload>,
  startingModelIds: Set<string>,
): string => {
  const repository = repositoryOf(entry.instance);
  if (!repository) return "No repo";
  if (startingModelIds.has(repository)) return "Working";
  const download = downloadsByModel.get(repository);
  if (download && (download.status === "downloading" || download.status === "paused")) {
    return downloadProgressText(download);
  }
  return "Download";
};

/**
 * The registry-backed Recommended table: summary rows grouped by the hardware
 * they were measured on, with exact records loaded progressively as rows need
 * them. Every row opens the full registry record for inspection.
 */
export function RegistryCatalog({
  rows,
  recommendations,
  poolGb,
  downloadsByModel,
  startingModelIds,
  onDownload,
  onUseConfig,
  onRetry,
}: {
  rows: HydratedRegistryRow[];
  recommendations: RegistryRecommendations | null;
  poolGb: number;
  downloadsByModel: Map<string, ModelDownload>;
  startingModelIds: Set<string>;
  onDownload: (repository: string) => void;
  onUseConfig: (row: HydratedRegistryRow) => void;
  onRetry: () => void;
}) {
  const [selected, setSelected] = useState<HydratedRegistryRow | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, HydratedRegistryRow[]>();
    for (const row of rows) {
      const list = map.get(row.row.hardware_id) ?? [];
      list.push(row);
      map.set(row.row.hardware_id, list);
    }
    return [...map.entries()];
  }, [rows]);

  if (rows.length === 0) {
    return (
      <TableNotice
        title="No registry configs here yet"
        body="Nothing in the model registry matches this machine yet. Show every hardware group to inspect the full registry, or search Hugging Face directly."
        action={
          <ModelButton tone="primary" onClick={onRetry}>
            Reload
          </ModelButton>
        }
      />
    );
  }

  return (
    <>
      <TableFrame minWidthClass="min-w-[52rem]">
        <thead>
          <tr>
            <HeadCell>Model</HeadCell>
            <HeadCell>Engine</HeadCell>
            <HeadCell>Precision</HeadCell>
            <HeadCell numeric>Context</HeadCell>
            <HeadCell>Status</HeadCell>
            <HeadCell>{""}</HeadCell>
          </tr>
        </thead>
        <tbody>
          {groups.map(([hardwareId, groupRows]) => {
            const first = groupRows[0];
            const hardwareRecord = recommendations?.hardware_records[hardwareId] as
              | { name?: unknown; memory?: { vram_gb?: unknown } }
              | undefined;
            const vram = hardwareRecord?.memory?.["vram_gb"];
            const matched = first?.fit.state === "match";
            const hardwareLabel =
              typeof hardwareRecord?.name === "string" ? hardwareRecord.name : hardwareId;
            return (
              <GroupRow
                key={hardwareId}
                colSpan={COLUMNS}
                label={hardwareLabel}
                blurb={
                  typeof vram === "number"
                    ? `${vram} GB${matched ? " · detected here" : ""}`
                    : matched
                      ? "detected here"
                      : undefined
                }
                right={`${groupRows.length} config${groupRows.length === 1 ? "" : "s"}`}
              />
            );
          })}
          {groups.flatMap(([hardwareId, groupRows]) =>
            groupRows.map((entry) => {
              const repository = repositoryOf(entry.instance);
              return (
                <DataRow
                  key={`${hardwareId}:${entry.row.id}`}
                  onOpen={() => setSelected(entry)}
                  ariaLabel={`Inspect ${entry.row.id}`}
                >
                  <IdentityCell
                    leading={
                      <ModelLogo
                        modelId={repository ?? entry.row.model_instance_id}
                        size="sm"
                        className="rounded-md"
                      />
                    }
                    label={
                      <span className="flex items-center gap-2">
                        {repository?.split("/")[1] ?? entry.row.model_instance_id}
                        {entry.row.has_evidence ? (
                          <span
                            title="Measured speed evidence attached"
                            className="text-[length:var(--fs-xs)] text-(--ok)"
                          >
                            ·measured
                          </span>
                        ) : null}
                      </span>
                    }
                    description={repository ?? "exact record loading…"}
                  />
                  <td className="px-3 py-2 text-[length:var(--fs-sm)] text-(--muted)">
                    {entry.row.engine}
                  </td>
                  <td className="px-3 py-2 text-[length:var(--fs-sm)] text-(--muted)">
                    {precisionOf(entry) ?? "—"}
                  </td>
                  <NumCell>{contextOf(entry) ?? "—"}</NumCell>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap items-center gap-2">
                      {statusPill(entry.row.status)}
                      {capabilitiesOf(entry.row).length > 0 ? (
                        <span className="text-[length:var(--fs-xs)] text-(--dim)/70">
                          {capabilitiesOf(entry.row).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <EndCell>
                    <RowAction
                      disabled={!repository}
                      onClick={() => repository && onDownload(repository)}
                      title={repository ? `Download ${repository}` : "Artifact repository unknown"}
                    >
                      {downloadLabel(entry, downloadsByModel, startingModelIds)}
                    </RowAction>
                  </EndCell>
                </DataRow>
              );
            }),
          )}
        </tbody>
      </TableFrame>
      {selected ? (
        <RegistryDrawer
          entry={selected}
          poolGb={poolGb}
          onClose={() => setSelected(null)}
          onUseConfig={() => {
            onUseConfig(selected);
            setSelected(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Full inspection: every field the registry publishes for this config. */
function RegistryDrawer({
  entry,
  poolGb,
  onClose,
  onUseConfig,
}: {
  entry: HydratedRegistryRow;
  poolGb: number;
  onClose: () => void;
  onUseConfig: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const repository = repositoryOf(entry.instance);
  return (
    <ResourceDrawer
      title={repository?.split("/")[1] ?? entry.row.model_instance_id}
      icon={<ModelLogo modelId={modelIdFromPath(repository ?? entry.row.model_instance_id)} size="sm" className="rounded-md" />}
      badge={statusPill(entry.row.status)}
      status={`${entry.row.engine} · ${hardwareNameOf(entry)}`}
      footer={
        <>
          {repository ? (
            <a
              href={`https://huggingface.co/${repository}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[length:var(--fs-sm)] text-(--ui-muted) transition-colors hover:text-(--fg)"
            >
              Hugging Face
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          <ModelButton tone="primary" onClick={onUseConfig}>
            Use config
          </ModelButton>
          <ModelButton onClick={onClose}>Done</ModelButton>
        </>
      }
      onClose={onClose}
    >
      {entry.fit.state === "match" ? (
        <p className="text-[length:var(--fs-sm)] text-(--ok)">
          Measured on {hardwareNameOf(entry)} — detected on this machine.
        </p>
      ) : (
        <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
          Measured on {hardwareNameOf(entry)} — not detected here, kept visible for reference.
        </p>
      )}

      <ConfigFacts entry={entry} poolGb={poolGb} />

      <div className="mb-2 flex items-baseline justify-between gap-4">
        <div>
          <h3 className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">
            Registry record
          </h3>
          <p className="mt-0.5 text-[length:var(--fs-sm)] text-(--dim)">
            Everything the registry publishes for this configuration.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowRaw((value) => !value)}
          className="shrink-0 text-[length:var(--fs-xs)] text-(--ui-muted) transition-colors hover:text-(--fg)"
        >
          {showRaw ? "Hide raw JSON" : "Show raw JSON"}
        </button>
      </div>
      <ResourceDrawerSection title={showRaw ? "Raw records" : "Records"}>
        {showRaw ? <RawRecords entry={entry} /> : null}
      </ResourceDrawerSection>
    </ResourceDrawer>
  );
}

const RAW_SECTIONS = [
  ["recipe", "recipe"],
  ["model-instance", "instance"],
  ["model", "model"],
  ["hardware", "hardware"],
] as const;

function RawRecords({ entry }: { entry: HydratedRegistryRow }) {
  return (
    <div className="space-y-3">
      {RAW_SECTIONS.map(([name, key]) => {
        const record = entry[key];
        if (record === null || record === "error") return null;
        return (
          <div key={name}>
            <div className="mb-1 font-mono text-[length:var(--fs-xs)] text-(--dim)/70">{name}</div>
            <pre className="max-h-56 overflow-auto rounded-lg border border-(--ui-border) bg-(--ui-surface)/40 p-2 font-mono text-[length:var(--fs-xs)] leading-4 text-(--muted)">
              {JSON.stringify(record, null, 2)}
            </pre>
          </div>
        );
      })}
    </div>
  );
}

function ConfigFacts({ entry, poolGb }: { entry: HydratedRegistryRow; poolGb: number }) {
  const repository = repositoryOf(entry.instance);
  const revision = revisionOf(entry);
  const sizeGb = sizeGbOf(entry);
  const launchKind =
    entry.recipe && entry.recipe !== "error"
      ? (entry.recipe["launch"] as { kind?: unknown } | undefined)?.["kind"]
      : null;
  const capabilities = capabilitiesOf(entry.row);
  return (
    <>
      <ResourceDrawerSection title="Artifact">
        <ResourceFact label="Repository" value={repository ?? "—"} />
        <ResourceFact label="Revision" value={revision ? revisionShort(revision) : "not pinned"} />
        <ResourceFact label="Precision" value={precisionOf(entry) ?? "—"} />
        <ResourceFact label="Weights size" value={sizeGb != null ? formatGb(sizeGb) : "—"} />
      </ResourceDrawerSection>

      <ResourceDrawerSection title="Engine and serving">
        <ResourceFact label="Engine" value={entry.row.engine} />
        <ResourceFact label="Hardware count" value={String(entry.row.hardware_count)} />
        <ResourceFact label="Context" value={contextOf(entry) ?? "—"} />
        <ResourceFact
          label="Capabilities"
          value={capabilities.length > 0 ? capabilities.join(", ") : "chat"}
        />
        <ResourceFact label="Launch" value={String(launchKind) || entry.row.launch_kind} />
      </ResourceDrawerSection>

      {poolGb > 0 && sizeGb != null ? (
        <p className="text-[length:var(--fs-xs)] text-(--ui-muted)">
          Weights are {Math.round((sizeGb / poolGb) * 100)}% of this machine&apos;s{" "}
          {Math.round(poolGb)} GB pool.
        </p>
      ) : null}
    </>
  );
}
