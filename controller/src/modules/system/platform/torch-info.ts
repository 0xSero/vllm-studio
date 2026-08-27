import type { RuntimeTorchBuildInfo } from "../../models/types";
import type { CommandResult } from "../../../core/command";
import { runCommandAsyncEffect } from "../../../core/command";
import { Effect, Option, Schema } from "effect";

const TORCH_PROBE_TIMEOUT_MS = 3_000;
const TORCH_PROBE_ARGS = [
  "-c",
  "import json\ntry:\n import torch\n print(json.dumps({'torch_version': getattr(torch, '__version__', None), 'torch_cuda': getattr(getattr(torch, 'version', None), 'cuda', None), 'torch_hip': getattr(getattr(torch, 'version', None), 'hip', None)}))\nexcept Exception:\n print(json.dumps({'torch_version': None, 'torch_cuda': None, 'torch_hip': None}))",
];

const TorchBuildOutputSchema = Schema.Struct({
  torch_version: Schema.NullOr(Schema.String),
  torch_cuda: Schema.NullOr(Schema.String),
  torch_hip: Schema.NullOr(Schema.String),
});

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
    const parsed = Schema.decodeUnknownOption(TorchBuildOutputSchema)(JSON.parse(result.stdout));
    return Option.getOrElse(parsed, () => ({ ...EMPTY_TORCH }));
  } catch {
    return { ...EMPTY_TORCH };
  }
};

export const getTorchBuildInfo = (python: string): Effect.Effect<RuntimeTorchBuildInfo> =>
  runCommandAsyncEffect(python, TORCH_PROBE_ARGS, { timeoutMs: TORCH_PROBE_TIMEOUT_MS }).pipe(
    Effect.map(parseTorchBuildOutput),
  );
