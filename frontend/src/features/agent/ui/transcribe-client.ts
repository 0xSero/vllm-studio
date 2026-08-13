// Dictation posts to the agent runtime on this machine rather than to the
// controller. The controller path needed a GPU box and a model configured on
// it; nobody ever configured one, so the mic button 400'd on every press.

const TRANSCRIPTION_TIMEOUT_MS = 120_000;
const MAX_RECORDING_BYTES = 25 * 1024 * 1024;

type TranscribeResponse = { text?: unknown; engine?: unknown; error?: unknown };

export async function transcribeRecording(recording: File, signal?: AbortSignal): Promise<string> {
  if (!recording.size) throw new Error("Recording is empty");
  if (recording.size > MAX_RECORDING_BYTES) {
    throw new Error("Recording must be 25 MB or smaller");
  }
  const form = new FormData();
  form.set("file", recording, recording.name);

  const timeout = AbortSignal.timeout(TRANSCRIPTION_TIMEOUT_MS);
  const response = await fetch("/api/agent/transcribe", {
    method: "POST",
    body: form,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });

  let payload: TranscribeResponse = {};
  try {
    payload = (await response.json()) as TranscribeResponse;
  } catch {
    // Fall through to the status-based message below.
  }
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : null;
    throw new Error(message ?? `Transcription failed (${response.status})`);
  }
  return typeof payload.text === "string" ? payload.text : "";
}
