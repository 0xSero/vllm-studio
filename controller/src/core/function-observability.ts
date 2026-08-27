import { Cause, Effect, Exit } from "effect";
import type { AppContext } from "../app-context";

function elapsedMs(start: number): number {
  return Math.round(performance.now() - start);
}

type FunctionFailure = Error | string;

function errorClass(error: FunctionFailure): string {
  return error instanceof Error ? error.name || "Error" : "Error";
}

function errorMessage(error: FunctionFailure): string {
  return error instanceof Error ? error.message : error;
}

export const observeControllerFunction = <A, E, R>(
  context: AppContext,
  functionName: string,
  call: () => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  const start = performance.now();
  return Effect.suspend(call).pipe(
    Effect.onExit((exit) => {
      if (Exit.isSuccess(exit)) {
        return context.stores.controllerRequestStore
          .recordFunctionCallEffect({
            function_name: functionName,
            duration_ms: elapsedMs(start),
            success: true,
          })
          .pipe(Effect.ignore);
      }
      const error = Cause.prettyErrors(exit.cause)[0] ?? Cause.pretty(exit.cause);
      return context.stores.controllerRequestStore
        .recordFunctionCallEffect({
          function_name: functionName,
          duration_ms: elapsedMs(start),
          success: false,
          error_class: errorClass(error),
          error_message: errorMessage(error),
        })
        .pipe(Effect.ignore);
    }),
  );
};

export const findObservedInferenceProcess = (
  context: AppContext,
  label: string,
): ReturnType<AppContext["compute"]["model"]["findInferenceProcess"]> =>
  observeControllerFunction(context, `${label}.findInferenceProcess`, () =>
    context.compute.model.findInferenceProcess(),
  );
