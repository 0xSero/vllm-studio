import { Effect } from "effect";
import { runCommandAsyncEffect } from "../../../core/command";
import { resolveNvidiaSmiBinary } from "./smi-tools";

const FULL_NVIDIA_UUID =
  /^GPU-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const QUERY_ARGS = ["--query-compute-apps=gpu_uuid,pid", "--format=csv,noheader,nounits"] as const;

const canonicalUuid = (uuid: string): string => `GPU-${uuid.slice(4).toLowerCase()}`;

const computeGpuUuids = (stdout: string): readonly string[] => {
  const uuids = new Set<string>();
  for (const line of stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)) {
    const [uuid, pid, ...extra] = line.split(",").map((value) => value.trim());
    if (!uuid || !pid || extra.length > 0 || !FULL_NVIDIA_UUID.test(uuid) || !/^\d+$/.test(pid)) {
      throw new Error("NVIDIA compute process output is invalid");
    }
    uuids.add(canonicalUuid(uuid));
  }
  return [...uuids];
};

export const queryNvidiaComputeGpuUuids = (): Effect.Effect<readonly string[], Error> => {
  const binary = resolveNvidiaSmiBinary();
  if (!binary) return Effect.fail(new Error("NVIDIA compute process telemetry is unavailable"));
  return runCommandAsyncEffect(binary, [...QUERY_ARGS], {
    timeoutMs: 5_000,
    maxOutputBytes: 256 * 1024,
  }).pipe(
    Effect.flatMap((result) =>
      result.status !== 0 || result.exitConfirmed === false
        ? Effect.fail(new Error("NVIDIA compute process telemetry failed"))
        : Effect.try({
            try: () => computeGpuUuids(result.stdout),
            catch: (error) => Error(String(error)),
          }),
    ),
  );
};
