import type { EngineSupport, HostProfile } from "../contracts";
import { noMetrics, serverEngine, supported, unsupported, type Spelling } from "./shared";

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

export const mlx = serverEngine({
  id: "mlx",
  defaultBinary: "mlx_lm.server",
  defaultPort: 8080,
  healthPath: "/v1/models",
  readyDeadlineMs: READY_DEADLINE_MS,
  metrics: noMetrics,
  supports,
  server: { modelFlag: "--model", servedNameFlag: null, spelling },
});
