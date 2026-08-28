import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Recipe } from "../src/modules/models/types";
import type { ComputeLaunchInput } from "../src/modules/compute/lifecycle";
import type { HostProfile } from "../src/modules/compute/contracts";
import { GitHubError } from "../src/modules/registry/github";
import {
  makeShareService,
  ShareConfirmationRequired,
  ShareNotValid,
  type ShareDependencies,
} from "../src/modules/registry/share";
import { makeRegistryClient } from "../src/modules/registry/client";
import { fixtureFetch, runEffect } from "./fixtures";

const BASE = "https://registry.test/registry";
const SECRET = "hf_token_supersecretvalue";

const workingRecipe = {
  id: "gemma-local",
  name: "Gemma 4 12B",
  model_path: "/models/unsloth/gemma-4-12b-it-NVFP4",
  vision: false,
  backend: "sglang",
  runtime: { kind: "docker", ref: "" },
  env_vars: { HF_TOKEN: SECRET, NCCL_P2P_DISABLE: "1" },
  tensor_parallel_size: 1,
  pipeline_parallel_size: 1,
  max_model_len: 131072,
  gpu_memory_utilization: 0.88,
  kv_cache_dtype: "auto",
  max_num_seqs: 24,
  trust_remote_code: true,
  tool_call_parser: "gemma4",
  reasoning_parser: null,
  enable_auto_tool_choice: true,
  quantization: "nvfp4",
  dtype: null,
  host: "0.0.0.0",
  port: 30000,
  served_model_name: "gemma-4-12b",
  python_path: null,
  extra_args: {},
  max_thinking_tokens: null,
  thinking_mode: "auto",
} as unknown as Recipe;

const hostProfile: HostProfile = {
  nodeId: "self",
  platform: "linux",
  arch: "x64",
  accelerator: "cuda",
  unifiedMemory: false,
  wsl: false,
  docker: true,
  dockerGpu: true,
  deviceCount: 1,
};

const launchInput: ComputeLaunchInput = {
  name: "llm",
  engine: "sglang",
  recipeId: "gemma-local",
  runtime: "docker",
  deviceCount: 1,
  portOverride: 30000,
  modelPath: "/models/unsloth/gemma-4-12b-it-NVFP4",
  servedModelName: "gemma-4-12b",
  options: {
    tensorParallel: 1,
    pipelineParallel: 1,
    maxContextLength: 131072,
    memoryFraction: 0.88,
    maxConcurrentRequests: 24,
    kvCacheDtype: null,
    dtype: null,
    quantization: "nvfp4",
    trustRemoteCode: true,
    toolCallParser: "gemma4",
    reasoningParser: null,
  },
  extraArgs: [],
  env: { HF_TOKEN: SECRET, NCCL_P2P_DISABLE: "1" },
  dockerImage: "lmsysorg/sglang:dev-cu13",
};

const githubFake = (options?: {
  repoMissing?: boolean;
  forkFails?: boolean;
  branchFails?: boolean;
  putFailsFrom?: number;
  pullFails?: boolean;
}) => {
  const calls: string[] = [];
  const fail = (step: string) => new GitHubError({ operation: step, message: `${step} exploded`, status: 500 });
  // The contract speaks in Effects; the fake adapts async bodies into them.
  const eff = <A>(body: () => Promise<A>) =>
    Effect.tryPromise({
      try: body,
      catch: (source) => (source instanceof GitHubError ? source : new GitHubError({ operation: "fake", message: String(source) })),
    });
  return {
    calls,
    client: {
      getRepo: (owner: string, repo: string) =>
        eff(async () => {
          calls.push(`getRepo ${owner}/${repo}`);
          return options?.repoMissing
            ? null
            : { full_name: `${owner}/${repo}`, default_branch: "main", fork: false, owner: { login: owner } };
        }),
      getBranch: (owner: string, repo: string, branch: string) =>
        eff(async () => {
          calls.push(`getBranch ${branch}`);
          return { sha: "basesha0000000000000000000000000000000000" };
        }),
      createFork: (owner: string, repo: string) =>
        eff(async () => {
          calls.push(`fork ${owner}/${repo}`);
          if (options?.forkFails) throw fail("fork");
          return { full_name: "gil/local-ai-registry", default_branch: "main", fork: true, owner: { login: "gil" } };
        }),
      createBranch: (owner: string, repo: string, branch: string, sha: string) =>
        eff(async () => {
          calls.push(`branch ${branch} @ ${sha}`);
          if (options?.branchFails) throw fail("branch");
        }),
      putFile: (input: { path: string }) =>
        eff(async () => {
          calls.push(`put ${input.path}`);
          const puts = calls.filter((call) => call.startsWith("put ")).length;
          if (options?.putFailsFrom && puts >= options.putFailsFrom) throw fail("commit");
        }),
      createPull: (input: { owner: string; repo: string; head: string; base: string; title: string }) =>
        eff(async () => {
          if (options?.pullFails) throw fail("pull-request");
          calls.push(`pr ${input.owner}/${input.repo} ${input.head} -> ${input.base}`);
          return { number: 42, html_url: "https://github.com/0xSero/local-ai-registry/pull/42" };
        }),
    },
  };
};

/** Adapt an async fake into the Effect the dependency contract expects. */
const promise = <A>(fn: () => Promise<A>) => () =>
  Effect.tryPromise({ try: fn, catch: (source) => source as never });

const DETECTED_5090 = [
  {
    uuid: "",
    index: 0,
    name: "NVIDIA GeForce RTX 5090",
    memory_total_mb: 32768,
    memory_used_mb: 0,
    memory_free_mb: 32768,
    utilization_pct: 0,
    temp_c: 0,
  },
] as never;

const makeDeps = (overrides?: Partial<ShareDependencies>, github = githubFake()): ShareDependencies => ({
  getRecipe: promise(async () => workingRecipe),
  isRunning: promise(async () => true),
  peaks: promise(async () => null),
  revisionFor: promise(async () => "b1f649734b34aa5575b03d186abd1b9be3d0d5c4"),
  gpus: promise(async () => DETECTED_5090),
  host: promise(async () => hostProfile),
  launchInput: promise(async () => launchInput),
  sizeBytes: promise(async () => 7_200_000_000),
  engineVersion: promise(async () => "0.5.2"),
  registry: makeRegistryClient({ baseUrl: BASE, fetch: fixtureFetch().fetch }),
  github: github.client,
  inferencePort: 8080,
  nowIso: () => "2026-08-29T12:00:00.000Z",
  ...overrides,
});

describe("share flow", () => {
  beforeEach(() => {
    process.env["HF_TOKEN"] = SECRET;
  });
  afterEach(() => {
    delete process.env["HF_TOKEN"];
  });

  test("preview builds validated records with launch args and evidence", async () => {
    const service = makeShareService(makeDeps());
    const result = await runEffect(service.preview("gemma-local"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.value;
    expect(payload.shareable).toBe(true);
    expect(payload.validation.ok).toBe(true);
    expect(payload.file_paths.length).toBe(3);
    const recipe = payload.records.recipe as Record<string, any>;
    expect(recipe["engine"]).toMatchObject({ name: "sglang", version: "0.5.2" });
    expect(String(recipe["launch"]["image"])).toContain("sglang");
    expect(recipe["serving"]["configured_max_context_tokens"]).toBe(131072);
  });

  test("preview never leaks secrets, device ids, or home paths", async () => {
    const service = makeShareService(makeDeps({
      gpus: promise(async () => [
        {
          uuid: "GPU-deadbeef",
          index: 0,
          name: "NVIDIA GeForce RTX 5090",
          memory_total_mb: 32768,
          memory_used_mb: 0,
          memory_free_mb: 32768,
          utilization_pct: 0,
          temp_c: 0,
        },
      ] as never),
    }));
    const result = await runEffect(service.preview("gemma-local"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.value.records);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("HF_TOKEN");
    expect(serialized).not.toContain("GPU-deadbeef");
    expect(serialized).not.toContain("/models/unsloth");
    expect(serialized).not.toContain("/Users/");
  });

  test("cancellation: no confirmation, no GitHub calls", async () => {
    const github = githubFake();
    const service = makeShareService(makeDeps({}, github));
    const result = await runEffect(service.createPullRequest("gemma-local", false));
    expect(!result.ok).toBe(true);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ShareConfirmationRequired);
    expect(github.calls).toEqual([]);
  });

  test("a configuration that never ran is refused even when confirmed", async () => {
    const github = githubFake();
    const service = makeShareService(
      makeDeps({ isRunning: promise(async () => false), peaks: promise(async () => null) }, github),
    );
    const result = await runEffect(service.createPullRequest("gemma-local", true));
    expect(!result.ok).toBe(true);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(ShareNotValid);
    expect(String((result.error as ShareNotValid).message)).toContain("has not run");
    expect(github.calls).toEqual([]);
  });

  test("successful PR creation: fork, branch, commits, pull request in order", async () => {
    const github = githubFake();
    const service = makeShareService(makeDeps({}, github));
    const result = await runEffect(service.createPullRequest("gemma-local", true));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pull_request_url).toContain("0xSero/local-ai-registry/pull/42");
    expect(github.calls[0]).toBe("getRepo 0xSero/local-ai-registry");
    expect(github.calls[1]).toBe("fork 0xSero/local-ai-registry");
    expect(github.calls[2]).toBe("getBranch main");
    expect(github.calls[3]).toContain("branch share/local-studio-");
    expect(github.calls.at(-1)).toContain(
      "pr 0xSero/local-ai-registry gil:share/local-studio-gemma-4-12b-it-nvfp4-nvfp4-rtx-5090-32gb-sglang-tp1-",
    );
    expect(github.calls.at(-1)).toEndWith("-> main");
    expect(github.calls.filter((call) => call.startsWith("put ")).length).toBe(3);
    expect(github.calls.some((call) => call.includes("recipe/"))).toBe(true);
    expect(github.calls.some((call) => call.includes("model-instance/"))).toBe(true);
  });

  test("an artifact the registry already knows is not re-committed", async () => {
    const github = githubFake();
    const service = makeShareService(makeDeps({
      getRecipe: promise(async () =>
        ({ ...workingRecipe, model_path: "/models/google/diffusiongemma-26b-a4b", quantization: "bf16" }) as Recipe),
    }, github));
    const result = await runEffect(service.createPullRequest("gemma-local", true));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.files.length).toBe(2);
    expect(github.calls.some((call) => call.startsWith("put model/"))).toBe(false);
  });

  test("GitHub failures surface as typed step errors and never open a PR", async () => {
    const cases = [
      { options: { repoMissing: true }, step: "github" },
      { options: { forkFails: true }, step: "fork" },
      { options: { branchFails: true }, step: "branch" },
      { options: { putFailsFrom: 2 }, step: "commit" },
      { options: { pullFails: true }, step: "pull-request" },
    ] as const;
    for (const testCase of cases) {
      const github = githubFake(testCase.options);
      const service = makeShareService(makeDeps({}, github));
      const result = await runEffect(service.createPullRequest("gemma-local", true));
      expect(!result.ok).toBe(true);
      if (result.ok) return;
      expect((result.error as { _tag: string })._tag).toBe("ShareFailed");
      expect((result.error as { step: string }).step).toBe(testCase.step);
      expect(github.calls.some((call) => call.startsWith("pr "))).toBe(false);
    }
  });

  test("a registry outage blocks the share before any GitHub call", async () => {
    const github = githubFake();
    const service = makeShareService(makeDeps({
      registry: makeRegistryClient({
        baseUrl: BASE,
        fetch: fixtureFetch({ failing: ["index.json"] }).fetch,
      }),
    }, github));
    const result = await runEffect(service.createPullRequest("gemma-local", true));
    expect(!result.ok).toBe(true);
    if (result.ok) return;
    expect((result.error as { step: string }).step).toBe("registry");
    expect(github.calls).toEqual([]);
  });

  test("missing recipes are a 404-class error", async () => {
    const service = makeShareService(makeDeps({ getRecipe: promise(async () => null) }));
    const result = await runEffect(service.preview("nope"));
    expect(!result.ok).toBe(true);
    if (result.ok) return;
    expect((result.error as { _tag: string })._tag).toBe("ShareRecipeMissing");
  });
});
