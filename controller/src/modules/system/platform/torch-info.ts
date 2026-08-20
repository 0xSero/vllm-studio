import type { RuntimeTorchBuildInfo } from "../../models/types";
import type { CommandResult } from "../../../core/command";
import { runCommandAsyncEffect } from "../../../core/command";
import { Effect } from "effect";

const TORCH_PROBE_TIMEOUT_MS = 3_000;
// Everything this probe reports lives in torch/version.py, a generated file of
// plain constants. Reading it via find_spec + exec never runs torch's native
// init — `import torch` can abort() the interpreter (duplicate libomp on
// macOS), which no Python except-clause survives.
const TORCH_PROBE_ARGS = [
  "-c",
  [
    "import json, os, importlib.util",
    "info = {'torch_version': None, 'torch_cuda': None, 'torch_hip': None}",
    "try:",
    "  spec = importlib.util.find_spec('torch')",
    "  origin = spec.origin if spec else None",
    "  if origin:",
    "    path = os.path.join(os.path.dirname(origin), 'version.py')",
    "    ns = {}",
    "    with open(path) as f:",
    "      exec(compile(f.read(), path, 'exec'), ns)",
    "    version = ns.get('__version__')",
    "    info = {'torch_version': str(version) if version is not None else None, 'torch_cuda': ns.get('cuda'), 'torch_hip': ns.get('hip')}",
    "except Exception:",
    "  pass",
    "print(json.dumps(info))",
  ].join("\n"),
];

const EMPTY_TORCH: RuntimeTorchBuildInfo = {
  torch_version: null,
  torch_cuda: null,
  torch_hip: null,
};

const parseTorchBuildOutput = (
  result: Pick<CommandResult, "status" | "stdout">,
): RuntimeTorchBuildInfo => {
  if (result.status !== 0) return { ...EMPTY_TORCH };
  try {
    const parsed = JSON.parse(result.stdout) as Partial<RuntimeTorchBuildInfo> | null;
    return {
      torch_version: parsed?.torch_version ?? null,
      torch_cuda: parsed?.torch_cuda ?? null,
      torch_hip: parsed?.torch_hip ?? null,
    };
  } catch {
    return { ...EMPTY_TORCH };
  }
};

export const getTorchBuildInfo = (python: string): Effect.Effect<RuntimeTorchBuildInfo> =>
  runCommandAsyncEffect(python, TORCH_PROBE_ARGS, { timeoutMs: TORCH_PROBE_TIMEOUT_MS }).pipe(
    Effect.map(parseTorchBuildOutput),
  );
