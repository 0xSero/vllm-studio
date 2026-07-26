import type { AppContext } from "../../app-context";
import { observeControllerFunction } from "../../core/function-observability";

export const createGetObservedProcess =
  (
    context: AppContext,
  ): ((label: string) => ReturnType<AppContext["bridge"]["findInferenceProcess"]>) =>
  (label: string) =>
    observeControllerFunction(context, `${label}.getCurrentProcess`, () =>
      context.bridge.findInferenceProcess(),
    );
