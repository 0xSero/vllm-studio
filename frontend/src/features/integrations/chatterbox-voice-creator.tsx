"use client";

import type { SpeechStatus, SpeechVoiceProfile } from "@local-studio/contracts/speech";
import { Button, Checkbox, FormField, Input, StatusPill } from "@/ui";
import { Trash2 } from "@/ui/icon-registry";
import { formattedVoiceDuration, type PendingAction } from "./chatterbox-voice-model";
import { useVoiceReference, VoiceReferencePicker } from "./chatterbox-voice-reference";

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

export function VoiceCreator({
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
