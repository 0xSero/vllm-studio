import assert from "node:assert/strict";
import { test } from "node:test";
import { Schema } from "effect";
import {
  CHATTERBOX_BACKEND,
  CHATTERBOX_MODEL_REVISION,
  CHATTERBOX_PACKAGE_VERSION,
  type SpeechStatus,
} from "@local-studio/contracts/speech";
import {
  formattedStorage,
  speechIssue,
  speechStatusLabel,
} from "../src/features/integrations/chatterbox-voice-model";
import { SpeechStatusSchema } from "../src/lib/api/speech";

const status = (input: Partial<SpeechStatus> = {}): SpeechStatus => ({
  backend: CHATTERBOX_BACKEND,
  package_version: CHATTERBOX_PACKAGE_VERSION,
  model_revision: CHATTERBOX_MODEL_REVISION,
  install: {
    phase: "ready",
    progress: 1,
    message: "Chatterbox Turbo is ready",
    error: null,
  },
  worker: { phase: "stopped", queue_depth: 0, error: null },
  gpu: {
    uuid: "GPU-dce3135c-dc1f-de67-bb7b-b51671e40500",
    name: "NVIDIA GeForce RTX 3090",
  },
  prerequisites: {
    ffmpeg: true,
    python_311: true,
    storage: { available_bytes: 48 * 1024 ** 3, required_bytes: 96 * 1024 ** 3, ready: true },
  },
  voice_count: 0,
  ...input,
});

test("strictly decodes the complete speech status boundary", () => {
  const current = status();
  assert.deepEqual(Schema.decodeUnknownSync(SpeechStatusSchema)(current), current);
  const { storage: _storage, ...incompletePrerequisites } = current.prerequisites;
  assert.throws(() =>
    Schema.decodeUnknownSync(SpeechStatusSchema)({
      ...current,
      prerequisites: incompletePrerequisites,
    }),
  );
});

test("turns structured storage capacity into an exact recovery state", () => {
  const current = status({
    install: {
      phase: "missing",
      progress: 0,
      message: "Chatterbox Turbo is not installed",
      error: null,
    },
    prerequisites: {
      ffmpeg: true,
      python_311: true,
      storage: {
        available_bytes: 47.4 * 1024 ** 3,
        required_bytes: 91.2 * 1024 ** 3,
        ready: false,
      },
    },
  });
  assert.deepEqual(speechIssue(current), {
    variant: "error",
    title: "The controller is low on storage.",
    detail:
      "47.4 GiB is available; 91.2 GiB is required. Free space, then retry the Chatterbox install.",
  });
  assert.equal(speechStatusLabel(current), "Storage blocked");
  assert.equal(formattedStorage(8.25 * 1024 ** 3), "8.3 GiB");
});

test("does not block an installed runtime on the setup capacity threshold", () => {
  const current = status({
    prerequisites: {
      ffmpeg: true,
      python_311: true,
      storage: { available_bytes: 8 * 1024 ** 3, required_bytes: 96 * 1024 ** 3, ready: false },
    },
  });
  assert.equal(speechStatusLabel(current), "Ready to start");
  assert.equal(speechIssue(current), null);
});

test("reports worker activity without hiding runtime readiness", () => {
  assert.equal(
    speechStatusLabel(status({ worker: { phase: "busy", queue_depth: 2, error: null } })),
    "Generating",
  );
});
