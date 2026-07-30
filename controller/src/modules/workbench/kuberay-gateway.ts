import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import { isHttpStatus, serviceUnavailable } from "../../core/errors";
import type { ScientificRayJobRecord, ScientificRayJobResource } from "./types";

type FetchEffect = (
  input: string | URL | Request,
  init?: RequestInit,
) => Effect.Effect<Response, unknown>;

export type KubeRayGatewayConfig = {
  apiUrl: string;
  tokenFile: string;
  caFile?: string;
};

export type KubeRayGatewayProbe = {
  kubernetesVersion: string;
  rayApiVersion: string;
};

const KubernetesRayJobSchema = Schema.Struct({
  metadata: Schema.Struct({
    uid: Schema.optional(Schema.String),
    resourceVersion: Schema.optional(Schema.String),
  }),
  status: Schema.optional(
    Schema.Struct({
      jobStatus: Schema.optional(Schema.String),
      jobDeploymentStatus: Schema.optional(Schema.String),
      message: Schema.optional(Schema.String),
      startTime: Schema.optional(Schema.String),
      endTime: Schema.optional(Schema.String),
    }),
  ),
});

const KubernetesVersionSchema = Schema.Struct({
  gitVersion: Schema.String,
});

const KubernetesApiResourceListSchema = Schema.Struct({
  groupVersion: Schema.String,
  resources: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      verbs: Schema.Array(Schema.String),
    }),
  ),
});

type KubernetesRayJob = Schema.Schema.Type<typeof KubernetesRayJobSchema>;

const resourcePath = (resource: ScientificRayJobResource): string =>
  `/apis/ray.io/v1/namespaces/${encodeURIComponent(resource.metadata.namespace)}/rayjobs/${encodeURIComponent(resource.metadata.name)}`;

const gatewayState = (
  jobStatus: string | null,
  deploymentStatus: string | null,
): ScientificRayJobRecord["state"] => {
  if (jobStatus === "SUCCEEDED" || deploymentStatus === "Complete") return "succeeded";
  if (jobStatus === "FAILED" || deploymentStatus === "Failed") return "failed";
  if (deploymentStatus === "Suspended" || deploymentStatus === "Suspending") return "suspended";
  if (deploymentStatus === "Running") return "running";
  return "submitted";
};

const clusterStatus = (
  value: KubernetesRayJob,
): NonNullable<ScientificRayJobRecord["cluster"]> => ({
  uid: value.metadata.uid ?? null,
  resource_version: value.metadata.resourceVersion ?? null,
  job_status: value.status?.jobStatus ?? null,
  deployment_status: value.status?.jobDeploymentStatus ?? null,
  message: value.status?.message ?? null,
  started_at: value.status?.startTime ?? null,
  ended_at: value.status?.endTime ?? null,
});

const runtimeFetch: FetchEffect = (input, init) =>
  Effect.tryPromise({
    try: () => fetch(input, init),
    catch: (error) => error,
  });

export class KubeRayGateway {
  public constructor(
    private readonly config: KubeRayGatewayConfig,
    private readonly fetcher: FetchEffect = runtimeFetch,
    private readonly readCredential: (path: string) => string = (path) =>
      readFileSync(path, "utf8"),
  ) {}

  private headers(contentType?: string): Headers {
    const token = this.readCredential(this.config.tokenFile).trim();
    if (!token) throw serviceUnavailable("KubeRay workload token is empty");
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    });
    if (contentType) headers.set("Content-Type", contentType);
    return headers;
  }

  private requestInit(method: string, body?: string): RequestInit {
    const init: RequestInit & { tls?: { ca: string } } = {
      method,
      headers: this.headers(body ? "application/apply-patch+yaml" : undefined),
      signal: AbortSignal.timeout(15_000),
      ...(body ? { body } : {}),
    };
    if (this.config.caFile) {
      init.tls = { ca: this.readCredential(this.config.caFile) };
    }
    return init;
  }

  private request(url: string, method: string, body?: string): Effect.Effect<Response, unknown> {
    return Effect.try({
      try: () => this.requestInit(method, body),
      catch: () => serviceUnavailable("KubeRay credential material is unavailable"),
    }).pipe(
      Effect.flatMap((init) =>
        Effect.suspend(() => {
          try {
            return this.fetcher(url, init);
          } catch {
            return Effect.fail(serviceUnavailable("KubeRay API request failed"));
          }
        }),
      ),
      Effect.mapError((error) =>
        isHttpStatus(error) ? error : serviceUnavailable("KubeRay API request failed"),
      ),
    );
  }

  private decode(response: Response): Effect.Effect<KubernetesRayJob, unknown> {
    if (!response.ok) {
      return Effect.fail(
        serviceUnavailable(`KubeRay API returned HTTP ${response.status}`),
      );
    }
    return Effect.tryPromise({
      try: () => response.json(),
      catch: (error) => error,
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(KubernetesRayJobSchema)),
      Effect.mapError(() => serviceUnavailable("KubeRay API returned an invalid RayJob document")),
    );
  }

  private decodeProbe<A>(
    response: Response,
    decode: (value: unknown) => A,
    target: string,
  ): Effect.Effect<A, unknown> {
    if (!response.ok) {
      return Effect.fail(serviceUnavailable(`${target} returned HTTP ${response.status}`));
    }
    return Effect.tryPromise({
      try: async () => decode(await response.json()),
      catch: () => serviceUnavailable(`${target} returned an invalid document`),
    });
  }

  public probe(): Effect.Effect<KubeRayGatewayProbe, unknown> {
    return Effect.all(
      [
        this.request(`${this.config.apiUrl}/version`, "GET").pipe(
          Effect.flatMap((response) =>
            this.decodeProbe(
              response,
              Schema.decodeUnknownSync(KubernetesVersionSchema),
              "Kubernetes version endpoint",
            ),
          ),
        ),
        this.request(`${this.config.apiUrl}/apis/ray.io/v1`, "GET").pipe(
          Effect.flatMap((response) =>
            this.decodeProbe(
              response,
              Schema.decodeUnknownSync(KubernetesApiResourceListSchema),
              "RayJob API",
            ),
          ),
        ),
      ],
      { concurrency: 2 },
    ).pipe(
      Effect.flatMap(([kubernetes, ray]) => {
        const rayJobs = ray.resources.find((resource) => resource.name === "rayjobs");
        if (!rayJobs || !["get", "patch"].every((verb) => rayJobs.verbs.includes(verb))) {
          return Effect.fail(
            serviceUnavailable("RayJob API does not advertise required get and patch operations"),
          );
        }
        return Effect.succeed({
          kubernetesVersion: kubernetes.gitVersion,
          rayApiVersion: ray.groupVersion,
        });
      }),
    );
  }

  public apply(resource: ScientificRayJobResource): Effect.Effect<KubernetesRayJob, unknown> {
    const query = new URLSearchParams({ fieldManager: "local-studio-workbench" });
    const url = `${this.config.apiUrl}${resourcePath(resource)}?${query.toString()}`;
    return this.request(url, "PATCH", JSON.stringify(resource)).pipe(
      Effect.flatMap((response) => this.decode(response)),
    );
  }

  public get(resource: ScientificRayJobResource): Effect.Effect<KubernetesRayJob, unknown> {
    return this.request(`${this.config.apiUrl}${resourcePath(resource)}`, "GET").pipe(
      Effect.flatMap((response) => this.decode(response)),
    );
  }

  public submit(
    record: ScientificRayJobRecord,
    now: string,
  ): Effect.Effect<ScientificRayJobRecord, unknown> {
    if (record.state !== "queued") {
      return Effect.fail(serviceUnavailable(`RayJob cannot submit from ${record.state}`));
    }
    return this.apply(record.resource).pipe(
      Effect.map((observed) => {
        const cluster = clusterStatus(observed);
        return {
          ...record,
          state: gatewayState(cluster.job_status, cluster.deployment_status),
          submitted_at: record.submitted_at ?? now,
          reconciled_at: now,
          cluster,
        };
      }),
    );
  }

  public reconcile(
    record: ScientificRayJobRecord,
    now: string,
  ): Effect.Effect<ScientificRayJobRecord, unknown> {
    if (!["submitted", "running", "suspended"].includes(record.state)) {
      return Effect.fail(serviceUnavailable(`RayJob cannot reconcile from ${record.state}`));
    }
    return this.get(record.resource).pipe(
      Effect.map((observed) => {
        const cluster = clusterStatus(observed);
        return {
          ...record,
          state: gatewayState(cluster.job_status, cluster.deployment_status),
          reconciled_at: now,
          cluster,
        };
      }),
    );
  }
}
