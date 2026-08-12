import type { Effect } from "effect";
import type {
  AudioIntegrationError,
  SttTranscriptionResult,
  TtsSynthesisRequest,
} from "../../services/audio-cli";

export interface AudioRouteDependencies {
  transcribe?: (request: {
    audioPath: string;
    modelPath: string;
    language?: string;
  }) => Effect.Effect<SttTranscriptionResult, AudioIntegrationError>;
  transcodeToWav?: (options: {
    sourcePath: string;
    outputPath: string;
  }) => Effect.Effect<string, AudioIntegrationError>;
  synthesize?: (request: TtsSynthesisRequest) => Effect.Effect<void, AudioIntegrationError>;
}
