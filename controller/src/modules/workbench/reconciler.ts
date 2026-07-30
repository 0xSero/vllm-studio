import { Effect, Schedule } from "effect";
import type { AppContext } from "../../app-context";
import type { ScientificRayJobRecord } from "./types";

const RECONCILE_INTERVAL_MS = 10_000;
const RECONCILE_RETRY_BASE_MS = 1_000;
const RECONCILE_RETRY_MAX = 3;
const RECONCILE_CONCURRENCY = 4;

const RECONCILABLE_STATES: readonly ScientificRayJobRecord["state"][] = [
  "submitted",
  "running",
  "suspended",
];

export type ReconcileOptions = {
  retryBaseMs?: number;
  retryMax?: number;
};

const isReconcilable = (job: ScientificRayJobRecord): boolean =>
  RECONCILABLE_STATES.includes(job.state);

const isTerminal = (state: ScientificRayJobRecord["state"]): boolean =>
  state === "succeeded" || state === "failed";

const reconcileJob = (
  context: AppContext,
  job: ScientificRayJobRecord,
  options: Required<ReconcileOptions>,
): Effect.Effect<ScientificRayJobRecord, unknown> => {
  const gateway = context.kubeRayGateway;
  if (!gateway) return Effect.fail(new Error("KubeRay gateway is unavailable"));
  return Effect.suspend(() => gateway.reconcile(job, new Date().toISOString())).pipe(
    Effect.retry(
      Schedule.exponential(options.retryBaseMs).pipe(
        Schedule.take(options.retryMax),
      ),
    ),
  );
};

const resolveOptions = (options?: ReconcileOptions): Required<ReconcileOptions> => ({
  retryBaseMs: options?.retryBaseMs ?? RECONCILE_RETRY_BASE_MS,
  retryMax: options?.retryMax ?? RECONCILE_RETRY_MAX,
});

export const reconcilePass = (
  context: AppContext,
  options?: ReconcileOptions,
): Effect.Effect<void, unknown> => {
  const resolved = resolveOptions(options);
  return context.stores.scientificWorkbenchStore
    .listRayJobs()
    .pipe(
      Effect.map((jobs) => jobs.filter(isReconcilable)),
      Effect.flatMap((jobs) => {
        if (jobs.length === 0) return Effect.void;
        return Effect.forEach(
          jobs,
          (job) =>
            reconcileJob(context, job, resolved).pipe(
              Effect.tap((updated) => {
                if (isTerminal(updated.state) && updated.state !== job.state) {
                  return Effect.sync(() =>
                    context.logger.info("Workbench RayJob reached terminal state", {
                      job_id: updated.id,
                      state: updated.state,
                    }),
                  );
                }
                return Effect.void;
              }),
              Effect.flatMap((updated) =>
                context.stores.scientificWorkbenchStore.saveRayJob(
                  updated.submission,
                  updated,
                ),
              ),
              Effect.catch((error: unknown) =>
                Effect.sync(() =>
                  context.logger.warn("Workbench reconcile failed for RayJob", {
                    job_id: job.id,
                    error: String(error),
                  }),
                ),
              ),
              Effect.asVoid,
            ),
          { concurrency: RECONCILE_CONCURRENCY },
        );
      }),
      Effect.asVoid,
    );
};

export const startWorkbenchReconciler = (
  context: AppContext,
): Effect.Effect<never> =>
  Effect.suspend(() => {
    if (!context.kubeRayGateway) return Effect.never;
    return reconcilePass(context).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() =>
          context.logger.error("Workbench reconcile pass failed", {
            error: String(cause),
          }),
        ),
      ),
      Effect.repeat(Schedule.spaced(RECONCILE_INTERVAL_MS)),
      Effect.andThen(Effect.never),
    );
  });
