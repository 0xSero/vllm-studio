import { describe, expect, test } from "bun:test";
import { fixtureJson } from "./fixtures";
import type { RegistryHardware } from "@local-studio/contracts/registry";
import {
  detectedFromGpus,
  detectedAppleSilicon,
  fitStateFor,
  matchAccelerators,
} from "../src/modules/registry/hardware-match";

const hardware = (overrides: Partial<RegistryHardware> & { id: string }): RegistryHardware =>
  ({
    schema_version: "local-ai-registry/v1",
    vendor: "nvidia",
    name: overrides.id,
    kind: "discrete",
    accelerator_backend: "nvidia",
    memory: { vram_gb: 24, vram_type: "GDDR6X", cpu_memory_gb: null, bandwidth_gb_per_s: 1008 },
    ...overrides,
  }) as RegistryHardware;

describe("hardware matching", () => {
  test("matches the real fixture record for an RTX 5090", () => {
    const rtx5090 = fixtureJson("hardware--rtx-5090-32gb.json") as RegistryHardware;
    const matches = matchAccelerators(
      [{ name: "NVIDIA GeForce RTX 5090", memoryGb: 32, count: 1 }],
      [rtx5090],
    );
    expect(matches[0]?.matched).toBe(true);
    expect(matches[0]?.hardware_id).toBe("rtx-5090-32gb");
    expect(matches[0]?.detected_count).toBe(1);
  });

  test("memory mismatch downgrades a name match", () => {
    const rtx5090 = hardware({ id: "rtx-5090-32gb", name: "GeForce RTX 5090", memory: { vram_gb: 32, vram_type: "GDDR7", cpu_memory_gb: null, bandwidth_gb_per_s: 1792 } });
    const matches = matchAccelerators(
      [{ name: "GeForce RTX 5090", memoryGb: 24, count: 1 }],
      [rtx5090],
    );
    // 24 GB board never satisfies the 32 GB registry record.
    expect(matches[0]?.matched).toBe(false);
  });

  test("aliases carry the match when the driver name differs", () => {
    const card = hardware({
      id: "rtx-4000-ada-20gb",
      name: "RTX 4000 Ada",
      aliases: ["rtx 4000 ada generation"],
      memory: { vram_gb: 20, vram_type: "GDDR6", cpu_memory_gb: null, bandwidth_gb_per_s: 360 },
    });
    const matches = matchAccelerators(
      [{ name: "NVIDIA RTX 4000 Ada Generation", memoryGb: 20, count: 2 }],
      [card],
    );
    expect(matches[0]?.matched).toBe(true);
    expect(matches[0]?.detected_count).toBe(2);
  });

  test("apple silicon matches unified-memory records by chip and RAM", () => {
    const m4pro = fixtureJson("hardware--rtx-5090-32gb.json") as RegistryHardware;
    const appleRecord = hardware({
      id: "apple-m4-pro-48gb",
      vendor: "apple",
      name: "Apple M4 Pro",
      kind: "unified",
      accelerator_backend: "metal",
      memory: { vram_gb: 48, vram_type: "unified", cpu_memory_gb: 48, bandwidth_gb_per_s: 273 },
    });
    const detected = detectedAppleSilicon("Apple M4 Pro", {
      platform: "darwin",
      arch: "arm64",
      totalMemoryBytes: 48 * 1024 ** 3,
    });
    expect(detected[0]?.name).toBe("Apple M4 Pro");
    const matches = matchAccelerators(detected, [m4pro, appleRecord]);
    expect(matches[0]?.hardware_id).toBe("apple-m4-pro-48gb");
    expect(matches[0]?.matched).toBe(true);
  });

  test("unknown accelerators stay visible as unmatched", () => {
    const matches = matchAccelerators(
      [{ name: "Matrox G200", memoryGb: 0, count: 1 }],
      [hardware({ id: "rtx-5090-32gb", name: "GeForce RTX 5090" })],
    );
    expect(matches[0]?.matched).toBe(false);
    expect(matches[0]?.detected_name).toBe("Matrox G200");
  });

  test("detected groups collapse identical GPUs and keep counts", () => {
    const gpu = {
      index: 0,
      name: "NVIDIA GeForce RTX 3090",
      memory_total_mb: 24576,
      memory_used_mb: 0,
      memory_free_mb: 24576,
      utilization_pct: 0,
      temp_c: 0,
      power_draw: 0,
      power_limit: 350,
    };
    const gpus = [gpu, { ...gpu, index: 1 }];
    expect(detectedFromGpus(gpus)).toEqual([
      { name: "NVIDIA GeForce RTX 3090", memoryGb: 24, count: 2 },
    ]);
  });

  test("fitStateFor requires enough identical cards for the row's count", () => {
    const matches = [
      {
        hardware_id: "rtx-3090-24gb",
        registry_name: "GeForce RTX 3090",
        detected_name: "GeForce RTX 3090",
        vendor: "nvidia",
        memory_gb: 24,
        registry_memory_gb: 24,
        detected_count: 2,
        matched: true,
        reason: "name",
      },
    ];
    expect(fitStateFor({ hardware_id: "rtx-3090-24gb", hardware_count: 2 }, matches)).toBe("match");
    expect(fitStateFor({ hardware_id: "rtx-3090-24gb", hardware_count: 4 }, matches)).toBe("other");
    expect(fitStateFor({ hardware_id: "apple-m4-pro-48gb", hardware_count: 1 }, matches)).toBe("other");
  });
});
