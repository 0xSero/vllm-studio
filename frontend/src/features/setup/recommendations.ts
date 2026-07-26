"use client";

import { useState } from "react";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import type { StudioDiagnostics } from "@/lib/types";
import { safeJson } from "@/features/agent/safe-json";

/**
 * Client view of the benchmark-led picks. The full dataset lives server-side only
 * (see app/api/setup/recommendations); the client fetches the prefiltered display rows
 * for this rig — nothing else ships in the bundle.
 */

export interface SetupRecommendation {
  readonly hfId: string;
  readonly name: string;
  readonly quant: string;
  readonly filesize: string;
  readonly requiredGb: number;
  readonly decodeTps: number | null;
  readonly engine: string | null;
  readonly measuredOnThisClass: boolean;
}

export interface RigQuery {
  readonly poolGb: number;
  readonly gpuCount: number;
  readonly unified: boolean;
  readonly apple: boolean;
}

export const rigFromDiagnostics = (
  diagnostics: StudioDiagnostics | null,
  maxVramGb: number,
): RigQuery => {
  const apple = diagnostics?.platform === "darwin" && diagnostics.arch === "arm64";
  const ramGb = diagnostics ? diagnostics.memory_total / 1024 ** 3 : 0;
  return {
    // Unified hosts budget RAM; discrete rigs budget summed VRAM.
    poolGb: apple ? ramGb : maxVramGb,
    gpuCount: diagnostics?.gpus.length ?? 0,
    unified: apple,
    apple,
  };
};

export function useSetupRecommendations(
  diagnostics: StudioDiagnostics | null,
  maxVramGb: number,
): readonly SetupRecommendation[] {
  const [picks, setPicks] = useState<readonly SetupRecommendation[]>([]);
  const rig = rigFromDiagnostics(diagnostics, maxVramGb);
  const query = `poolGb=${Math.round(rig.poolGb)}&gpuCount=${rig.gpuCount}&unified=${rig.unified ? 1 : 0}&apple=${rig.apple ? 1 : 0}`;

  useMountSubscription(() => {
    if (rig.poolGb <= 0) return;
    let cancelled = false;
    void fetch(`/api/setup/recommendations?${query}`, { cache: "no-store" })
      .then((response) => safeJson<{ picks?: SetupRecommendation[] }>(response))
      .then((payload) => {
        if (!cancelled) setPicks(payload.picks ?? []);
      })
      .catch(() => {
        if (!cancelled) setPicks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [query, rig.poolGb]);

  return picks;
}
