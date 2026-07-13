import type { SpeechStatus } from "@local-studio/contracts/speech";
import { SpeechApiError } from "@/lib/api/speech";
import type { UiTone } from "@/ui";

export type SpeechIssue = {
  variant: "warning" | "error";
  title: string;
  detail: string;
};

export type PendingAction =
  | "install"
  | "cancel-install"
  | "repair"
  | "create"
  | "preview"
  | "stop"
  | `delete:${string}`;

const gpuIsolationErrors = new Set([
  "model_gpu_conflict",
  "model_gpu_telemetry_missing",
  "model_gpu_transition",
  "model_gpu_unresolved",
  "model_process_changed",
  "model_process_unknown",
  "speech_gpu_busy",
]);

const gpuTargetErrors = new Set([
  "speech_gpu_ambiguous",
  "speech_gpu_invalid",
  "speech_gpu_missing",
  "speech_gpu_telemetry_missing",
  "speech_gpu_unavailable",
]);

export function actionErrorMessage(error: unknown): string {
  if (!(error instanceof SpeechApiError)) {
    return error instanceof Error ? error.message : "Voice operation failed";
  }
  if (error.code && gpuIsolationErrors.has(error.code)) {
    return `${error.message}. Stop the model using the RTX 3090 or move it to another GPU, then retry.`;
  }
  if (error.code && gpuTargetErrors.has(error.code)) {
    return `${error.message}. Configure the RTX 3090 by its full GPU UUID, then refresh this panel.`;
  }
  if (error.code === "speech_queue_full") {
    return "The voice queue is full. Wait for the current preview to finish, then retry.";
  }
  return error.message;
}

const gpuConflict = /gpu|lease|reserved|in use|occupied|conflict/i;

function statusFailure(status: SpeechStatus): string {
  return status.worker.error ?? status.install.error ?? "";
}

export function speechStatusLabel(status: SpeechStatus): string {
  if (status.install.phase !== "ready" && !status.prerequisites.storage.ready) {
    return "Storage blocked";
  }
  if (status.install.phase === "installing") return "Installing";
  if (status.install.phase === "missing") return "Setup required";
  if (status.install.phase === "failed") return "Setup failed";
  if (status.worker.phase === "busy") return "Generating";
  if (status.worker.phase === "starting") return "Starting";
  if (status.worker.phase === "ready") return "Ready";
  if (status.worker.phase === "failed") return "Engine error";
  return "Ready to start";
}

export function speechStatusTone(status: SpeechStatus): UiTone {
  if (status.install.phase !== "ready" && !status.prerequisites.storage.ready) return "danger";
  if (status.install.phase === "failed" || status.worker.phase === "failed") return "danger";
  if (status.install.phase === "missing" || !status.gpu) return "warning";
  if (status.install.phase === "installing" || status.worker.phase === "starting") return "info";
  if (status.worker.phase === "ready" || status.worker.phase === "busy") return "good";
  return "default";
}

export function speechIssue(status: SpeechStatus): SpeechIssue | null {
  const failure = statusFailure(status);
  const storage = status.prerequisites.storage;
  if (status.install.phase !== "ready" && !storage.ready) {
    const capacity =
      storage.available_bytes === null
        ? `Local Studio could not verify free space. ${formattedStorage(storage.required_bytes)} must be available on the controller data volume.`
        : `${formattedStorage(storage.available_bytes)} is available; ${formattedStorage(storage.required_bytes)} is required.`;
    return {
      variant: "error",
      title:
        storage.available_bytes === null
          ? "Storage could not be verified."
          : "The controller is low on storage.",
      detail: `${capacity} Free space, then retry the Chatterbox install.`,
    };
  }
  if (gpuConflict.test(failure)) {
    return {
      variant: "warning",
      title: "The RTX 3090 is already in use.",
      detail:
        "Stop the workload using that GPU or move it to another device before starting voice.",
    };
  }
  if (!status.gpu) {
    return {
      variant: "warning",
      title: "No dedicated speech GPU is available.",
      detail: "Connect the RTX 3090 controller or set its full GPU UUID as the speech target.",
    };
  }
  if (!status.prerequisites.ffmpeg) {
    return {
      variant: "warning",
      title: "FFmpeg is required for voice references.",
      detail: "Install FFmpeg on the controller host, then refresh this panel.",
    };
  }
  if (!status.prerequisites.python_311 && status.install.phase === "failed") {
    return {
      variant: "error",
      title: "Python 3.11 could not be prepared.",
      detail: "Install Python 3.11 or uv on the controller host, then retry setup.",
    };
  }
  if (failure) {
    return {
      variant: status.install.phase === "failed" ? "error" : "warning",
      title: "Voice needs attention.",
      detail: failure,
    };
  }
  return null;
}

export function formattedVoiceDuration(durationMs: number): string {
  const seconds = Math.max(0, durationMs) / 1_000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)} sec`;
}

export function formattedStorage(bytes: number): string {
  const gibibytes = Math.max(0, bytes) / 1024 ** 3;
  return `${gibibytes.toFixed(1).replace(/\.0$/, "")} GiB`;
}
