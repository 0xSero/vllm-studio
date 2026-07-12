"use client";

import type { SpeechStatus } from "@local-studio/contracts/speech";
import { Alert, Button, ProgressBar, StatusPill } from "@/ui";
import {
  formattedStorage,
  speechIssue,
  speechStatusLabel,
  speechStatusTone,
  type PendingAction,
} from "./chatterbox-voice-model";

export function RuntimeSkeleton() {
  return (
    <div className="space-y-4 px-6 py-5" role="status" aria-label="Checking voice runtime">
      <div className="h-4 w-36 animate-pulse rounded bg-(--ui-hover)" />
      <div className="h-12 animate-pulse rounded-lg bg-(--ui-hover)/70" />
      <div className="h-24 animate-pulse rounded-lg bg-(--ui-hover)/50" />
    </div>
  );
}

function RuntimeIssue({ status }: { status: SpeechStatus }) {
  const issue = speechIssue(status);
  if (!issue) return null;
  return (
    <Alert variant={issue.variant}>
      <div className="font-medium">{issue.title}</div>
      <div className="mt-1 leading-relaxed opacity-85">{issue.detail}</div>
    </Alert>
  );
}

type RuntimeActionProps = {
  status: SpeechStatus;
  available: boolean;
  pending: PendingAction | null;
  onInstall: () => void;
  onCancelInstall: () => void;
  onRepair: () => void;
  onStop: () => void;
};

function RuntimeActions(props: RuntimeActionProps) {
  const { status, available, pending, onInstall, onCancelInstall, onRepair, onStop } = props;
  const installing = status.install.phase === "installing";
  const installed = status.install.phase === "ready";
  const workerActive = status.worker.phase !== "stopped" || pending === "preview";
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      {!installed && !installing ? (
        <Button
          size="sm"
          onClick={onInstall}
          loading={pending === "install"}
          disabled={
            !available || !status.gpu || !status.prerequisites.storage.ready || pending !== null
          }
        >
          {status.install.phase === "failed" ? "Retry setup" : "Install runtime"}
        </Button>
      ) : null}
      {installing ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancelInstall}
          loading={pending === "cancel-install"}
          disabled={!available || (pending !== null && pending !== "cancel-install")}
        >
          Cancel setup
        </Button>
      ) : null}
      {installed && !installing ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRepair}
          loading={pending === "repair"}
          disabled={!available || pending !== null}
        >
          Repair runtime
        </Button>
      ) : null}
      {workerActive ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={onStop}
          loading={pending === "stop"}
          disabled={!available || pending === "stop" || pending === "cancel-install"}
        >
          Stop voice engine
        </Button>
      ) : null}
    </div>
  );
}

function RuntimeInstallProgress({ status }: { status: SpeechStatus }) {
  if (status.install.phase !== "installing") return null;
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-[length:var(--fs-sm)] text-(--ui-muted)">
        <span>{status.install.message}</span>
        <span className="font-mono">{Math.round(status.install.progress * 100)}%</span>
      </div>
      <ProgressBar progress={status.install.progress * 100} />
    </div>
  );
}

export function RuntimeOverview({
  status,
  available,
  pending,
  onInstall,
  onCancelInstall,
  onRepair,
  onStop,
}: {
  status: SpeechStatus;
  available: boolean;
  pending: PendingAction | null;
  onInstall: () => void;
  onCancelInstall: () => void;
  onRepair: () => void;
  onStop: () => void;
}) {
  return (
    <section className="space-y-4 px-6 py-5" aria-labelledby="voice-runtime-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="voice-runtime-title" className="text-sm font-semibold text-(--ui-fg)">
              Chatterbox Turbo
            </h3>
            <StatusPill tone={available ? speechStatusTone(status) : "danger"}>
              {available ? speechStatusLabel(status) : "Unavailable"}
            </StatusPill>
          </div>
          <p className="mt-1 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
            {available ? status.install.message : "The selected controller is not responding."}
          </p>
        </div>
        <RuntimeActions
          status={status}
          available={available}
          pending={pending}
          onInstall={onInstall}
          onCancelInstall={onCancelInstall}
          onRepair={onRepair}
          onStop={onStop}
        />
      </div>
      <RuntimeInstallProgress status={status} />
      <div className="grid gap-x-8 gap-y-3 border-y border-(--ui-separator) py-3 sm:grid-cols-3">
        <div className="min-w-0">
          <div className="text-[length:var(--fs-xs)] font-medium uppercase text-(--ui-muted)/70">
            Speech GPU
          </div>
          <div className="mt-1 truncate text-[length:var(--fs-sm)] text-(--ui-fg)">
            {status.gpu?.name ?? "Not assigned"}
          </div>
        </div>
        <div>
          <div className="text-[length:var(--fs-xs)] font-medium uppercase text-(--ui-muted)/70">
            Runtime
          </div>
          <div className="mt-1 text-[length:var(--fs-sm)] text-(--ui-fg)">
            Chatterbox {status.package_version} · {status.worker.queue_depth} queued
          </div>
        </div>
        <div>
          <div className="text-[length:var(--fs-xs)] font-medium uppercase text-(--ui-muted)/70">
            Storage
          </div>
          <div className="mt-1 text-[length:var(--fs-sm)] text-(--ui-fg)">
            {status.prerequisites.storage.available_bytes === null
              ? "Unavailable"
              : `${formattedStorage(status.prerequisites.storage.available_bytes)} free`}
          </div>
        </div>
      </div>
      <RuntimeIssue status={status} />
    </section>
  );
}
