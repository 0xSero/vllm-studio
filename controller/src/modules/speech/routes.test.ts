import { expect, test } from "bun:test";
import { Hono } from "hono";
import {
  CHATTERBOX_BACKEND,
  CHATTERBOX_MODEL_REVISION,
  CHATTERBOX_PACKAGE_VERSION,
  type SpeechStatus,
  type SpeechVoiceProfile,
} from "@local-studio/contracts/speech";
import { registerSpeechRoutes, type SpeechRoutesContext } from "./routes";

const voice: SpeechVoiceProfile = {
  id: "voice_00000000000000000000000000000000",
  name: "Sero",
  duration_ms: 8_000,
  created_at: "2026-07-09T12:00:00.000Z",
};

const status = (phase: SpeechStatus["install"]["phase"] = "missing"): SpeechStatus => ({
  backend: CHATTERBOX_BACKEND,
  package_version: CHATTERBOX_PACKAGE_VERSION,
  model_revision: CHATTERBOX_MODEL_REVISION,
  install: {
    phase,
    progress: phase === "installing" ? 0.35 : 0,
    message: phase === "installing" ? "Installing Chatterbox Turbo" : "Setup required",
    error: null,
  },
  worker: { phase: "stopped", queue_depth: 0, error: null },
  gpu: null,
  prerequisites: {
    ffmpeg: true,
    python_311: true,
    storage: { available_bytes: 100, required_bytes: 50, ready: true },
  },
  voice_count: 1,
});

const testApp = (): {
  app: Hono;
  created: Array<{ name: string; consent: string; size: number }>;
  installs: boolean[];
  cancellations: number[];
} => {
  const app = new Hono();
  const created: Array<{ name: string; consent: string; size: number }> = [];
  const installs: boolean[] = [];
  const cancellations: number[] = [];
  let current = status();
  const context: SpeechRoutesContext = {
    logger: { error: () => undefined },
    speechService: {
      getStatus: () => current,
      install: async (input) => {
        installs.push(input?.repair ?? false);
        current = status("installing");
        return current;
      },
      cancelInstall: async () => {
        cancellations.push(cancellations.length + 1);
        current = status();
      },
      listVoices: () => [voice],
      createVoice: async (input) => {
        created.push({ name: input.name, consent: input.consent, size: input.audio.byteLength });
        return voice;
      },
      deleteVoice: async (id) => id === voice.id,
      stop: async () => undefined,
    },
  };
  registerSpeechRoutes(app, context);
  return { app, created, installs, cancellations };
};

test("returns status and starts installation without holding the request", async () => {
  const { app, installs } = testApp();
  expect(await (await app.request("/v1/audio/status")).json()).toEqual({ status: status() });
  const response = await app.request("/v1/audio/install", { method: "POST" });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ status: status("installing") });
  expect(installs).toEqual([false]);
});

test("repairs and cancels runtime installation explicitly", async () => {
  const { app, installs, cancellations } = testApp();
  const repair = await app.request("/v1/audio/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repair: true }),
  });
  expect(repair.status).toBe(202);
  expect(installs).toEqual([true]);
  const cancel = await app.request("/v1/audio/install/cancel", { method: "POST" });
  expect(cancel.status).toBe(200);
  expect(cancellations).toEqual([1]);
});

test("creates, lists, and deletes consented voice profiles", async () => {
  const { app, created } = testApp();
  const form = new FormData();
  form.set("name", "Sero");
  form.set("consent", "self_voice_v1");
  form.set("reference", new File(["voice"], "voice.wav", { type: "audio/wav" }));
  const create = await app.request("/v1/audio/voices", { method: "POST", body: form });
  expect(create.status).toBe(201);
  expect(await create.json()).toEqual({ voice });
  expect(created).toEqual([{ name: "Sero", consent: "self_voice_v1", size: 5 }]);
  expect(await (await app.request("/v1/audio/voices")).json()).toEqual({ voices: [voice] });
  expect(
    (
      await app.request(`/v1/audio/voices/${encodeURIComponent(voice.id)}`, {
        method: "DELETE",
      })
    ).status,
  ).toBe(204);
});

test("rejects a voice profile before decoding when consent is absent", async () => {
  const { app, created } = testApp();
  const form = new FormData();
  form.set("name", "Sero");
  form.set("reference", new File(["voice"], "voice.wav", { type: "audio/wav" }));
  const response = await app.request("/v1/audio/voices", { method: "POST", body: form });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    code: "voice_consent_required",
    error: "Confirm that the recording is your voice before saving it",
  });
  expect(created).toEqual([]);
});
