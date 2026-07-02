import type { AppContext } from "../app-context";

function elapsedMs(start: number): number {
  return Math.round(performance.now() - start);
}

function errorClass(error: unknown): string {
  return (error as { name?: string } | null)?.name || "Error";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function observeControllerFunction<T>(
  context: AppContext,
  functionName: string,
  call: () => T | Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await call();
    context.stores.controllerRequestStore.recordFunctionCall({
      function_name: functionName,
      duration_ms: elapsedMs(start),
      success: true,
    });
    return result;
  } catch (error) {
    context.stores.controllerRequestStore.recordFunctionCall({
      function_name: functionName,
      duration_ms: elapsedMs(start),
      success: false,
      error_class: errorClass(error),
      error_message: errorMessage(error),
    });
    throw error;
  }
}

/**
 * The most common observed call: locate the running inference process on the
 * configured port. `label` prefixes the telemetry function name per call site
 * (e.g. "status" -> "status.findInferenceProcess").
 */
export const findObservedInferenceProcess = (
  context: AppContext,
  label: string,
): ReturnType<AppContext["processManager"]["findInferenceProcess"]> =>
  observeControllerFunction(context, `${label}.findInferenceProcess`, () =>
    context.processManager.findInferenceProcess(context.config.inference_port),
  );
