import type { HuggingFaceModel, ModelDownload } from "@/lib/types";
import { extractQuantizations } from "../../utils";
import { extractProvider } from "@/lib/huggingface";

export type ModelRowDownloadAction =
  | {
      kind: "active";
      canPause: boolean;
      canResume: boolean;
      downloadId: string;
      label: string | null;
    }
  | { kind: "download"; modelId: string }
  | { kind: "ready" }
  | { kind: "starting" };

export interface ModelRowView {
  downloadAction: ModelRowDownloadAction;
  modelUrl: string;
  provider: string;
  quantizations: string[];
  rowClasses: string;
}

interface ModelRowViewInput {
  activeDownload: ModelDownload | null;
  isLocal: boolean;
  isStarting: boolean;
  model: HuggingFaceModel;
}

/**
 * Resolve derived display state for a discover model row.
 * @param input - Row inputs from the discover results list.
 * @returns The display model used by the row renderer.
 */
export function resolveModelRowView(input: ModelRowViewInput): ModelRowView {
  return {
    downloadAction: resolveDownloadAction(input),
    modelUrl: `https://huggingface.co/${input.model.modelId}`,
    provider: extractProvider(input.model.modelId),
    quantizations: extractQuantizations(input.model.tags),
    rowClasses: "hover:bg-(--surface)/30 transition-colors",
  };
}

function resolveDownloadAction(input: ModelRowViewInput): ModelRowDownloadAction {
  if (input.isLocal) {
    return { kind: "ready" };
  }
  if (input.isStarting) {
    return { kind: "starting" };
  }
  if (input.activeDownload) {
    return activeDownloadAction(input.activeDownload);
  }
  return { kind: "download", modelId: input.model.modelId };
}

function activeDownloadAction(activeDownload: ModelDownload): ModelRowDownloadAction {
  return {
    kind: "active",
    canPause: activeDownload.status === "downloading",
    canResume: activeDownload.status === "paused" || activeDownload.status === "failed",
    downloadId: activeDownload.id,
    label: activeDownloadLabel(activeDownload.status),
  };
}

function activeDownloadLabel(status: ModelDownload["status"]): string | null {
  if (status === "completed") {
    return "Downloaded";
  }
  if (status === "downloading" || status === "queued") {
    return "Downloading…";
  }
  return null;
}
