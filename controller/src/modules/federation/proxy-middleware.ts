import { FEDERATION_HOP_HEADER, WORKER_TARGET_HEADER } from "@local-studio/contracts/federation";
import { Effect } from "effect";
import type { MiddlewareHandler, Next } from "hono";
import type { AppContext } from "../../app-context";
import { effectMiddleware, type ControllerEnvironment } from "../../http/effect-handler";

const FORWARDED_REQUEST_TIMEOUT_MS = 600_000;

const HEAD_PATHS = [
  "/api/docs",
  "/api/spec",
  "/health",
  "/studio/rigs",
  "/studio/model-providers",
  "/studio/providers",
  "/studio/sessions",
  "/studio/usage",
  "/studio/workers",
  "/usage",
  "/v1/chat/completions",
  "/v1/models",
  "/v1/responses",
] as const;

const isHeadPath = (path: string): boolean =>
  HEAD_PATHS.some((entry) => path === entry || path.startsWith(`${entry}/`));

const nextEffect = (next: Next): Effect.Effect<void, unknown> =>
  Effect.tryPromise({ try: next, catch: (error) => error });

const forwardedResponse = (response: Response, workerId: string): Response => {
  const headers = new Headers(response.headers);
  headers.delete("connection");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set(WORKER_TARGET_HEADER, workerId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const createFederationProxyMiddleware = (
  context: AppContext,
): MiddlewareHandler<ControllerEnvironment> =>
  effectMiddleware((ctx, next) => {
    if (context.config.controller_mode !== "head" || isHeadPath(ctx.req.path)) {
      return nextEffect(next);
    }
    if (ctx.req.header(FEDERATION_HOP_HEADER)) {
      return Effect.succeed(ctx.json({ detail: "Federation loop rejected" }, { status: 508 }));
    }
    const workerId = ctx.req.header(WORKER_TARGET_HEADER)?.trim();
    if (!workerId) {
      return Effect.succeed(
        ctx.json(
          { detail: "Select a Worker before using this controller endpoint" },
          { status: 409 },
        ),
      );
    }
    return context.workerPool.target(workerId).pipe(
      Effect.flatMap((target) => {
        if (!target) {
          return Effect.succeed(
            ctx.json({ detail: "Selected Worker was not found" }, { status: 404 }),
          );
        }
        const raw = ctx.req.raw;
        const path = `${ctx.req.path}${new URL(raw.url).search}`;
        const body = raw.method === "GET" || raw.method === "HEAD" ? undefined : raw.body;
        const request: RequestInit = {
          method: raw.method,
          headers: raw.headers,
          signal: raw.signal,
        };
        if (body) request.body = body;
        return context.workerPool.fetch(target, path, request, FORWARDED_REQUEST_TIMEOUT_MS).pipe(
          Effect.map((response) => forwardedResponse(response, target.id)),
          Effect.catch((error) =>
            Effect.succeed(
              ctx.json(
                { detail: error instanceof Error ? error.message : "Worker unavailable" },
                { status: 502 },
              ),
            ),
          ),
        );
      }),
      Effect.catch((error) =>
        Effect.succeed(
          ctx.json(
            { detail: error instanceof Error ? error.message : "Worker configuration unavailable" },
            { status: 500 },
          ),
        ),
      ),
    );
  });
