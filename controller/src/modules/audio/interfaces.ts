import type { SttTranscriptionResult } from "../../services/stt";
import type { TtsSynthesisRequest } from "../../services/tts";

export interface AudioRouteDependencies {
  transcribe?: (request: {
    audioPath: string;
    modelPath: string;
    language?: string;
  }) => Promise<SttTranscriptionResult>;
  transcodeToWav?: (options: {
    sourcePath: string;
    outputPath: string;
  }) => Promise<string>;
  synthesize?: (request: TtsSynthesisRequest) => Promise<void>;
}
