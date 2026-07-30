import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  TensorPrimeConnectionProfileSchema,
  TensorPrimeSvidReadinessEvidenceSchema,
  type TensorPrimeConnectionProfile,
  type TensorPrimeSvidReadinessEvidence,
} from "@local-studio/contracts/tensorprime";
import { Schema } from "effect";

export type TensorPrimeSvidObservation = {
  checkedAt: Date;
  expiresAt: Date;
  rotationGeneration: number;
  spiffeId: string;
};

let cached: TensorPrimeConnectionProfile | null | undefined;
let cachedPath: string | undefined;

const requiredComponents = new Set(["frontend", "controller", "agent-runtime"]);
const requiredServiceIds = new Set([
  "ray-client",
  "ray-dashboard",
  "ray-serve",
  "vllm-gemma4",
  "vllm-qwen3-next",
  "litellm-gateway",
  "embedding-http",
  "embedding-grpc",
  "whisper-asr",
  "gemma4-external",
  "qwen3-next-external",
  "platform-api-external",
  "llm-api-external",
]);

const validTrustDomain = (value: string): boolean =>
  value.length <= 255 &&
  value
    .split(".")
    .every(
      (label) =>
        label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
    );

const canonicalSpiffeId = (value: string, trustDomain: string): boolean => {
  const endpoint = new URL(value);
  return (
    endpoint.protocol === "spiffe:" &&
    endpoint.hostname === trustDomain &&
    !endpoint.username &&
    !endpoint.password &&
    !endpoint.port &&
    !endpoint.search &&
    !endpoint.hash &&
    endpoint.pathname !== "/" &&
    !endpoint.pathname.includes("//") &&
    !value.includes("%") &&
    endpoint.toString() === value
  );
};

const expectedSpiffeId = (
  profile: TensorPrimeConnectionProfile,
  namespace: string,
  serviceAccount: string,
): string =>
  profile.spiffe_id_template
    .replace("{namespace}", namespace)
    .replace("{serviceaccount}", serviceAccount);

const validateWorkloadIdentities = (profile: TensorPrimeConnectionProfile): void => {
  const ids = new Set<string>();
  const components = new Set<string>();
  for (const identity of profile.identities) {
    const expected = expectedSpiffeId(profile, identity.namespace, identity.service_account);
    if (
      identity.spiffe_id !== expected ||
      !canonicalSpiffeId(identity.spiffe_id, profile.trust_domain)
    ) {
      throw new Error("TensorPrime workload identity is invalid");
    }
    if (ids.has(identity.spiffe_id)) {
      throw new Error("TensorPrime workload identities must be unique");
    }
    if (components.has(identity.component)) {
      throw new Error("TensorPrime workload components must be unique");
    }
    ids.add(identity.spiffe_id);
    components.add(identity.component);
  }
  if ([...requiredComponents].some((component) => !components.has(component))) {
    throw new Error("TensorPrime workload identity catalog is incomplete");
  }
};

const validateServiceEndpoint = (
  service: TensorPrimeConnectionProfile["services"][number],
): void => {
  const endpoint = new URL(service.url);
  if (
    !["http:", "grpc:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.pathname !== "" && endpoint.pathname !== "/")
  ) {
    throw new Error("TensorPrime service endpoint is invalid");
  }
  if (
    (service.protocol === "http" && endpoint.protocol !== "http:") ||
    (service.protocol === "grpc" && endpoint.protocol !== "grpc:")
  ) {
    throw new Error("TensorPrime service protocol differs from its endpoint");
  }
  if (service.host_header === null) return;
  const host = new URL(`http://${service.host_header}`);
  if (
    host.hostname !== service.host_header ||
    host.port ||
    host.pathname !== "/" ||
    host.search ||
    host.hash
  ) {
    throw new Error("TensorPrime Host header is invalid");
  }
};

const validateServices = (profile: TensorPrimeConnectionProfile): void => {
  const services = new Set<string>();
  for (const service of profile.services) {
    if (services.has(service.id)) throw new Error("TensorPrime service IDs must be unique");
    services.add(service.id);
    validateServiceEndpoint(service);
  }
  if ([...requiredServiceIds].some((id) => !services.has(id))) {
    throw new Error("TensorPrime service catalog is incomplete");
  }
};

const validateProfile = (profile: TensorPrimeConnectionProfile): TensorPrimeConnectionProfile => {
  if (!validTrustDomain(profile.trust_domain)) {
    throw new Error("TensorPrime trust domain is invalid");
  }
  if (
    profile.spiffe_id_template !==
    `spiffe://${profile.trust_domain}/ns/{namespace}/sa/{serviceaccount}`
  ) {
    throw new Error("TensorPrime SPIFFE ID template is invalid");
  }
  const socket = profile.workload_api.socket_path;
  if (
    profile.workload_api.mount_path !== "/run/spiffe/workload" ||
    socket !== `${profile.workload_api.mount_path}/spire-agent.sock` ||
    profile.workload_api.endpoint !== `unix://${socket}`
  ) {
    throw new Error("TensorPrime Workload API socket is invalid");
  }
  if (!Number.isInteger(profile.x509_svid.ttl_seconds) || profile.x509_svid.ttl_seconds < 60) {
    throw new Error("TensorPrime X.509-SVID TTL is invalid");
  }
  validateWorkloadIdentities(profile);
  validateServices(profile);
  return profile;
};

const readinessDetail = (
  svidAvailable: boolean,
  rotationObserved: boolean,
  contradicted: boolean,
): string => {
  if (rotationObserved) {
    return "X.509-SVID availability and rotation were observed; TensorPrime services remain plaintext";
  }
  if (svidAvailable) {
    return "X.509-SVID availability was observed; rotation and TensorPrime service mTLS remain unverified";
  }
  return contradicted
    ? "X.509-SVID readiness observation did not match the configured workload identity"
    : "X.509-SVID issuance is configured but has not been observed by this process";
};

export const loadTensorPrimeConnectionProfile = (
  configuredPath?: string,
): TensorPrimeConnectionProfile | null => {
  const explicit = configuredPath !== undefined;
  const path = (configuredPath ?? process.env["LOCAL_STUDIO_TENSORPRIME_PROFILE"])?.trim();
  if (!explicit && cached !== undefined && cachedPath === path) return cached;
  if (!path) {
    if (!explicit) {
      cached = null;
      cachedPath = undefined;
    }
    return null;
  }
  const profile = validateProfile(
    Schema.decodeUnknownSync(TensorPrimeConnectionProfileSchema, {
      onExcessProperty: "error",
    })(JSON.parse(readFileSync(resolve(path), "utf8")) as unknown),
  );
  if (!explicit) {
    cached = profile;
    cachedPath = path;
  }
  return profile;
};

export const validateTensorPrimeWorkloadBinding = (
  profile: TensorPrimeConnectionProfile,
  trustDomain: string,
  workloadApiEndpoint: string,
): void => {
  if (
    profile.trust_domain !== trustDomain ||
    profile.workload_api.endpoint !== workloadApiEndpoint
  ) {
    throw new Error("TensorPrime profile differs from the SPIFFE workload configuration");
  }
};

export const tensorPrimeSvidReadinessEvidence = (
  profile: TensorPrimeConnectionProfile,
  component: TensorPrimeConnectionProfile["identities"][number]["component"],
  observation?: TensorPrimeSvidObservation,
): TensorPrimeSvidReadinessEvidence => {
  const identity = profile.identities.find((candidate) => candidate.component === component);
  if (!identity) throw new Error("TensorPrime workload identity is not configured");
  const checkedAt = observation?.checkedAt ?? new Date();
  const remainingSeconds = observation
    ? (observation.expiresAt.getTime() - checkedAt.getTime()) / 1000
    : 0;
  const svidAvailable =
    observation !== undefined &&
    observation.spiffeId === identity.spiffe_id &&
    remainingSeconds > 0 &&
    remainingSeconds <= profile.x509_svid.ttl_seconds + 5 &&
    Number.isInteger(observation.rotationGeneration) &&
    observation.rotationGeneration > 0;
  const rotationObserved = svidAvailable && observation.rotationGeneration > 1;
  const contradicted = observation !== undefined && !svidAvailable;
  return Schema.decodeUnknownSync(TensorPrimeSvidReadinessEvidenceSchema)({
    state: svidAvailable ? "observed" : contradicted ? "contradicted" : "claimed",
    checked_at: checkedAt.toISOString(),
    expected_spiffe_id: identity.spiffe_id,
    observed_spiffe_id: observation?.spiffeId ?? null,
    workload_api_endpoint: profile.workload_api.endpoint,
    x509_svid_expires_at: observation?.expiresAt.toISOString() ?? null,
    rotation_generation: observation?.rotationGeneration ?? 0,
    svid_available: svidAvailable,
    rotation_observed: rotationObserved,
    service_mtls_enforced: false,
    ray_tls_configured: false,
    detail: readinessDetail(svidAvailable, rotationObserved, contradicted),
  });
};

export const resetTensorPrimeConnectionProfileForTest = (): void => {
  cached = undefined;
  cachedPath = undefined;
};
