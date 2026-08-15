import { Effect, Schema, Semaphore } from "effect";

export type BrowserOperationKind = "frame" | "input" | "state" | "verb" | "viewport";
export type BrowserOperationFailureReason = "aborted" | "failed" | "recovery-failed" | "timed-out";

const TimeoutSchema = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(60_000)),
);

export const BrowserOperationPolicySchema = Schema.Struct({
  recoveryMs: TimeoutSchema,
  timeouts: Schema.Struct({
    frame: TimeoutSchema,
    input: TimeoutSchema,
    state: TimeoutSchema,
    verb: TimeoutSchema,
    viewport: TimeoutSchema,
  }),
});

export type BrowserOperationPolicy = typeof BrowserOperationPolicySchema.Type;

export const DefaultBrowserOperationPolicy: BrowserOperationPolicy = {
  recoveryMs: 30_000,
  timeouts: { frame: 5_000, input: 5_000, state: 5_000, verb: 25_000, viewport: 5_000 },
};

export class BrowserOperationError extends Error {
  readonly name = "BrowserOperationError";

  constructor(
    readonly kind: BrowserOperationKind,
    readonly reason: BrowserOperationFailureReason,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type BrowserOperationContext = { assertActive: () => void; signal: AbortSignal };
export type BrowserOperationRunOptions = { kind: BrowserOperationKind; signal?: AbortSignal };

export type BrowserOperationCoordinatorOptions = {
  policy?: unknown;
  recover: (failure: BrowserOperationError) => Promise<void>;
};

const operationError = (
  kind: BrowserOperationKind,
  reason: BrowserOperationFailureReason,
  cause?: unknown,
): BrowserOperationError => {
  const label = reason === "timed-out" ? "timed out" : reason.replace("-", " ");
  return new BrowserOperationError(kind, reason, `Browser ${kind} operation ${label}`, { cause });
};

const normalizeError = (kind: BrowserOperationKind, error: unknown): Error =>
  error instanceof Error ? error : operationError(kind, "failed", error);

export class BrowserOperationCoordinator {
  private readonly lock = Semaphore.makeUnsafe(1);
  private readonly policy: BrowserOperationPolicy;
  private generation = 0;
  private poisoned: BrowserOperationError | null = null;

  constructor(private readonly options: BrowserOperationCoordinatorOptions) {
    this.policy = Schema.decodeUnknownSync(BrowserOperationPolicySchema)(
      options.policy ?? DefaultBrowserOperationPolicy,
    );
  }

  run<A>(
    options: BrowserOperationRunOptions,
    operation: (context: BrowserOperationContext) => Promise<A>,
  ): Promise<A> {
    if (options.signal?.aborted) {
      return Promise.reject(operationError(options.kind, "aborted", options.signal.reason));
    }
    const generation = this.generation;
    const deadline = Date.now() + this.policy.timeouts[options.kind];
    const controller = new AbortController();
    const abort = (): void =>
      controller.abort(operationError(options.kind, "aborted", options.signal?.reason));
    options.signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(operationError(options.kind, "timed-out")),
      Math.max(0, deadline - Date.now()),
    );
    const active = Effect.suspend(() => {
      if (this.poisoned) return Effect.fail(this.poisoned);
      if (generation !== this.generation) {
        return Effect.fail(operationError(options.kind, "aborted"));
      }
      if (controller.signal.aborted || Date.now() >= deadline) {
        return Effect.fail(
          controller.signal.reason instanceof BrowserOperationError
            ? controller.signal.reason
            : operationError(options.kind, "timed-out", controller.signal.reason),
        );
      }
      return this.operationEffect(options.kind, operation, generation, controller.signal);
    });
    return Effect.runPromise(this.lock.withPermit(Effect.uninterruptible(active)), {
      signal: controller.signal,
    })
      .catch((error: unknown) => {
        if (this.poisoned) throw this.poisoned;
        if (controller.signal.reason instanceof BrowserOperationError) {
          throw controller.signal.reason;
        }
        throw normalizeError(options.kind, error);
      })
      .finally(() => {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
      });
  }

  private operationEffect<A>(
    kind: BrowserOperationKind,
    operation: (context: BrowserOperationContext) => Promise<A>,
    generation: number,
    signal: AbortSignal,
  ): Effect.Effect<A, Error> {
    return Effect.callback<A, Error>((resume) => {
      let settled = false;
      const cleanup = (): void => signal.removeEventListener("abort", invalidate);
      const succeed = (value: A): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resume(Effect.succeed(value));
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resume(Effect.fail(normalizeError(kind, error)));
      };
      const invalidate = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        const failure =
          signal.reason instanceof BrowserOperationError
            ? signal.reason
            : operationError(kind, "aborted", signal.reason);
        if (failure.reason === "aborted") {
          resume(Effect.fail(failure));
          return;
        }
        this.generation += 1;
        void this.recover(failure).then((recoveryFailure) => {
          resume(Effect.fail(recoveryFailure ?? failure));
        });
      };
      const context: BrowserOperationContext = {
        assertActive: () => {
          if (settled || generation !== this.generation || signal.aborted) {
            throw operationError(kind, "aborted", signal.reason);
          }
        },
        signal,
      };
      signal.addEventListener("abort", invalidate, { once: true });
      if (signal.aborted) invalidate();
      else
        void Promise.resolve()
          .then(() => operation(context))
          .then(succeed, fail);
      return Effect.sync(cleanup);
    });
  }

  private async recover(failure: BrowserOperationError): Promise<BrowserOperationError | null> {
    try {
      await Effect.runPromise(
        Effect.tryPromise({
          try: () => this.options.recover(failure),
          catch: (error) => error,
        }).pipe(
          Effect.timeoutOrElse({
            duration: this.policy.recoveryMs,
            orElse: () => Effect.fail(new Error("Browser operation recovery timed out")),
          }),
        ),
      );
      return null;
    } catch (error) {
      const poisoned = operationError(failure.kind, "recovery-failed", error);
      this.poisoned = poisoned;
      return poisoned;
    }
  }
}
