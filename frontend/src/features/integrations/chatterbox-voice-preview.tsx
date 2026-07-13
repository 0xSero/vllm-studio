"use client";

import type { SpeechStatus, SpeechVoiceProfile } from "@local-studio/contracts/speech";
import { Button, FormField, Select, Spinner, Textarea } from "@/ui";
import { Play, Volume2 } from "@/ui/icon-registry";
import type { PendingAction } from "./chatterbox-voice-model";

export function PreviewPlayer({
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
