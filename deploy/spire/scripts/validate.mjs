import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const valuesText = readFileSync(resolve(root, "values.yaml"), "utf8");
const config = JSON.parse(readFileSync(resolve(root, "workload-identity.example.json"), "utf8"));
const tensorPrime = JSON.parse(
  readFileSync(resolve(root, "tensorprime-connection-profile.json"), "utf8"),
);
const expected = ["local-studio-frontend", "local-studio-controller", "local-studio-agent-runtime"];
const errors = [];

if (!valuesText.includes(`trustDomain: ${config.trust_domain}`)) {
  errors.push("trust domain differs between Helm and runtime configuration");
}
if (!/recommendations:\s*\n\s+enabled: true/u.test(valuesText)) {
  errors.push("SPIRE recommendations are not enabled");
}
if (!/default:\s*\n\s+enabled: false/u.test(valuesText)) {
  errors.push("catch-all workload identity must be disabled");
}
if (config.x509_mtls !== "required") {
  errors.push("X.509-SVID mTLS is not required");
}
if (config.endpoint !== "unix:///run/spiffe/workload/spire-agent.sock") {
  errors.push("Workload API endpoint does not match the CSI socket");
}
if (
  tensorPrime.trust_domain !== config.trust_domain ||
  tensorPrime.workload_api?.endpoint !== config.endpoint
) {
  errors.push("TensorPrime profile differs from the SPIFFE workload configuration");
}
if (
  tensorPrime.spiffe_id_template !==
  `spiffe://${tensorPrime.trust_domain}/ns/{namespace}/sa/{serviceaccount}`
) {
  errors.push("TensorPrime SPIFFE ID template is invalid");
}
if (
  tensorPrime.capabilities?.service_mtls_enforcement !== "not-configured" ||
  tensorPrime.capabilities?.ray_tls !== "not-configured"
) {
  errors.push("TensorPrime Phase-0 transport limitations are not preserved");
}
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
for (const service of tensorPrime.services ?? []) {
  requiredServiceIds.delete(service.id);
  if (
    service.transport_security !== "plaintext" ||
    service.server_mtls_enforced !== false ||
    !/^(?:grpc|http):\/\//u.test(service.url)
  ) {
    errors.push(`TensorPrime service ${service.id ?? "unknown"} overstates transport security`);
  }
}
if (requiredServiceIds.size > 0) {
  errors.push(`TensorPrime service catalog is incomplete: ${[...requiredServiceIds].join(", ")}`);
}
if (
  /"(?:api[_-]?key|password|private[_-]?key|token|secret)"\s*:/iu.test(JSON.stringify(tensorPrime))
) {
  errors.push("TensorPrime profile contains a secret-bearing field");
}
for (const name of expected) {
  const start = valuesText.indexOf(`${name}:`);
  const end = valuesText.indexOf("\n        local-studio-", start + name.length);
  const identity = valuesText.slice(start, end < 0 ? undefined : end);
  if (start < 0 || !identity.includes("enabled: true")) {
    errors.push(`${name} identity is not enabled`);
  }
  if (!identity.includes("app.kubernetes.io/component")) {
    errors.push(`${name} has no exact workload selector`);
  }
  if (!identity.includes("jwtTTL: 5m")) errors.push(`${name} JWT-SVID TTL is not five minutes`);
}
if (/\b(?:authorized_delegates|broker)\b/u.test(valuesText)) {
  errors.push("delegated or broker identity authority is present");
}
for (const key of ["frontend_id", "controller_id", "agent_runtime_id"]) {
  if (!config[key]?.startsWith(`spiffe://${config.trust_domain}/`)) {
    errors.push(`${key} is outside the configured trust domain`);
  }
}
if (errors.length) {
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.exit(1);
}
process.stdout.write("SPIRE deployment contract validated\n");
