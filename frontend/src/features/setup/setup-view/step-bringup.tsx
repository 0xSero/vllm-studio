"use client";

import { Button, ProgressBar, Spinner } from "@/ui";
import { MessageSquare, Pause, Play, X } from "lucide-react";
import type { ModelDownload } from "@/lib/types";
import { formatBytes, progressPercent } from "./utils";
import { ChecklistRow, type ChecklistState } from "./setup-shell";

interface SetupBenchmarkResult {
  prompt_tokens: number;
  completion_tokens: number;
  total_time_s: number;
  generation_tps: number;
}

/**
 * Download -> Serve -> Verify as one live checklist: three formerly separate wizard
 * screens become rows that check themselves off, so the user watches one surface come
 * to life instead of clicking through three.
 */
export function StepBringup({
  step,
  selectedModel,
  downloads,
  activeDownload,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  continueToLaunch,
  backend,
  configuringRecipe,
  launchError,
  configureAndLaunch,
  benchmarking,
  benchmarkResult,
  benchmarkError,
  runSetupBenchmark,
  openChat,
  openDashboard,
}: {
  step: number;
  selectedModel: string;
  downloads: ModelDownload[];
  activeDownload: ModelDownload | null;
  pauseDownload: (id: string) => void;
  resumeDownload: (id: string) => void;
  cancelDownload: (id: string) => void;
  continueToLaunch: () => void;
  backend: string;
  configuringRecipe: boolean;
  launchError: string | null;
  configureAndLaunch: () => void;
  benchmarking: boolean;
  benchmarkResult: SetupBenchmarkResult | null;
  benchmarkError: string | null;
  runSetupBenchmark: () => void;
  openChat: () => void;
  openDashboard: () => void;
}) {
  const download = activeDownload ?? downloads[0] ?? null;
  const downloadDone = step > 3 || download?.status === "completed";
  const { downloadState, serveState, verifyState } = checklistStates(step, downloadDone);
  const percent = progressPercent(download);

  return (
    <div className="space-y-2.5">
      <ChecklistRow
        state={downloadState}
        title={`Download ${selectedModel || "weights"}`}
        meta={downloadDone ? "complete" : null}
        action={
          downloadDone ? (
            <Button size="sm" onClick={continueToLaunch}>
              Continue
            </Button>
          ) : null
        }
      >
        <DownloadProgress
          download={download}
          percent={percent}
          downloadDone={downloadDone}
          onPause={pauseDownload}
          onResume={resumeDownload}
          onCancel={cancelDownload}
          onContinue={continueToLaunch}
        />
      </ChecklistRow>

      <ChecklistRow
        state={serveState}
        title={`Serve with ${backend}`}
        meta={serveState === "done" ? "running" : null}
      >
        <ServeStep
          launchError={launchError}
          configuringRecipe={configuringRecipe}
          onLaunch={configureAndLaunch}
        />
      </ChecklistRow>

      <ChecklistRow state={verifyState} title="First tokens" meta={null}>
        <div className="space-y-3">
          <BenchmarkReadout result={benchmarkResult} />
          {benchmarkError ? <div className="text-xs text-(--err)">{benchmarkError}</div> : null}
          <div className="flex gap-2">
            <Button
              variant={benchmarkResult ? "secondary" : "primary"}
              size="sm"
              onClick={runSetupBenchmark}
              disabled={benchmarking}
              icon={benchmarking ? <Spinner size="xs" /> : undefined}
            >
              {benchmarking ? "Running…" : benchmarkResult ? "Run again" : "Send test request"}
            </Button>
            {benchmarkResult ? (
              <>
                <Button
                  size="sm"
                  onClick={openChat}
                  icon={<MessageSquare className="h-3.5 w-3.5" />}
                >
                  Open chat
                </Button>
                <Button variant="secondary" size="sm" onClick={openDashboard}>
                  Dashboard
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </ChecklistRow>
    </div>
  );
}

/** Transfer progress plus its pause/resume/cancel controls. */
function DownloadProgress({
  download,
  percent,
  downloadDone,
  onPause,
  onResume,
  onCancel,
  onContinue,
}: {
  download: ModelDownload | null;
  percent: number;
  downloadDone: boolean;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onContinue: () => void;
}) {
  if (!download) {
    return (
      <div className="flex items-center gap-2 text-[length:var(--fs-sm)] text-(--ui-muted)">
        <Spinner size="xs" /> Waiting for the transfer to register…
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <ProgressBar progress={percent} />
      <div className="flex items-center justify-between font-mono text-[11px] text-(--ui-muted)">
        <span>
          {formatBytes(download.downloaded_bytes)} / {formatBytes(download.total_bytes ?? 0)}
          {download.speed_bytes_per_second
            ? ` · ${formatBytes(download.speed_bytes_per_second)}/s`
            : ""}
        </span>
        <span>{percent}%</span>
      </div>
      <div className="flex gap-2">
        {download.status === "downloading" ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onPause(download.id)}
            icon={<Pause className="h-3 w-3" />}
          >
            Pause
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onResume(download.id)}
            icon={<Play className="h-3 w-3" />}
          >
            Resume
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onCancel(download.id)}
          icon={<X className="h-3 w-3" />}
        >
          Cancel
        </Button>
        {downloadDone ? (
          <Button size="sm" onClick={onContinue}>
            Continue
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Decode rate and latency once the first real request has come back. */
function BenchmarkReadout({ result }: { result: SetupBenchmarkResult | null }) {
  if (!result) {
    return (
      <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
        One real request through the API proves the whole path.
      </p>
    );
  }
  return (
    <div className="flex items-baseline gap-6 font-mono tabular-nums">
      <div>
        <div className="text-[length:var(--fs-xl)] text-(--fg)">
          {result.generation_tps.toFixed(1)}
          <span className="ml-1 text-[11px] text-(--ui-muted)">tok/s</span>
        </div>
        <div className="text-[10px] uppercase tracking-wide text-(--ui-muted)">decode</div>
      </div>
      <div>
        <div className="text-[length:var(--fs-xl)] text-(--fg)">
          {result.total_time_s.toFixed(1)}
          <span className="ml-1 text-[11px] text-(--ui-muted)">s</span>
        </div>
        <div className="text-[10px] uppercase tracking-wide text-(--ui-muted)">
          {result.completion_tokens} tokens
        </div>
      </div>
    </div>
  );
}

function checklistStates(
  step: number,
  downloadDone: boolean,
): { downloadState: ChecklistState; serveState: ChecklistState; verifyState: ChecklistState } {
  return {
    downloadState: downloadDone ? "done" : step === 3 ? "active" : "pending",
    serveState: step > 4 ? "done" : step === 4 ? "active" : "pending",
    verifyState: step === 5 ? "active" : "pending",
  };
}

/** Recipe creation plus engine launch, with the last failure kept visible. */
function ServeStep({
  launchError,
  configuringRecipe,
  onLaunch,
}: {
  launchError: string | null;
  configuringRecipe: boolean;
  onLaunch: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[length:var(--fs-sm)] text-(--ui-muted)">
        Creates the launch recipe and starts the engine. Cold starts compile kernels — the first
        launch is the slowest one.
      </p>
      {launchError ? (
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-(--err)/40 bg-(--err)/5 p-3 font-mono text-[11px] text-(--err)">
          {launchError}
        </pre>
      ) : null}
      <Button
        onClick={onLaunch}
        disabled={configuringRecipe}
        icon={configuringRecipe ? <Spinner size="xs" /> : undefined}
      >
        {configuringRecipe ? "Launching…" : launchError ? "Retry launch" : "Launch"}
      </Button>
    </div>
  );
}
