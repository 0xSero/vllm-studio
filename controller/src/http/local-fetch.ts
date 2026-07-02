import type { AppContext } from "../app-context";

export type LocalFetchOptions = RequestInit & { host?: string; timeoutMs?: number };

const normalizePath = (path: string): string => {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
};

const buildLocalUrl = (port: number, path: string, host = "localhost"): string =>
  `http://${host}:${port}${normalizePath(path)}`;

export const fetchLocal = async (
  port: number,
  path: string,
  options: LocalFetchOptions = {}
): Promise<Response> => {
  const { host, timeoutMs, signal, ...init } = options;
  const url = buildLocalUrl(port, path, host);
  const requestSignal = signal ?? undefined;

  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(url, requestSignal ? { ...init, signal: requestSignal } : init);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const combinedSignal = requestSignal
    ? AbortSignal.any([requestSignal, controller.signal])
    : controller.signal;
  try {
    return await fetch(url, { ...init, signal: combinedSignal });
  } finally {
    clearTimeout(timer);
  }
};

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
