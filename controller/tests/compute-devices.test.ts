import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { DeviceSnapshot } from "../src/modules/compute/contracts";
import {
  bootstrapProfile,
  collectSnapshot,
  makeTelemetry,
  profileFrom,
} from "../src/modules/compute/devices/snapshot";
import { readHostInfo } from "../src/modules/compute/devices/host";
import { readVolumes, systemRoot } from "../src/modules/compute/devices/storage";

const run = <A>(effect: Effect.Effect<A>): Promise<A> => Effect.runPromise(effect);

describe("host info", () => {
  test("reports real, plausible numbers", () => {
    const host = readHostInfo();
    expect(host.memoryTotalBytes).toBeGreaterThan(0);
    expect(host.memoryAvailableBytes).toBeGreaterThan(0);
    expect(host.memoryAvailableBytes).toBeLessThanOrEqual(host.memoryTotalBytes);
    expect(host.cpuCount).toBeGreaterThan(0);
    expect(host.cpuModel.length).toBeGreaterThan(0);
    expect(["linux", "darwin", "win32"]).toContain(host.platform);
    expect(["x64", "arm64"]).toContain(host.arch);
  });
});

describe("storage", () => {
  test("the system root is always measurable, with free <= total", () => {
    const volumes = readVolumes([]);
    expect(volumes.length).toBeGreaterThan(0);
    const root = volumes[0];
    expect(root).toBeDefined();
    if (!root) return;
    expect(root.totalBytes).toBeGreaterThan(0);
    expect(root.freeBytes).toBeLessThanOrEqual(root.totalBytes);
    expect(root.mount).toBe(systemRoot());
  });

  test("paths on one volume collapse to a single entry", () => {
    const volumes = readVolumes([systemRoot(), systemRoot()]);
    expect(volumes).toHaveLength(1);
  });

  test("an unreadable path is skipped, not fatal", () => {
    const volumes = readVolumes(["/definitely/not/a/real/mount/point"]);
    expect(volumes.length).toBeGreaterThan(0);
  });
});

describe("snapshot", () => {
  test("collects on this host without throwing", async () => {
    const snapshot = await run(collectSnapshot());
    expect(Date.parse(snapshot.sampledAt)).toBeGreaterThan(0);
    expect(snapshot.host.memoryTotalBytes).toBeGreaterThan(0);
    expect(Array.isArray(snapshot.accelerators)).toBe(true);
    expect(snapshot.capabilities).toContain("hostMemory");
  });

  test("every accelerator carries a stable id and honest nulls", async () => {
    const snapshot = await run(collectSnapshot());
    for (const accelerator of snapshot.accelerators) {
      // Never a bare index — those renumber when a card is added.
      expect(accelerator.id.length).toBeGreaterThan(0);
      expect(accelerator.memoryTotalBytes).toBeGreaterThanOrEqual(0);
      for (const field of [
        accelerator.utilizationPct,
        accelerator.temperatureC,
        accelerator.powerWatts,
      ]) {
        // A field is either a real number or explicitly null — never a stand-in zero.
        expect(field === null || Number.isFinite(field)).toBe(true);
      }
    }
  });

  test("a claimed capability is backed by at least one real reading", async () => {
    const snapshot = await run(collectSnapshot());
    const claims = (field: "utilization" | "temperature" | "power"): boolean =>
      snapshot.capabilities.includes(field);
    if (claims("utilization")) {
      expect(snapshot.accelerators.some((entry) => entry.utilizationPct !== null)).toBe(true);
    }
    if (claims("power")) {
      expect(snapshot.accelerators.some((entry) => entry.powerWatts !== null)).toBe(true);
    }
    if (claims("temperature")) {
      const fromGpu = snapshot.accelerators.some((entry) => entry.temperatureC !== null);
      expect(fromGpu || snapshot.thermals.length > 0).toBe(true);
    }
  });

  test("declares storage only when it measured a volume", async () => {
    const snapshot = await run(collectSnapshot());
    expect(snapshot.capabilities.includes("storage")).toBe(snapshot.storage.length > 0);
  });
});

describe("telemetry cache", () => {
  test("repeat reads inside the TTL return the identical sample", async () => {
    const telemetry = makeTelemetry({ ttlMs: 60_000 });
    const first = await run(telemetry.snapshot());
    const second = await run(telemetry.snapshot());
    // Same object identity: ten dashboard clients cost one nvidia-smi.
    expect(second).toBe(first);
  });

  test("a zero TTL always resamples", async () => {
    const telemetry = makeTelemetry({ ttlMs: 0 });
    const first = await run(telemetry.snapshot());
    const second = await run(telemetry.snapshot());
    expect(second).not.toBe(first);
  });
});

describe("host profile", () => {
  const snapshotWith = (accelerators: DeviceSnapshot["accelerators"]): DeviceSnapshot => ({
    sampledAt: new Date(0).toISOString(),
    accelerators,
    host: readHostInfo(),
    storage: [],
    thermals: [],
    capabilities: [],
  });

  const gpu = (
    overrides: Partial<DeviceSnapshot["accelerators"][number]> = {},
  ): DeviceSnapshot["accelerators"][number] => ({
    id: "GPU-aaa",
    index: 0,
    vendor: "nvidia",
    name: "RTX PRO 6000",
    accelerator: "cuda",
    memoryTotalBytes: 96 * 1024 ** 3,
    memoryUsedBytes: 0,
    unifiedMemory: false,
    utilizationPct: 0,
    temperatureC: 40,
    powerWatts: 60,
    powerLimitWatts: 275,
    driver: null,
    ...overrides,
  });

  test("no accelerators means a CPU host", () => {
    const profile = profileFrom(snapshotWith([]), { nodeId: "self", docker: false, dockerGpu: false });
    expect(profile.accelerator).toBe("cpu");
    expect(profile.deviceCount).toBe(0);
  });

  test("unified memory is inherited from any accelerator that shares the pool", () => {
    const spark = profileFrom(snapshotWith([gpu({ unifiedMemory: true, name: "GB10" })]), {
      nodeId: "self",
      docker: true,
      dockerGpu: true,
    });
    expect(spark.unifiedMemory).toBe(true);
    expect(spark.accelerator).toBe("cuda");
  });

  test("macOS never reports docker GPU passthrough", () => {
    const base = snapshotWith([gpu({ vendor: "apple", accelerator: "metal", unifiedMemory: true })]);
    const darwin: DeviceSnapshot = { ...base, host: { ...base.host, platform: "darwin" } };
    const profile = profileFrom(darwin, { nodeId: "self", docker: true, dockerGpu: true });
    expect(profile.dockerGpu).toBe(false);
  });
});

describe("bootstrap profile", () => {
  test("is usable before any probe has run", () => {
    const profile = bootstrapProfile("self");
    expect(profile.nodeId).toBe("self");
    expect(profile.deviceCount).toBe(0);
    expect(["linux", "darwin", "win32"]).toContain(profile.platform);
  });
});
