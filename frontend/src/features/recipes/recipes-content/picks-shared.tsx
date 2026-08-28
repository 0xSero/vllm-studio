"use client";

import { useMemo, useState } from "react";
import api from "@/lib/api/client";
import type { GPU } from "@/lib/types";
import { useMountSubscription } from "@/hooks/use-mount-subscription";
import { sumGpuMemoryPoolGb } from "./explore-eligibility";
import { readExplorePoolOverrideGb } from "./explore-pool-storage";
import { buildHardwareProfile } from "./hardware-profile";

export function useHardwareProfile() {
  const [gpus, setGpus] = useState<GPU[]>([]);
  const [apiMaxVramGb, setApiMaxVramGb] = useState(0);
  const [poolOverrideGb, setPoolOverrideGb] = useState<number | null>(null);

  useMountSubscription(() => {
    setPoolOverrideGb(readExplorePoolOverrideGb());
  }, []);

  useMountSubscription(() => {
    void (async () => {
      const [presetsData, gpuData] = await Promise.all([
        api.getStarterPresets().catch(() => null),
        api.getGPUs().catch(() => ({ gpus: [] as GPU[] })),
      ]);
      setApiMaxVramGb(typeof presetsData?.max_vram_gb === "number" ? presetsData.max_vram_gb : 0);
      setGpus(gpuData.gpus ?? []);
    })();
  }, []);

  return useMemo(() => {
    const poolGbFromGpus = sumGpuMemoryPoolGb(gpus);
    const detectedPoolGb = poolGbFromGpus > 0 ? poolGbFromGpus : apiMaxVramGb;
    const poolGb =
      poolOverrideGb != null && poolOverrideGb > 0
        ? poolOverrideGb
        : detectedPoolGb > 0
          ? detectedPoolGb
          : 0;
    return buildHardwareProfile({ gpus, poolGb, detectedPoolGb, poolOverrideGb });
  }, [gpus, apiMaxVramGb, poolOverrideGb]);
}
