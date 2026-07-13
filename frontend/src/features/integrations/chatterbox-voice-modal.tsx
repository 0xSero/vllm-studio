"use client";

import { useRef, useState, type ReactNode } from "react";
import api from "@/lib/api/client";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { Alert, Button, UiModal, UiModalHeader } from "@/ui";
import { AudioLines, X } from "@/ui/icon-registry";
import { VoiceCreator } from "./chatterbox-voice-creator";
import { actionErrorMessage, type PendingAction } from "./chatterbox-voice-model";
import { PreviewPlayer } from "./chatterbox-voice-preview";
import { RuntimeOverview, RuntimeSkeleton } from "./chatterbox-voice-runtime";
import { refreshSpeechStore, useSpeechStore } from "./chatterbox-voice-store";

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
