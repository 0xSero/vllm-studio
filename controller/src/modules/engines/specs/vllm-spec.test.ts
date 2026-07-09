import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Config } from "../../../config/env";
import { parseRecipe } from "../../models/recipes/recipe-serializer";
import type { Recipe } from "../../models/types";
import { vllmSpec } from "../engine-spec";

const temporaryDirectories: string[] = [];

const temporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-vllm-runtime-"));
  temporaryDirectories.push(directory);
  return directory;
};

const executable = (path: string): string => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
  chmodSync(path, 0o755);
  return path;
};

const config = (dataDirectory: string): Config => ({
  host: "127.0.0.1",
  port: 8080,
  inference_host: "127.0.0.1",
  inference_port: 8000,
  data_dir: dataDirectory,
  db_path: join(dataDirectory, "controller.db"),
  models_dir: "/models",
  strict_openai_models: false,
  providers: [],
});

const recipe = (runtime: Record<string, unknown>): Recipe =>
  parseRecipe({
    id: "test",
    name: "Test",
    model_path: "/models/test",
    runtime,
  });

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("buildVllmCommand runtime selection", () => {
  test("launches the selected managed venv", () => {
    const dataDirectory = temporaryDirectory();
    const python = executable(
      join(dataDirectory, "runtime", "venvs", "vllm-latest", "bin", "python"),
    );
    expect(
      vllmSpec
        .buildCommand(recipe({ kind: "managed_venv", ref: "vllm" }), config(dataDirectory))
        .slice(0, 4),
    ).toEqual([python, "-m", "vllm.entrypoints.openai.api_server", "--model"]);
  });

  test("launches the selected system binary", () => {
    const dataDirectory = temporaryDirectory();
    const binary = executable(join(dataDirectory, "bin", "vllm"));
    expect(
      vllmSpec
        .buildCommand(recipe({ kind: "system", ref: binary }), config(dataDirectory))
        .slice(0, 3),
    ).toEqual([binary, "serve", "/models/test"]);
  });

  test("launches the selected Docker image", () => {
    const command = vllmSpec.buildCommand(
      recipe({ kind: "docker", ref: "vllm/vllm-openai:v0.8.5" }),
      config(temporaryDirectory()),
    );
    expect(command.slice(0, 3)).toEqual(["docker", "run", "--rm"]);
    expect(command).toContain("vllm/vllm-openai:v0.8.5");
    expect(command).toContain("/opt/venv/bin/vllm");
  });

  test("fails when the selected runtime is unavailable", () => {
    const dataDirectory = temporaryDirectory();
    expect(() =>
      vllmSpec.buildCommand(recipe({ kind: "managed_venv", ref: "vllm" }), config(dataDirectory)),
    ).toThrow("vLLM Python runtime was not found");
  });
});
