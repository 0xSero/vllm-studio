import type { ModelDownload } from "@/lib/types";
import { formatBytes } from "@/lib/formatters";

export const setupSteps = [
  { label: "Controller", description: "Choose where this machine keeps model weights." },
  { label: "Hardware", description: "Confirm the rig and prepare its inference runtimes." },
  { label: "Model", description: "Pick weights that fit this controller." },
  { label: "Download", description: "Transfer and validate the model files." },
  { label: "Serve", description: "Bind model, runtime, and launch configuration." },
  { label: "Verify", description: "Benchmark the API and open your workbench." },
] as const;

export { formatBytes };

export const progressPercent = (download: ModelDownload | null): number => {
  if (!download?.total_bytes) return 0;
  return Math.min(100, Math.round((download.downloaded_bytes / download.total_bytes) * 100));
};
