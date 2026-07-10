import type { Hono } from "hono";
import { Schema } from "effect";
import type { Logger } from "../../core/logger";
import {
  boundedFormData,
  readBoundedRequestBody,
  RequestBodyTooLargeError,
} from "../../http/bounded-body";
import { MAX_VOICE_UPLOAD_BYTES, VoiceReferenceError } from "./reference-audio";
import { SpeechServiceError } from "./service";
import type { SpeechInstallInput, SpeechService } from "./service";
import { VOICE_CONSENT_VERSION, VoiceProfileError } from "./voice-store";

const VOICE_REQUEST_LIMIT = MAX_VOICE_UPLOAD_BYTES + 1024 * 1024;
const INSTALL_REQUEST_LIMIT = 1024;
const InstallRequestSchema = Schema.Struct({ repair: Schema.optional(Schema.Boolean) });

type SpeechError = {
  status: number;
  code: string;
  message: string;
};

export interface SpeechRoutesContext {
  logger: Pick<Logger, "error">;
  speechService: Pick<
    SpeechService,
    | "cancelInstall"
    | "createVoice"
    | "deleteVoice"
    | "getStatus"
    | "install"
    | "listVoices"
    | "stop"
  >;
}

const speechError = (error: unknown): SpeechError | null => {
  if (
    error instanceof SpeechServiceError ||
    error instanceof VoiceReferenceError ||
    error instanceof VoiceProfileError
  ) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof RequestBodyTooLargeError) {
    return {
      status: 413,
      code: "voice_upload_too_large",
      message: "Voice reference must be 20 MB or smaller",
    };
  }
  return null;
};

const errorResponse = (error: SpeechError): Response =>
  Response.json({ code: error.code, error: error.message }, { status: error.status });

const formText = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const installInput = async (request: Request): Promise<SpeechInstallInput> => {
  let bytes: ArrayBuffer;
  try {
    bytes = await readBoundedRequestBody(request, INSTALL_REQUEST_LIMIT);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      throw new SpeechServiceError(
        413,
        "speech_install_request_too_large",
        "Install request exceeds 1 KB",
      );
    }
    throw error;
  }
  if (!bytes.byteLength) return {};
  try {
    return Schema.decodeUnknownSync(InstallRequestSchema)(
      JSON.parse(new TextDecoder().decode(bytes)),
    );
  } catch {
    throw new SpeechServiceError(400, "speech_install_request_invalid", "Invalid install request");
  }
};

const createVoice = async (context: SpeechRoutesContext, request: Request): Promise<Response> => {
  const form = await boundedFormData(request, VOICE_REQUEST_LIMIT);
  const reference = form.get("reference");
  if (!(reference instanceof File)) {
    throw new VoiceProfileError(
      400,
      "voice_reference_required",
      "Multipart field 'reference' is required",
    );
  }
  if (reference.size > MAX_VOICE_UPLOAD_BYTES) {
    throw new VoiceProfileError(
      413,
      "voice_upload_too_large",
      "Voice reference must be 20 MB or smaller",
    );
  }
  const name = formText(form, "name");
  if (!name || name.length > 80) {
    throw new VoiceProfileError(400, "voice_name_invalid", "Voice name must be 1 to 80 characters");
  }
  const consent = formText(form, "consent");
  if (consent !== VOICE_CONSENT_VERSION) {
    throw new VoiceProfileError(
      400,
      "voice_consent_required",
      "Confirm that the recording is your voice before saving it",
    );
  }
  const voice = await context.speechService.createVoice({
    name,
    consent,
    audio: new Uint8Array(await reference.arrayBuffer()),
  });
  return Response.json({ voice }, { status: 201 });
};

const handleSpeechRoute =
  (context: SpeechRoutesContext, operation: () => Promise<Response> | Response) =>
  async (): Promise<Response> => {
    try {
      return await operation();
    } catch (error) {
      const known = speechError(error);
      if (known) return errorResponse(known);
      context.logger.error("speech route failed", { error: String(error) });
      return errorResponse({
        status: 500,
        code: "speech_internal_error",
        message: "Internal speech error",
      });
    }
  };

export const registerSpeechRoutes = (app: Hono, context: SpeechRoutesContext): void => {
  app.get(
    "/v1/audio/status",
    handleSpeechRoute(context, () => Response.json({ status: context.speechService.getStatus() })),
  );

  app.post("/v1/audio/install", (ctx) =>
    handleSpeechRoute(context, async () => {
      const status = await context.speechService.install(await installInput(ctx.req.raw));
      return Response.json(
        { status },
        { status: status.install.phase === "installing" ? 202 : 200 },
      );
    })(),
  );

  app.post(
    "/v1/audio/install/cancel",
    handleSpeechRoute(context, async () => {
      await context.speechService.cancelInstall();
      return Response.json({ status: context.speechService.getStatus() });
    }),
  );

  app.get(
    "/v1/audio/voices",
    handleSpeechRoute(context, () => Response.json({ voices: context.speechService.listVoices() })),
  );

  app.post("/v1/audio/voices", (ctx) =>
    handleSpeechRoute(context, () => createVoice(context, ctx.req.raw))(),
  );

  app.delete("/v1/audio/voices/:voiceId", (ctx) =>
    handleSpeechRoute(context, async () => {
      const deleted = await context.speechService.deleteVoice(ctx.req.param("voiceId"));
      return deleted
        ? new Response(null, { status: 204 })
        : errorResponse({
            status: 404,
            code: "voice_not_found",
            message: "Voice profile not found",
          });
    })(),
  );

  app.post(
    "/v1/audio/runtime/stop",
    handleSpeechRoute(context, async () => {
      await context.speechService.stop();
      return Response.json({ status: context.speechService.getStatus() });
    }),
  );
};
