import { Effect } from "effect";
import type { RuntimeUpgradeResult } from "@local-studio/contracts/system";
import { EngineOperationError } from "./engine-spec";

/** Every install/upgrade failure reports the same shape; only these three fields vary. */
export const failedUpgrade = (
  error: string,
  output: string | null = null,
  usedCommand: string | null = null,
): RuntimeUpgradeResult => ({
  success: false,
  version: null,
  output,
  error,
  used_command: usedCommand,
});

export const operationError = (operation: string, cause: unknown): EngineOperationError =>
  new EngineOperationError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  });

export const attempt = <A>(
  operation: string,
  evaluate: () => A,
): Effect.Effect<A, EngineOperationError> =>
  Effect.try({
    try: evaluate,
    catch: (cause) => operationError(operation, cause),
  });
