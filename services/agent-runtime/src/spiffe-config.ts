import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  WorkloadIdentityConfigSchema,
  type WorkloadIdentityConfig,
} from "@local-studio/contracts/workload-identity";
import { Schema } from "effect";
import {
  loadTensorPrimeConnectionProfile,
  validateTensorPrimeWorkloadBinding,
} from "./tensorprime-profile";

let cached: WorkloadIdentityConfig | null | undefined;

const validTrustDomain = (value: string): boolean =>
  value.length <= 255 &&
  value.split(".").every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label),
  );

const assertSpiffeId = (value: string, trustDomain: string): void => {
  const url = new URL(value);
  if (
    url.protocol !== "spiffe:" ||
    url.hostname !== trustDomain ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname === "/" ||
    url.pathname.includes("//") ||
    value.includes("%") ||
    url.toString() !== value
  ) {
    throw new Error("SPIFFE identity configuration is invalid");
  }
};

export const loadWorkloadIdentityConfig = (): WorkloadIdentityConfig | null => {
  if (cached !== undefined) return cached;
  const path = process.env["LOCAL_STUDIO_SPIFFE_CONFIG"]?.trim();
  if (!path) {
    cached = null;
    return cached;
  }
  const decoded = Schema.decodeUnknownSync(WorkloadIdentityConfigSchema)(
    JSON.parse(readFileSync(resolve(path), "utf8")) as unknown,
  );
  if (decoded.mode === "disabled") {
    cached = decoded;
    return cached;
  }
  const endpoint = new URL(decoded.endpoint);
  if (
    endpoint.protocol !== "unix:" ||
    endpoint.hostname ||
    !endpoint.pathname.startsWith("/") ||
    endpoint.pathname === "/" ||
    endpoint.search ||
    endpoint.hash ||
    decoded.endpoint.includes("%") ||
    decoded.endpoint !== `unix://${endpoint.pathname}` ||
    !validTrustDomain(decoded.trust_domain) ||
    decoded.agent_runtime_audience !== decoded.agent_runtime_audience.trim() ||
    decoded.controller_audience !== decoded.controller_audience.trim() ||
    !decoded.agent_runtime_audience ||
    !decoded.controller_audience ||
    decoded.agent_runtime_audience === decoded.controller_audience
  ) {
    throw new Error("SPIFFE workload configuration is invalid");
  }
  assertSpiffeId(decoded.frontend_id, decoded.trust_domain);
  assertSpiffeId(decoded.controller_id, decoded.trust_domain);
  assertSpiffeId(decoded.agent_runtime_id, decoded.trust_domain);
  if (
    new Set([decoded.frontend_id, decoded.controller_id, decoded.agent_runtime_id]).size !== 3
  ) {
    throw new Error("SPIFFE workload identities must be distinct");
  }
  const tensorPrime = loadTensorPrimeConnectionProfile();
  if (tensorPrime) {
    validateTensorPrimeWorkloadBinding(tensorPrime, decoded.trust_domain, decoded.endpoint);
  }
  cached = decoded;
  return cached;
};

export const resetWorkloadIdentityConfigForTest = (): void => {
  cached = undefined;
};

export const resolveX509MtlsMode = (
  config: WorkloadIdentityConfig | null,
): "disabled" | "optional" | "required" => config?.x509_mtls ?? "disabled";

export const resolveAgentRuntimeBindHostname = (
  config: WorkloadIdentityConfig | null,
  configured = process.env["LOCAL_STUDIO_AGENT_RUNTIME_HOST"],
): string => {
  const hostname = configured?.trim() || "127.0.0.1";
  if (!/^[a-zA-Z0-9.:-]+$/u.test(hostname)) {
    throw new Error("Agent runtime bind hostname is invalid");
  }
  const loopback = new Set(["127.0.0.1", "::1", "localhost"]);
  if (!loopback.has(hostname) && config?.mode !== "required") {
    throw new Error("Non-loopback agent runtime binding requires SPIFFE workload identity");
  }
  return hostname;
};
