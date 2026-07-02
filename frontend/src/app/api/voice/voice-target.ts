import type { ApiSettings } from "@local-studio/agent-runtime/settings-service";
import { normalizeHttpUrl } from "@/lib/api/http";

export type VoiceTargetKind = "controller-local" | "external-voice";

export interface VoiceTarget {
  baseUrl: string;
  kind: VoiceTargetKind;
}

export const resolveVoiceTarget = (settings: ApiSettings): VoiceTarget | null => {
  const backendUrl = normalizeHttpUrl(settings.backendUrl);
  const configuredVoiceUrl = normalizeHttpUrl(settings.voiceUrl);

  if (configuredVoiceUrl) {
    if (backendUrl && configuredVoiceUrl === backendUrl) {
      return { baseUrl: configuredVoiceUrl, kind: "controller-local" };
    }
    return { baseUrl: configuredVoiceUrl, kind: "external-voice" };
  }

  if (!backendUrl) {
    return null;
  }

  return { baseUrl: backendUrl, kind: "controller-local" };
};
