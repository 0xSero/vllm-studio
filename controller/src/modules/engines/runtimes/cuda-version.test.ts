import { describe, expect, test } from "bun:test";
import { extractCudaVersion } from "./cuda-version";

describe("extractCudaVersion", () => {
  test("parses the classic nvidia-smi banner", () => {
    expect(
      extractCudaVersion(
        "| NVIDIA-SMI 555.85    Driver Version: 555.85    CUDA Version: 12.5 |",
      ),
    ).toBe("12.5");
  });

  test("parses the driver 610+ UMD banner", () => {
    expect(
      extractCudaVersion(
        "| NVIDIA-SMI 610.47    KMD Version: 610.47    CUDA UMD Version: 13.3 |",
      ),
    ).toBe("13.3");
  });

  test("returns null when no CUDA version is present", () => {
    expect(extractCudaVersion("no gpu here")).toBeNull();
  });
});
