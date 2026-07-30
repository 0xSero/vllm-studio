import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

if (process.argv.length !== 5) {
  throw new Error("usage: validate-rollback.mjs <manifest> <parameters-file> <policy-file>");
}

const [, , manifestPath, parametersPath, policyPath] = process.argv;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const requiredFields = [
  "api_id",
  "approved_revision",
  "approval_reference",
  "approved_at",
  "approval_expires_at",
  "policy_sha256",
  "parameters_sha256",
  "required_checks",
];

if (
  !manifest ||
  typeof manifest !== "object" ||
  Array.isArray(manifest) ||
  Object.keys(manifest).sort().join(",") !== requiredFields.sort().join(",")
) {
  throw new Error("Rollback manifest fields do not match the approved contract");
}

if (!/^[A-Za-z0-9._-]+$/u.test(manifest.api_id)) {
  throw new Error("Rollback api_id contains unsafe characters");
}
if (!/^[A-Za-z0-9._-]{1,100}$/u.test(manifest.approved_revision)) {
  throw new Error("Rollback approved_revision contains unsafe characters");
}
if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,255}$/u.test(manifest.approval_reference)) {
  throw new Error("Rollback approval_reference is invalid");
}

const approvedAt = Date.parse(manifest.approved_at);
const expiresAt = Date.parse(manifest.approval_expires_at);
const now = Date.now();
if (
  !Number.isFinite(approvedAt) ||
  !Number.isFinite(expiresAt) ||
  approvedAt > now + 300_000 ||
  expiresAt <= now ||
  expiresAt - approvedAt > 86_400_000
) {
  throw new Error("Rollback approval window is invalid or expired");
}

const requiredChecks = [
  "configuration-pairing",
  "content-safety",
  "managed-identity",
  "negative-authorization",
  "streaming",
  "telemetry",
];
if (
  !Array.isArray(manifest.required_checks) ||
  manifest.required_checks.slice().sort().join(",") !== requiredChecks.sort().join(",")
) {
  throw new Error("Rollback manifest does not carry every required verification gate");
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const expectedPolicy = sha256(policyPath);
const expectedParameters = sha256(parametersPath);
const parameters = JSON.parse(readFileSync(parametersPath, "utf8"));
const parameterApiId = parameters?.parameters?.apiId?.value ?? "local-studio-ai";
const parameterRevision = parameters?.parameters?.apiRevision?.value;
if (manifest.api_id !== parameterApiId || manifest.approved_revision !== parameterRevision) {
  throw new Error("Rollback target does not match the approved parameter document");
}
if (manifest.policy_sha256 !== expectedPolicy) {
  throw new Error("Rollback policy digest does not match the approved manifest");
}
if (manifest.parameters_sha256 !== expectedParameters) {
  throw new Error("Rollback parameter digest does not match the approved manifest");
}

process.stdout.write("Validated approved rollback manifest\n");
