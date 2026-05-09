import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { piPathEnv, resolvePiBinaryPath } from "./pi-binary";

const originalEnv = { ...process.env };
const originalCwd = process.cwd();
const roots: string[] = [];

afterEach(() => {
  process.env = { ...originalEnv };
  process.chdir(originalCwd);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const makeExecutable = (file: string): string => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
  return file;
};

describe("pi binary resolution", () => {
  it("uses an explicit Pi binary override", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vllm-studio-pi-"));
    roots.push(root);
    const pi = makeExecutable(path.join(root, "pi"));
    process.env.VLLM_STUDIO_PI_BINARY = pi;

    expect(resolvePiBinaryPath()).toBe(pi);
  });

  it("finds the frontend-local Pi binary when cwd is the repo root", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vllm-studio-pi-"));
    roots.push(root);
    makeExecutable(path.join(root, "frontend", "node_modules", ".bin", "pi"));
    process.env.PATH = "";
    process.chdir(root);

    expect(resolvePiBinaryPath()).toBe(
      path.join(process.cwd(), "frontend", "node_modules", ".bin", "pi"),
    );
  });

  it("adds common macOS and local Pi locations to PATH for spawned Pi", () => {
    expect(piPathEnv()).toContain("/opt/homebrew/bin");
    expect(piPathEnv()).toContain(path.join(process.cwd(), "node_modules", ".bin"));
  });
});
