import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { Config } from "../src/config/env";
import {
  installWslManagedRuntime,
  readWslManagedRuntimeReceipt,
  uninstallWslManagedRuntime,
  wslManagedInstallArguments,
  wslManagedPackageSpec,
  wslManagedRuntimePaths,
} from "../src/modules/engines/wsl-managed-runtime";

describe("managed WSL2 runtimes", () => {
  test("derives isolated exact paths below a non-root Linux home", () => {
    expect(wslManagedRuntimePaths("/home/pipeline", "vllm", "nonce")).toEqual({
      root: "/home/pipeline/.local/share/local-studio/runtime/venvs/vllm-latest",
      parent: "/home/pipeline/.local/share/local-studio/runtime/venvs",
      pythonPath: "/home/pipeline/.local/share/local-studio/runtime/venvs/vllm-latest/bin/python",
      binaryPath: "/home/pipeline/.local/share/local-studio/runtime/venvs/vllm-latest/bin/vllm",
      staging: "/home/pipeline/.local/share/local-studio/runtime/venvs/.vllm-install-nonce",
      backup: "/home/pipeline/.local/share/local-studio/runtime/venvs/.vllm-backup-nonce",
    });
    expect(() => wslManagedRuntimePaths("/", "sglang")).toThrow("Unsafe WSL home directory");
    expect(() => wslManagedRuntimePaths("relative", "sglang")).toThrow(
      "Unsafe WSL home directory",
    );
  });

  test("accepts versions but not arbitrary package specifications", () => {
    expect(wslManagedPackageSpec("vllm")).toBe("vllm");
    expect(wslManagedPackageSpec("sglang", "0.5.9.post2")).toBe("sglang==0.5.9.post2");
    expect(wslManagedPackageSpec("vllm", "vllm==0.19.1")).toBeNull();
    expect(wslManagedPackageSpec("vllm", "https://example.test/package.whl")).toBeNull();
  });

  test("keeps installer values in argv and selects CUDA wheels with uv", () => {
    expect(
      wslManagedInstallArguments(
        "uv",
        "/home/user/.local/bin/uv",
        "/home/user/venv/bin/python",
        "vllm==0.19.1",
      ),
    ).toEqual([
      "/home/user/.local/bin/uv",
      [
        "pip",
        "install",
        "--python",
        "/home/user/venv/bin/python",
        "--upgrade",
        "vllm==0.19.1",
        "--torch-backend=auto",
      ],
    ]);
    expect(
      wslManagedInstallArguments(
        "pip",
        "/unused/uv",
        "/home/user/venv/bin/python",
        "sglang",
      ),
    ).toEqual([
      "/home/user/venv/bin/python",
      ["-m", "pip", "install", "--upgrade", "sglang"],
    ]);
  });

  test("installs transactionally and uninstalls only the receipt-backed managed path", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "local-studio-wsl-managed-"));
    const config = { data_dir: dataDirectory } as Config;
    const calls: string[][] = [];
    const result = (status = 0, stdout = "", stderr = "") => ({
      status,
      stdout,
      stderr,
      timedOut: false,
      signal: null,
    });
    const runner = (_distribution: string, args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === "/usr/bin/id") return Effect.succeed(result(0, "1000"));
      if (args[0] === "/usr/bin/getent") {
        return Effect.succeed(
          result(0, "user:x:1000:1000:User:/home/user:/bin/bash"),
        );
      }
      if (args[0] === "/bin/sh" && args.at(-1) === "python3") {
        return Effect.succeed(result(0, "/usr/bin/python3"));
      }
      if (args[0] === "/bin/sh" && args.at(-1) === "uv") {
        return Effect.succeed(result(0, "/home/user/.local/bin/uv"));
      }
      if (args[1] === "-c") {
        return Effect.succeed(result(0, '{"version":"0.19.1","cuda":true,"devices":2}'));
      }
      if (args[0] === "/usr/bin/test" && args[1] === "-e") {
        return Effect.succeed(result(1));
      }
      return Effect.succeed(result());
    };

    const install = await Effect.runPromise(
      installWslManagedRuntime({
        config,
        backend: "vllm",
        distribution: "Ubuntu",
        runner,
      }),
    );
    const receipt = readWslManagedRuntimeReceipt(config, "Ubuntu", "vllm");

    expect(install.success).toBe(true);
    expect(receipt?.version).toBe("0.19.1");
    expect(receipt?.root).toBe(
      "/home/user/.local/share/local-studio/runtime/venvs/vllm-latest",
    );
    expect(calls.some((args) => args.includes("--torch-backend=auto"))).toBe(true);

    const uninstall = await Effect.runPromise(
      uninstallWslManagedRuntime({
        config,
        backend: "vllm",
        distribution: "Ubuntu",
        runner,
      }),
    );
    const remove = calls.find(
      (args) => args[0] === "/bin/rm" && args.includes(receipt?.root ?? "missing"),
    );

    expect(uninstall.success).toBe(true);
    expect(remove).toEqual([
      "/bin/rm",
      "-rf",
      "--",
      "/home/user/.local/share/local-studio/runtime/venvs/vllm-latest",
    ]);
    expect(readWslManagedRuntimeReceipt(config, "Ubuntu", "vllm")).toBeNull();
    expect(calls.flat()).not.toContain("--terminate");
    expect(calls.flat()).not.toContain("--shutdown");
    rmSync(dataDirectory, { recursive: true, force: true });
  });
});
