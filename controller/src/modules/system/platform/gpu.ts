import { existsSync } from "node:fs";
import { freemem, totalmem } from "node:os";
import type { GpuInfo, RuntimeGpuMonitoringTool } from "../../models/types";
import { runCommand } from "../../../core/command";
import { getGpuInfoFromAmdSmi, getGpuInfoFromRocmSmi } from "./amd-gpu";
import { getGpuInfoFromIntelSysfs } from "./intel-gpu";
import { resolveRocmSmiTool } from "./rocm-info";
import {
  resolveAmdSmiBinary,
  resolveForcedGpuMonitoringTool,
  resolveNvidiaSmiBinary,
  resolveRocmSmiBinary,
} from "./smi-tools";

export const getGpuInfoFromNvidiaSmi = (): GpuInfo[] => {
  const query = [
    "name",
    "memory.total",
    "memory.used",
    "memory.free",
    "utilization.gpu",
    "temperature.gpu",
    "power.draw",
    "power.limit",
  ].join(",");

  try {
    const nvidiaSmi = resolveNvidiaSmiBinary();
    if (!nvidiaSmi) return [];

    const result = runCommand(
      nvidiaSmi,
      [`--query-gpu=${query}`, "--format=csv,noheader,nounits"],
      5_000
    );
    if (result.status !== 0 || !result.stdout) return [];

    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.map((line, index) => {
      const parts = line.split(",").map((value) => value.trim());
      const [
        rawName,
        memoryTotal,
        memoryUsed,
        memoryFree,
        utilization,
        temperature,
        powerDraw,
        powerLimit,
      ] = parts;
      const name = rawName ?? "Unknown";
      const toFiniteNumber = (value: string | undefined): number => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
      };
      const toBytes = (megabytes: string | undefined): number =>
        Math.max(0, Math.round(toFiniteNumber(megabytes) * 1024 * 1024));
      const toMb = (megabytes: string | undefined): number =>
        Math.max(0, Math.round(toFiniteNumber(megabytes)));
      const reportedTotalMb = toMb(memoryTotal);
      const isUnifiedMemoryNvidia = reportedTotalMb === 0 && /\b(?:GB10|Grace)\b/i.test(name);
      const fallbackTotalMb = isUnifiedMemoryNvidia ? Math.round(totalmem() / 1024 / 1024) : 0;
      const fallbackFreeMb = isUnifiedMemoryNvidia ? Math.round(freemem() / 1024 / 1024) : 0;
      const fallbackUsedMb = Math.max(0, fallbackTotalMb - fallbackFreeMb);
      const memoryTotalMb = reportedTotalMb || fallbackTotalMb;
      const memoryUsedMb = toMb(memoryUsed) || fallbackUsedMb;
      const memoryFreeMb = toMb(memoryFree) || fallbackFreeMb;
      return {
        index,
        name,
        memory_total: memoryTotalMb * 1024 * 1024,
        memory_total_mb: memoryTotalMb,
        memory_used: memoryUsedMb * 1024 * 1024,
        memory_used_mb: memoryUsedMb,
        memory_free: memoryFreeMb * 1024 * 1024,
        memory_free_mb: memoryFreeMb,
        utilization: toFiniteNumber(utilization),
        utilization_pct: toFiniteNumber(utilization),
        temperature: toFiniteNumber(temperature),
        temp_c: toFiniteNumber(temperature),
        power_draw: toFiniteNumber(powerDraw),
        power_limit: toFiniteNumber(powerLimit),
      };
    });
  } catch {
    return [];
  }
};

/** Tool the cascade in getGpuInfo would use, without running any query commands. */
export const detectGpuMonitoringTool = (): RuntimeGpuMonitoringTool | null => {
  const forced = resolveForcedGpuMonitoringTool();
  if (forced) return forced;
  if (resolveNvidiaSmiBinary()) return "nvidia-smi";
  const rocmTool = resolveRocmSmiTool();
  if (rocmTool) return rocmTool;
  if (getGpuInfoFromIntelSysfs().length > 0) return "intel-sysfs";
  return null;
};

// Logged once per process so CPU-only and missing-driver hosts are distinguishable
// from "zero GPUs" without spamming every poll.
let warnedNoGpuTooling = false;

const warnNoGpuToolingOnce = (): void => {
  if (warnedNoGpuTooling) return;
  warnedNoGpuTooling = true;
  const attempted = [
    `nvidia-smi=${resolveNvidiaSmiBinary() ? "found" : "not found"}`,
    `amd-smi=${resolveAmdSmiBinary() ? "found" : "not found"}`,
    `rocm-smi=${resolveRocmSmiBinary() ? "found" : "not found"}`,
    `intel-sysfs=${existsSync("/sys/bus/pci/devices") ? "no compute GPUs" : "unavailable"}`,
  ].join(" ");
  console.warn(`No GPUs reported by any monitoring tool; attempted: ${attempted}`);
};

const collectGpuInfo = (): GpuInfo[] => {
  const forced = resolveForcedGpuMonitoringTool();
  if (forced === "nvidia-smi") {
    return getGpuInfoFromNvidiaSmi();
  }
  if (forced === "amd-smi") {
    return getGpuInfoFromAmdSmi();
  }
  if (forced === "rocm-smi") {
    return getGpuInfoFromRocmSmi();
  }
  if (forced === "intel-sysfs") {
    return getGpuInfoFromIntelSysfs();
  }

  const nvidia = getGpuInfoFromNvidiaSmi();
  if (nvidia.length > 0) {
    return nvidia;
  }

  const rocmTool = resolveRocmSmiTool();
  if (rocmTool === "amd-smi") {
    const amd = getGpuInfoFromAmdSmi();
    if (amd.length > 0) return amd;
    return getGpuInfoFromRocmSmi();
  }
  if (rocmTool === "rocm-smi") {
    const rocm = getGpuInfoFromRocmSmi();
    if (rocm.length > 0) return rocm;
    return getGpuInfoFromAmdSmi();
  }

  const intel = getGpuInfoFromIntelSysfs();
  if (intel.length > 0) {
    return intel;
  }

  return [];
};

export const getGpuInfo = (): GpuInfo[] => {
  const gpus = collectGpuInfo();
  if (gpus.length === 0) {
    warnNoGpuToolingOnce();
  }
  return gpus;
};
