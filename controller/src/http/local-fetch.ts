import { Effect } from "effect";

import type { AppContext } from "../app-context";

export type LocalFetchOptions = RequestInit & { host?: string; timeoutMs?: number };

const normalizePath = (path: string): string => {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
};

export const buildLocalUrl = (port: number, path: string, host = "localhost"): string =>
  `http://${host}:${port}${normalizePath(path)}`;

export const fetchLocalEffect = (
  port: number,
  path: string,
  options: LocalFetchOptions = {}
): Effect.Effect<Response, unknown> => {
  const { host, timeoutMs, signal, ...init } = options;
  const url = buildLocalUrl(port, path, host);
  const requestSignal = signal ?? undefined;

  if (!timeoutMs || timeoutMs <= 0) {
    if (!requestSignal) {
      return Effect.tryPromise(() => fetch(url, init));
    }
    return Effect.tryPromise(() => fetch(url, { ...init, signal: requestSignal }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const signal_ = requestSignal
    ? AbortSignal.any([requestSignal, controller.signal])
    : controller.signal;
  return Effect.tryPromise(() => fetch(url, { ...init, signal: signal_ })).pipe(
    Effect.ensuring(Effect.sync(() => clearTimeout(timer)))
  );
};

export const fetchLocal = (
  port: number,
  path: string,
  options: LocalFetchOptions = {}
): Promise<Response> => Effect.runPromise(fetchLocalEffect(port, path, options));

export const buildInferenceUrl = (context: AppContext, path: string): string =>
  buildLocalUrl(context.config.inference_port, path, context.config.inference_host);

export const fetchInference = (
  context: AppContext,
  path: string,
  options: LocalFetchOptions = {}
): Promise<Response> =>
  fetchLocal(context.config.inference_port, path, {
    host: context.config.inference_host,
    ...options,
  });
