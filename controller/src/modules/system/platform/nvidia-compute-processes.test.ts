import { expect, test } from "bun:test";
import { queryNvidiaComputeGpuUuids } from "./nvidia-compute-processes";

const UUID = "GPU-01234567-89ab-cdef-0123-456789abcdef";

test("returns unique canonical GPU UUIDs with compute processes", async () => {
  const result = await queryNvidiaComputeGpuUuids({
    resolveBinary: () => "/opt/nvidia-smi",
    runCommand: async () => ({
      status: 0,
      stdout: `${UUID.toUpperCase()}, 123\n${UUID}, 456\n`,
    }),
  });

  expect(result).toEqual([UUID]);
});

test("fails closed for missing, failed, and malformed telemetry", async () => {
  await expect(
    queryNvidiaComputeGpuUuids({
      resolveBinary: () => null,
      runCommand: async () => ({ status: 0, stdout: "" }),
    }),
  ).rejects.toThrow("unavailable");
  await expect(
    queryNvidiaComputeGpuUuids({
      resolveBinary: () => "/opt/nvidia-smi",
      runCommand: async () => ({ status: 1, stdout: "" }),
    }),
  ).rejects.toThrow("failed");
  await expect(
    queryNvidiaComputeGpuUuids({
      resolveBinary: () => "/opt/nvidia-smi",
      runCommand: async () => ({ status: 0, stdout: "not-a-gpu, nope" }),
    }),
  ).rejects.toThrow("invalid");
});
