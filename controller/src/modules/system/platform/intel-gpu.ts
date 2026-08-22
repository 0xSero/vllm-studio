import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { Effect } from "effect";
import type { GpuInfo } from "../../models/types";
import { resolveBinary, runCommandAsyncEffect } from "../../../core/command";

type IntelPciGpu = {
  path: string;
  address: string;
  deviceId: string;
  classCode: string;
  driver: string | null;
};

const PCI_DEVICES_DIR = "/sys/bus/pci/devices";
const DRM_DIR = "/sys/class/drm";

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
};

const readNumber = (path: string): number | null => {
  const text = readText(path);
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

const readDeviceDriver = (devicePath: string): string | null => {
  try {
    return basename(realpathSync(join(devicePath, "driver")));
  } catch {
    return null;
  }
};

const isIntelComputeGpu = (gpu: IntelPciGpu): boolean => {
  if (gpu.driver === "xe") return true;
  if (gpu.deviceId.toLowerCase() === "0xe223") return true;
  return gpu.classCode.toLowerCase().startsWith("0x03");
};

const discoverIntelPciGpus = (): IntelPciGpu[] => {
  try {
    return readdirSync(PCI_DEVICES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isSymbolicLink() || entry.isDirectory())
      .map((entry) => {
        const path = join(PCI_DEVICES_DIR, entry.name);
        const vendor = readText(join(path, "vendor"))?.toLowerCase();
        if (vendor !== "0x8086") return null;

        const gpu: IntelPciGpu = {
          path,
          address: entry.name,
          deviceId: readText(join(path, "device")) ?? "",
          classCode: readText(join(path, "class")) ?? "",
          driver: readDeviceDriver(path),
        };
        return isIntelComputeGpu(gpu) ? gpu : null;
      })
      .filter((entry): entry is IntelPciGpu => Boolean(entry))
      .sort((a, b) => a.address.localeCompare(b.address));
  } catch {
    return [];
  }
};

const findDrmDevicePaths = (pciPath: string): string[] => {
  try {
    return readdirSync(DRM_DIR, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith("card"))
      .map((entry) => join(DRM_DIR, entry.name, "device"))
      .filter((devicePath) => {
        try {
          return realpathSync(devicePath) === realpathSync(pciPath);
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
};

const readFirstNumber = (paths: string[]): number | null => {
  for (const path of paths) {
    const value = readNumber(path);
    if (value !== null) return value;
  }
  return null;
};

const findHwmonPaths = (pciPath: string): string[] => {
  try {
    return readdirSync(join(pciPath, "hwmon"), { withFileTypes: true })
      .filter((entry) => entry.name.startsWith("hwmon"))
      .map((entry) => join(pciPath, "hwmon", entry.name));
  } catch {
    return [];
  }
};

const readHwmonMetric = (hwmonPaths: string[], fileName: string): number | null =>
  readFirstNumber(hwmonPaths.map((path) => join(path, fileName)));

const readIntelName = (gpu: IntelPciGpu): Effect.Effect<string> => {
  const fallback = gpu.deviceId.toLowerCase() === "0xe223" ? "Intel Arc Pro B70" : "Intel Arc GPU";
  const lspci = resolveBinary("lspci");
  if (!lspci) return Effect.succeed(fallback);
  return runCommandAsyncEffect(lspci, ["-s", gpu.address.replace(/^0000:/, "")], {
    timeoutMs: 2_000,
  }).pipe(
    Effect.map((result) => {
      if (result.status !== 0 || !result.stdout) return fallback;
      return result.stdout.replace(/^[0-9a-f:.]+\s+/i, "").trim() || fallback;
    }),
  );
};

export const getGpuInfoFromIntelSysfs = (): Effect.Effect<GpuInfo[]> =>
  Effect.sync(discoverIntelPciGpus).pipe(
    Effect.flatMap((gpus) =>
      Effect.forEach(gpus, (gpu, index) =>
        Effect.gen(function* () {
          const drmDevicePaths = findDrmDevicePaths(gpu.path);
          const readDrm = (fileName: string): number =>
            readFirstNumber(drmDevicePaths.map((path) => join(path, fileName))) ?? 0;
          const hwmonPaths = findHwmonPaths(gpu.path);
          // hwmon reports millidegrees and microwatts.
          const watts = (fileName: string): number =>
            Number(((readHwmonMetric(hwmonPaths, fileName) ?? 0) / 1_000_000).toFixed(1));
          const memoryTotal = readDrm("mem_info_vram_total");
          const memoryUsed = readDrm("mem_info_vram_used");
          const toMb = (bytes: number): number => Math.max(0, Math.round(bytes / 1024 / 1024));

          return {
            index,
            name: yield* readIntelName(gpu),
            memory_total_mb: toMb(memoryTotal),
            memory_used_mb: toMb(memoryUsed),
            memory_free_mb: toMb(Math.max(0, memoryTotal - memoryUsed)),
            utilization_pct: 0,
            temp_c: Math.round((readHwmonMetric(hwmonPaths, "temp1_input") ?? 0) / 1000),
            power_draw: watts("power1_input"),
            power_limit: watts("power1_cap"),
          };
        }),
      ),
    ),
  );
