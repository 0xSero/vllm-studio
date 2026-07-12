import type { AppContext } from "../../app-context";
import { observeControllerFunction } from "../../core/function-observability";
import type { ProcessInfo } from "../models/types";

/**
 * Factory for the shared engine-route process probe: wraps
 * `engineService.getCurrentProcess()` in controller-function observability
 * under a per-call label.
 */
export const createGetObservedProcess =
  (context: AppContext) =>
  (label: string): Promise<ProcessInfo | null> =>
    observeControllerFunction(context, `${label}.getCurrentProcess`, () =>
      context.engineService.getCurrentProcess(),
    );
