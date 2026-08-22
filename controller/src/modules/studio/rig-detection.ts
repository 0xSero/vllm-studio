import { arch, cpus, hostname, platform, release, totalmem } from "node:os";
import type { Rig, RigAccelerator, RigHardwareType, RigNode } from "@local-studio/contracts/rigs";
import type { GpuInfo } from "../models/types";
import { Effect } from "effect";
import { getGpuInfo } from "../system/platform/gpu";

export const LOCAL_RIG_NODE_ID = "local";
const DEFAULT_RIG_ID = "default";

interface KnownAcceleratorSpec {
  pattern: RegExp;
  hardware_type: RigHardwareType;
  memory_type: string;
  memory_bandwidth_gbs: number;
  unified_memory: boolean;
}

// [pattern, hardware_type, memory_type, memory_bandwidth_gbs, unified_memory]
const KNOWN_ACCELERATORS: KnownAcceleratorSpec[] = (
  [
    [/\b(?:GB10|DGX Spark)\b/i, "dgx-spark", "LPDDR5X", 273, true],
    [/RTX PRO 6000/i, "gpu-server", "GDDR7", 1792, false],
    [/RTX 5090/i, "gpu-desktop", "GDDR7", 1792, false],
    [/RTX 4090/i, "gpu-desktop", "GDDR6X", 1008, false],
    [/RTX 3090/i, "gpu-desktop", "GDDR6X", 936, false],
    [/\bApple\b/i, "mac", "unified", 0, true],
  ] as const
).map(([pattern, hardware_type, memory_type, memory_bandwidth_gbs, unified_memory]) => ({
  pattern,
  hardware_type,
  memory_type,
  memory_bandwidth_gbs,
  unified_memory,
}));

const findKnownAccelerator = (name: string): KnownAcceleratorSpec | null =>
  KNOWN_ACCELERATORS.find((spec) => spec.pattern.test(name)) ?? null;

const groupAccelerators = (gpus: GpuInfo[]): RigAccelerator[] => {
  const groups = new Map<string, { count: number; memoryMb: number }>();
  for (const gpu of gpus) {
    const entry = groups.get(gpu.name) ?? { count: 0, memoryMb: gpu.memory_total_mb };
    entry.count += 1;
    groups.set(gpu.name, entry);
  }
  return [...groups.entries()].map(([name, entry]) => {
    const known = findKnownAccelerator(name);
    return {
      name,
      count: entry.count,
      memory_gb: entry.memoryMb > 0 ? Math.round(entry.memoryMb / 1024) : null,
      memory_type: known?.memory_type ?? null,
      memory_bandwidth_gbs:
        known && known.memory_bandwidth_gbs > 0 ? known.memory_bandwidth_gbs : null,
      unified_memory: known?.unified_memory ?? false,
    };
  });
};

const appleSiliconAccelerator = (cpuModel: string | null): RigAccelerator[] =>
  platform() === "darwin" && arch() === "arm64"
    ? [
        {
          name: cpuModel ?? "Apple Silicon",
          count: 1,
          memory_gb: Math.round(totalmem() / 1024 ** 3),
          memory_type: "unified",
          memory_bandwidth_gbs: null,
          unified_memory: true,
        },
      ]
    : [];

const inferHardwareType = (accelerators: RigAccelerator[]): RigHardwareType => {
  for (const accelerator of accelerators) {
    const known = findKnownAccelerator(accelerator.name)?.hardware_type;
    if (known === "dgx-spark" || known === "mac") return known;
  }
  const gpuCount = accelerators.reduce((sum, accelerator) => sum + accelerator.count, 0);
  if (gpuCount >= 3) return "gpu-server";
  if (gpuCount >= 1) return "gpu-desktop";
  return "custom";
};

export const buildDetectedNode = (): Effect.Effect<RigNode> =>
  getGpuInfo().pipe(
    Effect.map((gpus) => {
      const cpuList = cpus();
      const cpuModel = cpuList[0]?.model ?? null;
      const gpuAccelerators = groupAccelerators(gpus);
      const accelerators =
        gpuAccelerators.length > 0 ? gpuAccelerators : appleSiliconAccelerator(cpuModel);
      const host = hostname();
      return {
        id: LOCAL_RIG_NODE_ID,
        name: host,
        hardware_type: inferHardwareType(accelerators),
        role: "standalone",
        source: "detected",
        hostname: host,
        address: null,
        os: `${platform()} ${release()}`,
        cpu_model: cpuModel,
        cpu_cores: cpuList.length,
        memory_gb: Math.round(totalmem() / 1024 ** 3),
        accelerators,
        notes: null,
      };
    }),
  );

export const seedDefaultRig = (detected: RigNode): Rig => {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_RIG_ID,
    name: "My Rig",
    description: null,
    nodes: [detected],
    created_at: now,
    updated_at: now,
  };
};

/** Refresh the detected fields of the stored local node in place, if any rig has one. */
export const refreshLocalNode = (rigs: Rig[], detected: RigNode): Rig | null => {
  for (const rig of rigs) {
    const index = rig.nodes.findIndex((node) => node.id === LOCAL_RIG_NODE_ID);
    const stored = index >= 0 ? rig.nodes[index] : undefined;
    if (!stored) continue;
    rig.nodes[index] = {
      ...stored,
      hostname: detected.hostname,
      os: detected.os,
      cpu_model: detected.cpu_model,
      cpu_cores: detected.cpu_cores,
      memory_gb: detected.memory_gb,
      accelerators: detected.accelerators,
    };
    return rig;
  }
  return null;
};
