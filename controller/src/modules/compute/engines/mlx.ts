import type { ComputeEngineSpec, EngineSupport, HostProfile } from "../contracts";
import { health, noMetrics, plan, serverArguments, supported, unsupported, type Spelling } from "./shared";

const READY_DEADLINE_MS = 300_000;

const spelling: Spelling = {
  maxContextLength: { flag: "--max-tokens" },
  trustRemoteCode: { flag: "--trust-remote-code" },
  // MLX has no tensor/pipeline parallelism, no KV dtype selection, and no memory
  // fraction — unified memory is allocated on demand.
};

const supports = (host: HostProfile): EngineSupport => {
  if (host.platform !== "darwin") return unsupported("MLX runs only on macOS (Apple Silicon)");
  if (host.arch !== "arm64") return unsupported("MLX requires Apple Silicon; this Mac is Intel");
  // Docker on macOS has no Metal passthrough, so a container would silently run on CPU.
  return supported("process");
};

export const mlx: ComputeEngineSpec = {
  id: "mlx",
  defaultBinary: "mlx_lm.server",
  defaultPort: 8080,
  // mlx_lm.server exposes no /health; /v1/models answers 200 once it is up.
  health: health("/v1/models", READY_DEADLINE_MS),
  metrics: noMetrics,
  supports,
  plan: (request) =>
    plan(request, {
      args: serverArguments(
        request,
        { modelFlag: "--model", servedNameFlag: null, spelling },
        request.port,
      ),
      health: health("/v1/models", READY_DEADLINE_MS),
      listenPort: request.port,
    }),
};
