"use client";

import { Pause, Play, X } from "lucide-react";
import { useDownloads } from "@/hooks/use-downloads";
import { formatBytes } from "@/lib/formatters";
import {
  ModelButton,
  ModelRow,
  ModelSection,
  ModelStatus,
  ModelValue,
} from "./model-page-primitives";

export function DownloadsTab() {
  const { downloads, error, pauseDownload, resumeDownload, cancelDownload } = useDownloads();
  return (
    <ModelSection
      title="Downloads"
      description="Models the user requested, with server-side state, progress, speed, errors, and controls."
      actions={
        <ModelStatus tone={error ? "danger" : downloads.length ? "info" : "default"}>
          {error ? "error" : `${downloads.length} rows`}
        </ModelStatus>
      }
    >
      {error ? (
        <ModelRow
          label="Download worker"
          description="Controller download endpoint returned an error."
          value={<ModelValue dim>{error}</ModelValue>}
          status={<ModelStatus tone="danger">error</ModelStatus>}
        />
      ) : null}
      {downloads.length === 0 ? (
        <ModelRow
          label="No downloads"
          description="Click Download from Search Models to populate this section."
          value={<ModelValue dim>Queue is empty</ModelValue>}
          status={<ModelStatus>idle</ModelStatus>}
        />
      ) : (
        downloads.map((download) => {
          const total = download.total_bytes ?? 0;
          const progress = total > 0 ? Math.round((download.downloaded_bytes / total) * 100) : 0;
          return (
            <ModelRow
              key={download.id}
              label={download.model_id}
              description={download.target_dir}
              value={
                <ModelValue mono>
                  {formatBytes(download.downloaded_bytes)} / {formatBytes(total)} · {progress}%
                  {download.status === "completed" ? ` · done ${download.updated_at}` : ""}
                </ModelValue>
              }
              status={
                <ModelStatus tone={download.status === "failed" ? "danger" : "info"}>
                  {download.status}
                </ModelStatus>
              }
              actions={
                <>
                  {download.status === "downloading" ? (
                    <ModelButton onClick={() => void pauseDownload(download.id)}>
                      <Pause className="h-3 w-3" />
                    </ModelButton>
                  ) : null}
                  {download.status === "paused" || download.status === "failed" ? (
                    <ModelButton onClick={() => void resumeDownload(download.id)}>
                      <Play className="h-3 w-3" />
                      Retry
                    </ModelButton>
                  ) : null}
                  {download.status !== "completed" && download.status !== "canceled" ? (
                    <ModelButton tone="danger" onClick={() => void cancelDownload(download.id)}>
                      <X className="h-3 w-3" />
                    </ModelButton>
                  ) : null}
                </>
              }
            >
              {download.error ? (
                <div className="text-[11px] text-(--err)">{download.error}</div>
              ) : null}
            </ModelRow>
          );
        })
      )}
    </ModelSection>
  );
}
