"use client";

import { useCallback } from "react";
import { RefreshCw } from "@/ui/icon-registry";
import { ModelButton } from "@/ui";
import { cx } from "@/ui/utils";
import { useDownloads } from "@/hooks/use-downloads";
import { TableNotice, TableSkeleton } from "./catalog-table-shell";
import { RegistryCatalog } from "./registry-catalog";
import { useHardwareProfile } from "./picks-shared";
import {
  useHydratedRegistryRows,
  useRegistryRecommendations,
  type HydratedRegistryRow,
} from "./use-registry";

const PICKS_COLUMNS = ["Model", "Engine", "Precision", "Context", "Status", ""] as const;

/**
 * Recommended, backed by the global model registry
 * (github.com/0xSero/local-ai-registry). The registry index is the discovery
 * surface; exact records load progressively; rows measured on detected
 * hardware lead, and every other config stays inspectable.
 */
export function PicksTab({
  onUseConfig,
}: {
  onUseConfig?: (row: HydratedRegistryRow) => void;
} = {}) {
  const { data, loading, error, refresh, showAll, toggleAll } = useRegistryRecommendations();
  const hardware = useHardwareProfile();
  const {
    downloadsByModel,
    startingModelIds,
    error: downloadError,
    startDownload,
  } = useDownloads();
  const rows = useHydratedRegistryRows(data?.rows ?? []);

  const handleDownload = useCallback(
    (repository: string) => {
      void startDownload({ model_id: repository }).catch(() => {});
    },
    [startDownload],
  );

  const matched = (data?.matches ?? []).filter((match) => match.matched);

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-(--ui-separator) pb-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-[length:var(--fs-md)] text-(--fg)" title={hardware.detail}>
            {matched.length > 0
              ? matched.map((match) => `${match.registry_name} ×${match.detected_count}`).join(", ")
              : hardware.poolGb > 0
                ? `${Math.round(hardware.poolGb)} GB pool`
                : "No GPUs detected"}
          </span>
          <span className="truncate text-[length:var(--fs-sm)] text-(--ui-muted)">
            {data
              ? `${data.counts.matched} of ${data.counts.total} registry configs match this machine`
              : "Matching against the local-ai-registry…"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={toggleAll}
            className={cx(
              "text-[length:var(--fs-xs)] transition-colors hover:text-(--ui-fg)",
              showAll ? "text-(--ui-fg)" : "text-(--ui-muted)",
            )}
          >
            {showAll ? "Matched hardware only" : "Show every hardware group"}
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            title="Reload from the registry"
            aria-label="Reload from the registry"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-(--ui-muted) transition-colors hover:bg-(--ui-hover) hover:text-(--ui-fg) disabled:opacity-45"
          >
            <RefreshCw className={cx("h-3.5 w-3.5", loading ? "animate-spin" : "")} />
          </button>
        </div>
      </div>

      {downloadError ? (
        <div className="text-[length:var(--fs-sm)] text-(--err)">{downloadError}</div>
      ) : null}

      {loading && rows.length === 0 ? (
        <TableSkeleton columns={PICKS_COLUMNS} />
      ) : error && rows.length === 0 ? (
        <TableNotice
          title="The registry could not be reached"
          body={`${error} — check the connection, then reload.`}
          action={
            <ModelButton tone="primary" onClick={() => void refresh()}>
              <RefreshCw className="h-3 w-3" />
              Try again
            </ModelButton>
          }
        />
      ) : data ? (
        <RegistryCatalog
          rows={rows}
          recommendations={data}
          poolGb={hardware.poolGb}
          downloadsByModel={downloadsByModel}
          startingModelIds={startingModelIds}
          onDownload={handleDownload}
          onUseConfig={(row) => onUseConfig?.(row)}
          onRetry={() => void refresh()}
        />
      ) : null}
    </div>
  );
}
