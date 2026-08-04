import { readRequestBytesWithinLimit } from "@shared/agent/agent-turn-body";
import {
  HARNESS_INTEGRATION_CONTRACT_VERSION,
  HARNESS_REMOTE_DATA_CONSENT_HEADER,
  HARNESS_REMOTE_DATA_CONSENT_VERSION,
  decodeHarnessVerificationCheck,
  type HarnessIntegrationContract,
} from "@shared/agent/harness";

const UPSTREAM_REQUEST_HEADER_ALLOWLIST = [
  "accept",
  "content-type",
  "if-match",
  "if-none-match",
  "last-event-id",
  "x-request-id",
];
const DOWNSTREAM_RESPONSE_HEADER_ALLOWLIST = [
  "cache-control",
  "content-type",
  "etag",
  "last-modified",
  "retry-after",
  "x-request-id",
];
const DEFAULT_HARNESS_URL = "http://127.0.0.1:8771";
const DEFAULT_PROVIDER_HARNESS_URL = "http://127.0.0.1:8772";

export type HarnessTarget = "managed" | "provider";

const V1_GET_ROUTES = [
  /^routes$/,
  /^tasks$/,
  /^tasks\/current$/,
  /^tasks\/[^/]+$/,
  /^tasks\/[^/]+\/(?:events|artifacts)$/,
];
const API_GET_ROUTES = [/^modes$/, /^setup$/, /^tasks\/current$/, /^tasks\/current\/events$/];
const API_POST_ROUTES = [/^tasks$/, /^tasks\/current\/(?:stop|continue|accept)$/];

export function harnessBaseUrl(target: HarnessTarget = "managed"): string {
  const raw = (
    target === "provider"
      ? process.env.LOCAL_STUDIO_PROVIDER_HARNESS_URL
      : process.env.LOCAL_STUDIO_HARNESS_URL
  )?.trim();
  const fallback = target === "provider" ? DEFAULT_PROVIDER_HARNESS_URL : DEFAULT_HARNESS_URL;
  return (raw || fallback).replace(/\/+$/, "");
}

export function harnessToken(target: HarnessTarget = "managed"): string {
  return (
    (target === "provider"
      ? process.env.LOCAL_STUDIO_PROVIDER_HARNESS_TOKEN
      : process.env.LOCAL_STUDIO_HARNESS_TOKEN
    )?.trim() ?? ""
  );
}

export function harnessIntegrationContract(target: HarnessTarget): HarnessIntegrationContract {
  return {
    contract: HARNESS_INTEGRATION_CONTRACT_VERSION,
    target,
    ownership: "external",
    configuration_source: "server_environment",
    lifecycle: {
      state: "reachable",
      install: "external",
      start: "external",
      stop: "external",
    },
    remote_data: {
      mutation_consent_required: true,
      consent_version: HARNESS_REMOTE_DATA_CONSENT_VERSION,
    },
  };
}

export function hasHarnessMutationConsent(request: Request): boolean {
  return (
    request.headers.get(HARNESS_REMOTE_DATA_CONSENT_HEADER) === HARNESS_REMOTE_DATA_CONSENT_VERSION
  );
}

export function isHarnessRouteAllowed(
  method: string,
  path: string[],
  namespace: "v1" | "api",
  target: HarnessTarget,
): boolean {
  const route = path.join("/");
  const normalizedMethod = method.toUpperCase();
  if (namespace === "v1") {
    return normalizedMethod === "GET"
      ? V1_GET_ROUTES.some((pattern) => pattern.test(route))
      : normalizedMethod === "POST" && route === "tasks";
  }
  if (normalizedMethod === "GET") {
    return API_GET_ROUTES.some((pattern) => pattern.test(route));
  }
  if (normalizedMethod !== "POST") return false;
  if (API_POST_ROUTES.some((pattern) => pattern.test(route))) return true;
  return target === "provider" && /^(?:setup|setup\/test)$/.test(route);
}

export function upstreamRequestHeaders(requestHeaders: Headers): Headers {
  const headers = new Headers();
  for (const name of UPSTREAM_REQUEST_HEADER_ALLOWLIST) {
    const value = requestHeaders.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

export function downstreamResponseHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers();
  for (const name of DOWNSTREAM_RESPONSE_HEADER_ALLOWLIST) {
    const value = upstreamHeaders.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

type JsonRecord = Record<string, unknown>;

function jsonRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function projectedStrings(value: unknown, limit = 100): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, limit)
    : [];
}

function projectedRecord(value: unknown, keys: readonly string[]): JsonRecord {
  const source = jsonRecord(value);
  if (!source) return {};
  return Object.fromEntries(
    keys.flatMap((key) => {
      const item = source[key];
      return typeof item === "string" || typeof item === "number" || typeof item === "boolean"
        ? [[key, item]]
        : [];
    }),
  );
}

function projectedVerification(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).map((item) => {
    const check = decodeHarnessVerificationCheck(item);
    return check
      ? { ...check }
      : {
          name: "Legacy verification entry",
          passed: false,
          message: "The upstream Harness did not return a structured verification receipt.",
          independent: false,
          source: "legacy",
        };
  });
}

function projectedEvents(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-100)
    .map((item) => projectedRecord(item, ["seq", "checkpoint", "status", "at"]));
}

function projectedTask(value: unknown): JsonRecord | null {
  const source = jsonRecord(value);
  if (!source) return null;
  const task = projectedRecord(source, [
    "id",
    "status",
    "status_label",
    "summary",
    "human_title",
    "objective",
    "mode",
    "execution_profile",
    "needs_human",
    "review_status",
    "result_category",
  ]);
  task.changed_files = projectedStrings(source.changed_files);
  task.artifacts = Array.isArray(source.artifacts)
    ? source.artifacts.slice(0, 100).map((item) => projectedRecord(item, ["name", "path"]))
    : [];
  task.events = projectedEvents(source.events);
  task.verification = projectedVerification(source.verification);
  task.progress = projectedRecord(source.progress, ["label", "percent", "determinate"]);
  task.current = projectedRecord(source.current, [
    "checkpoint",
    "current_subgoal",
    "cycle",
    "last_event_at",
  ]);
  task.readiness_gate = projectedRecord(source.readiness_gate, [
    "can_start",
    "can_queue",
    "state",
    "label",
    "next_action",
    "summary",
    "requires_review",
  ]);
  const metadata = jsonRecord(source.metadata);
  task.metadata = {
    ...projectedRecord(metadata, ["observed_at", "updated_at"]),
    route_receipt: projectedRecord(metadata?.route_receipt, [
      "contract",
      "actual",
      "evidence",
      "status",
      "reviewer",
      "observed_at",
    ]),
    integration: projectedRecord(metadata?.integration, [
      "kind",
      "route_id",
      "model_id",
      "node",
      "runtime",
      "model_used",
      "connected_workspace_mutated",
    ]),
    demo: projectedRecord(metadata?.demo, ["enabled", "model_used", "workspace"]),
  };
  task.final_result = projectedRecord(source.final_result, ["accepted"]);
  return task;
}

function projectedSetup(value: unknown, target: HarnessTarget): JsonRecord | null {
  const source = jsonRecord(value);
  if (!source) return null;
  return {
    ...projectedRecord(source, [
      "configured",
      "editable",
      "suggested_check",
      "verification_command",
      "workspace",
      "execution_summary",
      "assurance_mode",
    ]),
    allowed_api_key_envs: projectedStrings(source.allowed_api_key_envs),
    worker: projectedRecord(source.worker, ["label", "type", "data_location"]),
    provider: projectedRecord(source.provider, [
      "endpoint",
      "model",
      "api_key_env",
      "data_location",
    ]),
    verification_contract: projectedRecord(source.verification_contract, ["shell", "summary"]),
    integration: harnessIntegrationContract(target),
  };
}

export function projectHarnessPayload(
  value: unknown,
  namespace: "v1" | "api",
  path: string[],
  target: HarnessTarget,
): JsonRecord | null {
  const source = jsonRecord(value);
  if (!source) return null;
  const route = path.join("/");
  if (namespace === "api" && route === "setup") return projectedSetup(source, target);
  if (route === "routes") {
    return {
      routes: Array.isArray(source.routes)
        ? source.routes.slice(0, 100).map((item) => ({
            ...projectedRecord(item, [
              "id",
              "model_id",
              "node",
              "runtime",
              "role",
              "status",
              "status_reason",
              "max_context_tokens",
            ]),
            capabilities: projectedStrings(jsonRecord(item)?.capabilities),
            eligible_for: projectedStrings(jsonRecord(item)?.eligible_for),
          }))
        : [],
      selection: projectedRecord(source.selection, ["policy"]),
    };
  }
  if (route === "modes") {
    return {
      ...projectedRecord(source, ["kind", "default", "default_execution_profile"]),
      modes: Array.isArray(source.modes)
        ? source.modes
            .slice(0, 100)
            .map((item) => projectedRecord(item, ["key", "label", "best_for", "caution"]))
        : [],
      execution_profiles: Array.isArray(source.execution_profiles)
        ? source.execution_profiles
            .slice(0, 100)
            .map((item) => projectedRecord(item, ["key", "label", "summary", "caution"]))
        : [],
    };
  }
  if (route.endsWith("events")) {
    return {
      ...projectedRecord(source, ["api_version", "task_id"]),
      events: projectedEvents(source.events),
    };
  }
  if (typeof source.id === "string" && typeof source.status === "string") {
    return projectedTask(source);
  }
  const envelope = projectedRecord(source, ["api_version"]);
  if ("task" in source) envelope.task = projectedTask(source.task);
  if ("current" in source) envelope.current = projectedTask(source.current);
  if (Array.isArray(source.tasks)) envelope.tasks = source.tasks.map(projectedTask).filter(Boolean);
  if (Object.keys(envelope).length > 0) return envelope;
  return projectedTask(source);
}

function harnessPathSegment(part: string): string {
  let decoded = part;
  try {
    decoded = decodeURIComponent(part);
  } catch {
    throw new TypeError("Harness path contains invalid encoding");
  }
  if (decoded === "." || decoded === "..") {
    throw new TypeError("Harness path cannot contain dot segments");
  }
  return encodeURIComponent(part);
}

async function downstreamHarnessResponse(
  upstream: Response,
  namespace: "v1" | "api",
  path: string[],
  target: HarnessTarget,
): Promise<Response> {
  if (!upstream.ok) {
    const headers = downstreamResponseHeaders(upstream.headers);
    headers.delete("etag");
    headers.delete("last-modified");
    headers.set("content-type", "application/json");
    return new Response(
      JSON.stringify({
        error: "The externally managed Harness rejected the request.",
        upstream_status: upstream.status,
      }),
      {
        status: upstream.status,
        headers,
      },
    );
  }
  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return Response.json({ error: "Harness setup returned invalid JSON" }, { status: 502 });
  }
  const projected = projectHarnessPayload(payload, namespace, path, target);
  if (!projected) {
    return Response.json(
      { error: "Harness returned an invalid response contract" },
      { status: 502 },
    );
  }
  const headers = downstreamResponseHeaders(upstream.headers);
  headers.delete("etag");
  headers.delete("last-modified");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(projected), { status: upstream.status, headers });
}

export function harnessTargetUrl(
  path: string[],
  namespace: "v1" | "api" = "v1",
  target: HarnessTarget = "managed",
): string {
  const targetPath = path.map(harnessPathSegment).join("/");
  return `${harnessBaseUrl(target)}/${namespace}/${targetPath}`;
}

async function proxyToHarnessNamespace(
  request: Request,
  path: string[],
  namespace: "v1" | "api",
  target: HarnessTarget,
  bodyLimitBytes = 256 * 1024,
): Promise<Response> {
  if (!isHarnessRouteAllowed(request.method, path, namespace, target)) {
    return Response.json(
      { error: "Harness route is not available through Local Studio" },
      {
        status: 404,
      },
    );
  }
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    !hasHarnessMutationConsent(request)
  ) {
    return Response.json(
      {
        code: "harness_remote_data_consent_required",
        error: "Confirm that Local Studio may send this request to the externally managed Harness.",
        consent_version: HARNESS_REMOTE_DATA_CONSENT_VERSION,
      },
      { status: 428 },
    );
  }
  const token = harnessToken(target);
  if (!token) {
    return Response.json(
      {
        error: `Harness authentication is not configured for the ${target} integration`,
      },
      { status: 503 },
    );
  }
  const sourceUrl = new URL(request.url);
  let upstreamTarget: string;
  try {
    upstreamTarget = `${harnessTargetUrl(path, namespace, target)}${sourceUrl.search}`;
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Harness path is invalid" },
      { status: 400 },
    );
  }
  const headers = upstreamRequestHeaders(request.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("x-agentic-harness-client-scope", "remote");

  let body: ArrayBuffer | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const bounded = await readRequestBytesWithinLimit(request, bodyLimitBytes);
    if (!bounded.ok) return Response.json({ error: bounded.error }, { status: bounded.status });
    body = new ArrayBuffer(bounded.value.byteLength);
    new Uint8Array(body).set(bounded.value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamTarget, {
      method: request.method,
      headers,
      body,
      signal: request.signal,
      cache: "no-store",
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return Response.json(
      {
        error: `agentic harness unreachable at ${harnessBaseUrl(target)}: ${
          error instanceof Error ? error.message : "fetch failed"
        }`,
      },
      { status: 502 },
    );
  }

  return downstreamHarnessResponse(upstream, namespace, path, target);
}

export function proxyToHarness(
  request: Request,
  path: string[],
  bodyLimitBytes = 256 * 1024,
): Promise<Response> {
  return proxyToHarnessNamespace(request, path, "v1", "managed", bodyLimitBytes);
}

/**
 * Proxy the managed local-goal API separately from the read-only integration
 * API. Keeping the namespace explicit prevents a UI caller from accidentally
 * turning a v1 canary endpoint into a privileged durable-goal action.
 */
export function proxyToManagedHarness(
  request: Request,
  path: string[],
  bodyLimitBytes = 256 * 1024,
): Promise<Response> {
  return proxyToHarnessNamespace(request, path, "api", "managed", bodyLimitBytes);
}

export function proxyToProviderHarness(
  request: Request,
  path: string[],
  bodyLimitBytes = 256 * 1024,
): Promise<Response> {
  return proxyToHarnessNamespace(request, path, "api", "provider", bodyLimitBytes);
}
