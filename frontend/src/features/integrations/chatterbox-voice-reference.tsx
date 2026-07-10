"use client";

import { useCallback, useRef, useState } from "react";
import { Effect, Fiber } from "effect";
import { Button, FormField, Input, SegmentedControl } from "@/ui";
import { Mic, Square, Upload } from "@/ui/icon-registry";
import { useMountSubscription } from "@/hooks/use-mount-subscription";

type ReferenceMode = "upload" | "record";

export interface VoiceReference {
  file: File;
  url: string;
  durationMs: number | null;
}

type ActiveRecording = {
  recorder: MediaRecorder;
  stream: MediaStream;
  timer: Fiber.Fiber<void, never>;
};

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MIN_RECORDING_MS = 6_000;
const AUTO_STOP_MS = 18_000;
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

function recorderMimeType(): string {
  return MIME_TYPES.find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
}

function recordingExtension(type: string): string {
  if (type.includes("mp4")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  return "webm";
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

function recordingError(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was denied. Allow it in System Settings, or upload a recording.";
  }
  return error instanceof Error ? error.message : "Microphone recording failed";
}

export function useVoiceReference() {
  const [mode, setModeState] = useState<ReferenceMode>("upload");
  const [reference, setReference] = useState<VoiceReference | null>(null);
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const active = useRef<ActiveRecording | null>(null);
  const captureSequence = useRef(0);
  const capturePending = useRef(false);
  const previewUrl = useRef("");
  const mounted = useRef(true);

  const replaceReference = useCallback((file: File, durationMs: number | null) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    const url = URL.createObjectURL(file);
    previewUrl.current = url;
    setReference({ file, url, durationMs });
    setError("");
  }, []);

  const clear = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = "";
    setReference(null);
    setError("");
  }, []);

  const stopRecording = useCallback(() => {
    const current = active.current;
    if (!current) {
      captureSequence.current += 1;
      capturePending.current = false;
      setRecording(false);
      setRequesting(false);
      return;
    }
    active.current = null;
    void Effect.runPromise(Fiber.interrupt(current.timer));
    if (current.recorder.state !== "inactive") current.recorder.stop();
    stopTracks(current.stream);
    setRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    if (active.current || capturePending.current) return;
    capturePending.current = true;
    const sequence = ++captureSequence.current;
    setError("");
    setRecording(true);
    setRequesting(true);
    let captureStream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Microphone recording is unavailable. Upload a recording instead.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      captureStream = stream;
      if (!mounted.current || sequence !== captureSequence.current) {
        stopTracks(stream);
        return;
      }
      const mimeType = recorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        const current = active.current;
        if (current) void Effect.runPromise(Fiber.interrupt(current.timer));
        recorder.ondataavailable = null;
        recorder.onstop = null;
        stopTracks(stream);
        active.current = null;
        if (!mounted.current) return;
        setRecording(false);
        setRequesting(false);
        setError("Microphone recording failed. Try again or upload a recording.");
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - startedAt;
        if (!mounted.current) return;
        setRecording(false);
        if (durationMs < MIN_RECORDING_MS) {
          setError("Record at least six seconds of clear, natural speech.");
          return;
        }
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunks, { type });
        replaceReference(
          new File([blob], `voice-reference.${recordingExtension(type)}`, { type }),
          durationMs,
        );
      };
      const timer = Effect.runFork(
        Effect.gen(function* () {
          yield* Effect.sleep(AUTO_STOP_MS);
          if (recorder.state !== "inactive") recorder.stop();
          stopTracks(stream);
          active.current = null;
        }),
      );
      active.current = { recorder, stream, timer };
      recorder.start(1_000);
      capturePending.current = false;
      setRequesting(false);
    } catch (captureError) {
      const current = active.current;
      if (current) void Effect.runPromise(Fiber.interrupt(current.timer));
      active.current = null;
      capturePending.current = false;
      if (captureStream) stopTracks(captureStream);
      if (sequence !== captureSequence.current || !mounted.current) return;
      setError(recordingError(captureError));
      setRecording(false);
      setRequesting(false);
    }
  }, [replaceReference]);

  const setMode = useCallback(
    (next: ReferenceMode) => {
      if (next !== "record" && (recording || capturePending.current || active.current)) {
        stopRecording();
      }
      setModeState(next);
    },
    [recording, stopRecording],
  );

  const chooseUpload = useCallback(
    (file: File | null) => {
      if (!file) return;
      if (!file.size) {
        setError("Voice reference is empty.");
        return;
      }
      if (file.size > MAX_REFERENCE_BYTES) {
        setError("Voice reference must be 20 MB or smaller.");
        return;
      }
      replaceReference(file, null);
    },
    [replaceReference],
  );

  useMountSubscription(
    () => () => {
      mounted.current = false;
      captureSequence.current += 1;
      capturePending.current = false;
      const current = active.current;
      if (current) {
        current.recorder.ondataavailable = null;
        current.recorder.onerror = null;
        current.recorder.onstop = null;
        if (current.recorder.state !== "inactive") current.recorder.stop();
        stopTracks(current.stream);
        void Effect.runPromise(Fiber.interrupt(current.timer));
      }
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    [],
  );

  return {
    mode,
    setMode,
    reference,
    recording,
    requesting,
    error,
    clear,
    chooseUpload,
    startRecording,
    stopRecording,
  };
}

export type VoiceReferenceController = ReturnType<typeof useVoiceReference>;

export function VoiceReferencePicker({
  controller,
  disabled = false,
}: {
  controller: VoiceReferenceController;
  disabled?: boolean;
}) {
  return (
    <FormField
      label="Reference audio"
      required
      asGroup
      description="Use 6–20 seconds of one voice, without music or other speakers. Files stay on your controller."
      error={controller.error}
    >
      <SegmentedControl<ReferenceMode>
        value={controller.mode}
        onChange={controller.setMode}
        items={[
          { id: "upload", label: "Upload", icon: <Upload className="h-3.5 w-3.5" /> },
          { id: "record", label: "Microphone", icon: <Mic className="h-3.5 w-3.5" /> },
        ]}
        size="sm"
        disabled={disabled}
      />
      <div className="mt-3 rounded-lg border border-(--ui-border) bg-(--ui-bg)/60 p-3">
        {controller.mode === "upload" ? (
          <Input
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.webm,.ogg,.flac"
            disabled={disabled}
            onChange={(event) => controller.chooseUpload(event.target.files?.[0] ?? null)}
          />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0" role="status" aria-live="polite">
              <div className="text-[length:var(--fs-base)] font-medium text-(--ui-fg)">
                {controller.requesting
                  ? "Waiting for microphone"
                  : controller.recording
                    ? "Listening"
                    : "Record in Local Studio"}
              </div>
              <div className="mt-1 text-[length:var(--fs-sm)] leading-relaxed text-(--ui-muted)">
                {controller.requesting
                  ? "Approve microphone access to begin. You can cancel and upload instead."
                  : controller.recording
                    ? "Keep speaking naturally. Recording stops automatically at 18 seconds."
                    : "Speak for at least six seconds in a quiet room."}
              </div>
            </div>
            <Button
              variant={controller.recording ? "danger" : "secondary"}
              size="sm"
              icon={
                controller.recording ? (
                  <Square className="h-3.5 w-3.5" />
                ) : (
                  <Mic className="h-3.5 w-3.5" />
                )
              }
              onClick={() =>
                controller.recording ? controller.stopRecording() : void controller.startRecording()
              }
              disabled={disabled}
            >
              {controller.requesting
                ? "Cancel"
                : controller.recording
                  ? "Stop recording"
                  : "Start recording"}
            </Button>
          </div>
        )}
        {controller.reference ? (
          <div className="mt-3 border-t border-(--ui-separator) pt-3">
            <div className="mb-2 flex min-w-0 items-center justify-between gap-3 text-[length:var(--fs-sm)]">
              <span className="truncate text-(--ui-fg)">
                {controller.reference.file.name}
                {controller.reference.durationMs === null
                  ? ""
                  : ` · ${(controller.reference.durationMs / 1_000).toFixed(1)} sec`}
              </span>
              <Button variant="ghost" size="sm" onClick={controller.clear} disabled={disabled}>
                Remove
              </Button>
            </div>
            <audio
              controls
              preload="metadata"
              src={controller.reference.url}
              className="h-9 w-full"
            />
          </div>
        ) : null}
      </div>
    </FormField>
  );
}
