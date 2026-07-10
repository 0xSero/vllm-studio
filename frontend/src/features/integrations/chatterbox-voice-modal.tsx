"use client";

import { useRef, useState, type ReactNode } from "react";
import type { SpeechStatus, SpeechVoiceProfile } from "@local-studio/contracts/speech";
import api from "@/lib/api/client";
import { SpeechApiError } from "@/lib/api/speech";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import {
  Alert,
  Button,
  Checkbox,
  FormField,
  Input,
  ProgressBar,
  Select,
  Spinner,
  StatusPill,
  Textarea,
  UiModal,
  UiModalHeader,
} from "@/ui";
import { AudioLines, Play, Trash2, Volume2, X } from "@/ui/icon-registry";
import {
  formattedStorage,
  formattedVoiceDuration,
  speechIssue,
  speechStatusLabel,
  speechStatusTone,
} from "./chatterbox-voice-model";
import { refreshSpeechStore, useSpeechStore } from "./chatterbox-voice-store";
import { useVoiceReference, VoiceReferencePicker } from "./chatterbox-voice-reference";

type PendingAction =
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

function actionErrorMessage(error: unknown): string {
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

function RuntimeSkeleton() {
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

function RuntimeOverview({
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

function voiceCreatedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Saved locally" : date.toLocaleDateString();
}

function VoiceList({
  voices,
  pending,
  pendingDelete,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  voices: readonly SpeechVoiceProfile[];
  pending: PendingAction | null;
  pendingDelete: string;
  onAskDelete: (voiceId: string) => void;
  onCancelDelete: () => void;
  onDelete: (voiceId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-(--ui-border)">
      {voices.length ? (
        voices.map((voice) => {
          const confirming = pendingDelete === voice.id;
          return (
            <div
              key={voice.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-separator) px-3 py-2.5 last:border-b-0"
            >
              <div className="min-w-0">
                <div className="truncate text-[length:var(--fs-base)] font-medium text-(--ui-fg)">
                  {voice.name}
                </div>
                <div className="mt-0.5 text-[length:var(--fs-sm)] text-(--ui-muted)">
                  {formattedVoiceDuration(voice.duration_ms)} · {voiceCreatedDate(voice.created_at)}
                </div>
              </div>
              {confirming ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onCancelDelete}
                    disabled={pending !== null}
                  >
                    Keep
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => onDelete(voice.id)}
                    loading={pending === `delete:${voice.id}`}
                  >
                    Confirm delete
                  </Button>
                </div>
              ) : (
                <Button
                  variant="icon"
                  size="sm"
                  aria-label={`Delete ${voice.name}`}
                  onClick={() => onAskDelete(voice.id)}
                  disabled={pending !== null}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        })
      ) : (
        <div className="px-3 py-5 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
          No saved voices yet. Add a clean reference recording to create one.
        </div>
      )}
    </div>
  );
}

function VoiceCreator({
  status,
  available,
  voices,
  pending,
  name,
  consent,
  pendingDelete,
  onName,
  onConsent,
  onCreate,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  status: SpeechStatus;
  available: boolean;
  voices: readonly SpeechVoiceProfile[];
  pending: PendingAction | null;
  name: string;
  consent: boolean;
  pendingDelete: string;
  onName: (value: string) => void;
  onConsent: (value: boolean) => void;
  onCreate: (reference: File) => Promise<boolean>;
  onAskDelete: (voiceId: string) => void;
  onCancelDelete: () => void;
  onDelete: (voiceId: string) => void;
}) {
  const reference = useVoiceReference();
  const creating = pending === "create";
  const canCreate = Boolean(
    available &&
    name.trim() &&
    consent &&
    reference.reference &&
    !reference.error &&
    status.prerequisites.ffmpeg &&
    !reference.recording &&
    pending === null,
  );
  const save = async () => {
    const file = reference.reference?.file;
    if (!file) return;
    if (await onCreate(file)) reference.clear();
  };
  return (
    <section className="border-t border-(--ui-border) px-6 py-5" aria-labelledby="voices-title">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 id="voices-title" className="text-sm font-semibold text-(--ui-fg)">
            Your voices
          </h3>
          <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
            References are encrypted at rest on the selected controller.
          </p>
        </div>
        <StatusPill tone={voices.length ? "good" : "default"}>
          {voices.length} {voices.length === 1 ? "voice" : "voices"}
        </StatusPill>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(17rem,0.9fr)]">
        <div className="space-y-4">
          <FormField
            label="Voice name"
            required
            description="A private label used in the voice picker."
          >
            <Input
              value={name}
              onChange={(event) => onName(event.target.value)}
              placeholder="My studio voice"
              maxLength={80}
              disabled={creating}
            />
          </FormField>
          <VoiceReferencePicker controller={reference} disabled={creating} />
          <Checkbox
            checked={consent}
            onChange={onConsent}
            disabled={pending !== null}
            label="I confirm this is my own voice and consent to cloning it on this controller."
            description="Local Studio rejects voice profiles without this explicit confirmation."
          />
          <Button onClick={() => void save()} loading={pending === "create"} disabled={!canCreate}>
            Save voice profile
          </Button>
        </div>
        <div>
          <div className="mb-2 text-[length:var(--fs-xs)] font-medium uppercase text-(--ui-muted)/70">
            Saved profiles
          </div>
          <VoiceList
            voices={voices}
            pending={pending}
            pendingDelete={pendingDelete}
            onAskDelete={onAskDelete}
            onCancelDelete={onCancelDelete}
            onDelete={onDelete}
          />
        </div>
      </div>
    </section>
  );
}

function PreviewPlayer({
  status,
  available,
  voices,
  pending,
  voiceId,
  text,
  previewUrl,
  onVoice,
  onText,
  onGenerate,
}: {
  status: SpeechStatus;
  available: boolean;
  voices: readonly SpeechVoiceProfile[];
  pending: PendingAction | null;
  voiceId: string;
  text: string;
  previewUrl: string;
  onVoice: (value: string) => void;
  onText: (value: string) => void;
  onGenerate: () => void;
}) {
  const canGenerate =
    available &&
    status.install.phase === "ready" &&
    Boolean(voiceId) &&
    Boolean(text.trim()) &&
    pending === null;
  return (
    <section
      className="border-t border-(--ui-border) px-6 py-5"
      aria-labelledby="voice-preview-title"
    >
      <div className="mb-4">
        <h3 id="voice-preview-title" className="text-sm font-semibold text-(--ui-fg)">
          Preview
        </h3>
        <p className="mt-1 text-[length:var(--fs-sm)] text-(--ui-muted)">
          Generate one short local sample before using this voice in a workflow.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(12rem,0.38fr)_minmax(0,1fr)]">
        <FormField label="Voice" required>
          <Select
            value={voiceId}
            onChange={(event) => onVoice(event.target.value)}
            disabled={!available || pending !== null}
            placeholder="Select a voice"
            options={voices.map((voice) => ({ value: voice.id, label: voice.name }))}
          />
        </FormField>
        <FormField label="Preview text" required description={`${text.length}/240 characters`}>
          <Textarea
            rows={3}
            maxLength={240}
            value={text}
            onChange={(event) => onText(event.target.value)}
            disabled={!available || pending !== null}
            placeholder="Type a short phrase to hear this voice."
          />
        </FormField>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {previewUrl ? (
          <audio controls preload="metadata" src={previewUrl} className="h-9 min-w-0 flex-1" />
        ) : (
          <div className="flex items-center gap-2 text-[length:var(--fs-sm)] text-(--ui-muted)">
            <Volume2 className="h-4 w-4" />
            Your generated sample appears here.
          </div>
        )}
        <Button
          size="sm"
          icon={pending === "preview" ? <Spinner size="sm" /> : <Play className="h-3.5 w-3.5" />}
          onClick={onGenerate}
          disabled={!canGenerate}
        >
          {pending === "preview" ? "Generating" : "Generate preview"}
        </Button>
      </div>
    </section>
  );
}

export function ChatterboxVoiceModal({ onClose }: { onClose: () => void }) {
  const { status, voices, loading, available, error: storeError } = useSpeechStore();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [pendingDelete, setPendingDelete] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [previewText, setPreviewText] = useState(
    "Local Studio is ready. This voice was generated privately on my workstation.",
  );
  const [preview, setPreview] = useState<{ url: string; voiceId: string } | null>(null);
  const previewUrlRef = useRef("");
  const actionGeneration = useRef(0);
  const activeAction = useRef<AbortController | null>(null);
  const selectedVoiceId = voices.some((voice) => voice.id === voiceId)
    ? voiceId
    : (voices[0]?.id ?? "");
  const visiblePreviewUrl = preview?.voiceId === selectedVoiceId ? preview.url : "";

  const clearPreview = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    setPreview(null);
  };

  const cancelActiveAction = () => {
    actionGeneration.current += 1;
    activeAction.current?.abort();
    activeAction.current = null;
  };

  useMountSubscription(
    () => () => {
      cancelActiveAction();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const run = async <A,>(
    action: PendingAction,
    operation: (signal: AbortSignal) => Promise<A>,
    onSuccess?: (value: A) => void,
  ): Promise<boolean> => {
    cancelActiveAction();
    const generation = actionGeneration.current;
    const controller = new AbortController();
    activeAction.current = controller;
    setPending(action);
    setActionError("");
    try {
      const value = await operation(controller.signal);
      if (controller.signal.aborted || generation !== actionGeneration.current) return false;
      await refreshSpeechStore();
      if (controller.signal.aborted || generation !== actionGeneration.current) return false;
      onSuccess?.(value);
      return true;
    } catch (operationError) {
      if (controller.signal.aborted || generation !== actionGeneration.current) return false;
      setActionError(actionErrorMessage(operationError));
      return false;
    } finally {
      if (generation === actionGeneration.current) {
        activeAction.current = null;
        setPending(null);
      }
    }
  };

  const install = () => void run("install", (signal) => api.installSpeechRuntime({ signal }));
  const cancelInstall = () =>
    void run("cancel-install", (signal) => api.cancelSpeechInstall(signal));
  const repair = () =>
    void run("repair", (signal) => api.installSpeechRuntime({ repair: true, signal }));
  const stop = () => void run("stop", (signal) => api.stopSpeechRuntime(signal));
  const create = (reference: File): Promise<boolean> =>
    run(
      "create",
      (signal) =>
        api.createSpeechVoice({
          name: name.trim(),
          consent: "self_voice_v1",
          reference,
          signal,
        }),
      () => {
        setName("");
        setConsent(false);
      },
    );
  const deleteVoice = (id: string) => {
    void run(
      `delete:${id}`,
      (signal) => api.deleteSpeechVoice(id, signal),
      () => {
        setPendingDelete("");
        if (selectedVoiceId === id) {
          setVoiceId("");
          clearPreview();
        }
      },
    );
  };
  const generate = () => {
    if (!selectedVoiceId || !previewText.trim()) return;
    const generatedVoiceId = selectedVoiceId;
    void run(
      "preview",
      (signal) =>
        api.synthesizeSpeechPreview({
          text: previewText.trim(),
          voiceId: generatedVoiceId,
          signal,
        }),
      (audio) => {
        clearPreview();
        const url = URL.createObjectURL(audio);
        previewUrlRef.current = url;
        setPreview({ url, voiceId: generatedVoiceId });
      },
    );
  };

  const dismiss = () => {
    cancelActiveAction();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    onClose();
  };
  let content: ReactNode;
  if (!status) {
    content = loading ? (
      <RuntimeSkeleton />
    ) : (
      <div className="space-y-4 px-6 py-5">
        <Alert variant="error">{storeError || "The voice service is unavailable."}</Alert>
        <Button variant="secondary" size="sm" onClick={() => void refreshSpeechStore()}>
          Retry
        </Button>
      </div>
    );
  } else {
    content = (
      <>
        <RuntimeOverview
          status={status}
          available={available}
          pending={pending}
          onInstall={install}
          onCancelInstall={cancelInstall}
          onRepair={repair}
          onStop={stop}
        />
        <VoiceCreator
          status={status}
          available={available}
          voices={voices}
          pending={pending}
          name={name}
          consent={consent}
          pendingDelete={pendingDelete}
          onName={setName}
          onConsent={setConsent}
          onCreate={create}
          onAskDelete={setPendingDelete}
          onCancelDelete={() => setPendingDelete("")}
          onDelete={deleteVoice}
        />
        <PreviewPlayer
          status={status}
          available={available}
          voices={voices}
          pending={pending}
          voiceId={selectedVoiceId}
          text={previewText}
          previewUrl={visiblePreviewUrl}
          onVoice={(value) => {
            if (value !== selectedVoiceId) clearPreview();
            setVoiceId(value);
          }}
          onText={setPreviewText}
          onGenerate={generate}
        />
      </>
    );
  }

  return (
    <UiModal
      isOpen
      onClose={dismiss}
      maxWidth="max-w-3xl"
      className="mx-3 max-h-[calc(100dvh-1.5rem)] overflow-hidden"
    >
      <UiModalHeader
        title="Chatterbox Voice"
        icon={
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-(--ui-info)/30 bg-(--ui-info)/10">
            <AudioLines className="h-4 w-4 text-(--ui-info)" />
          </span>
        }
        onClose={dismiss}
        showCloseButton
        closeIcon={<X className="h-4 w-4" />}
      />
      <div className="max-h-[calc(100dvh-5.75rem)] overflow-y-auto">
        <div className="border-b border-(--ui-border) px-6 py-4">
          <Alert variant="info">
            Voice cloning runs on your dedicated GPU. Reference audio stays encrypted on the
            selected controller; previews stream directly back to Local Studio.
          </Alert>
          {storeError && status ? (
            <Alert variant="warning" className="mt-3">
              {storeError}
            </Alert>
          ) : null}
          {actionError ? (
            <Alert variant="error" className="mt-3">
              {actionError}
            </Alert>
          ) : null}
        </div>
        {content}
      </div>
    </UiModal>
  );
}
