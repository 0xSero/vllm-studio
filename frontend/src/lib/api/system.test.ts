import { describe, expect, it, vi } from "vitest";
import { createSystemApi } from "./system";

describe("createSystemApi", () => {
  it("forwards request options for fast liveness probes", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ running: true, process: null, inference_port: 8000 })
      .mockResolvedValueOnce({ platform: { kind: "cuda" } });

    const api = createSystemApi({ request } as never);
    const options = { timeout: 5_000, retries: 0 };

    await api.getStatus(options);
    await api.getCompatibility(options);

    expect(request).toHaveBeenNthCalledWith(1, "/status", options);
    expect(request).toHaveBeenNthCalledWith(2, "/compat", options);
  });

  it("normalizes status payload defaults", async () => {
    const request = vi.fn().mockResolvedValue({
      running: false,
      process: null,
      inference_port: 0,
    });

    const api = createSystemApi({ request } as never);
    await expect(api.getStatus()).resolves.toEqual({
      running: false,
      process: null,
      inference_port: 8000,
      launching: null,
    });
  });
});
