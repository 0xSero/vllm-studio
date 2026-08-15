import { LocalTranscriptionError, transcribeLocally } from "../local-transcribe";
import { jsonError } from "./helpers";

const MAX_RECORDING_BYTES = 25 * 1024 * 1024;

export async function handleTranscribe(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Expected a multipart body with a `file` field");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Multipart field 'file' is required");
  if (file.size > MAX_RECORDING_BYTES) {
    return jsonError("Recording must be 25 MB or smaller", 413);
  }

  try {
    const result = await transcribeLocally({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name || "recording.webm",
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof LocalTranscriptionError) return jsonError(error.message, error.status);
    return jsonError(error instanceof Error ? error.message : "Transcription failed", 500);
  }
}
