import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const validatorPath = join(packageDirectory, "scripts/validate.mjs");
const rollbackValidatorPath = join(packageDirectory, "scripts/validate-rollback.mjs");
const examplePath = join(packageDirectory, "infra/main.parameters.example.json");
const policy = readFileSync(join(packageDirectory, "policy.xml"), "utf8");
const bicep = readFileSync(join(packageDirectory, "infra/main.bicep"), "utf8");
const example = JSON.parse(readFileSync(examplePath, "utf8"));

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const runConfigurationValidation = (document) => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-apim-contract-"));
  const path = join(directory, "parameters.json");
  writeFileSync(path, JSON.stringify(document));
  const result = spawnSync(
    process.execPath,
    [validatorPath, path, document.parameters.apimServiceName.value, "--configuration-only"],
    { encoding: "utf8" },
  );
  rmSync(directory, { force: true, recursive: true });
  return result;
};

const expectDenied = (mutate, expected) => {
  const document = clone(example);
  mutate(document);
  const result = runConfigurationValidation(document);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, expected);
};

const approvedRollbackManifest = () => {
  const approvedAt = new Date();
  return {
    api_id: "local-studio-ai",
    approved_revision: example.parameters.apiRevision.value,
    approval_reference: "change:approved-123",
    approved_at: approvedAt.toISOString(),
    approval_expires_at: new Date(approvedAt.getTime() + 3_600_000).toISOString(),
    policy_sha256: sha256(join(packageDirectory, "policy.xml")),
    parameters_sha256: sha256(examplePath),
    required_checks: [
      "configuration-pairing",
      "content-safety",
      "managed-identity",
      "negative-authorization",
      "streaming",
      "telemetry",
    ],
  };
};

const runRollbackValidation = (manifest) => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-apim-rollback-"));
  const manifestPath = join(directory, "rollback.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = spawnSync(
    process.execPath,
    [rollbackValidatorPath, manifestPath, examplePath, join(packageDirectory, "policy.xml")],
    { encoding: "utf8" },
  );
  rmSync(directory, { force: true, recursive: true });
  return result;
};

const createFakeAzure = (revision) => {
  const directory = mkdtempSync(join(tmpdir(), "local-studio-apim-azure-"));
  const executable = join(directory, "az");
  const log = join(directory, "calls.jsonl");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.APIM_FAKE_AZ_LOG, JSON.stringify(args) + "\\n");
if (args.slice(0, 4).join(" ") === "apim api revision list") {
  process.stdout.write(args.includes("--query") ? process.env.APIM_FAKE_REVISION + "\\n" : JSON.stringify([{ apiRevision: process.env.APIM_FAKE_REVISION, isCurrent: false }]));
  process.exit(0);
}
if (args.slice(0, 4).join(" ") === "apim api release create") process.exit(0);
process.stderr.write("unexpected az invocation\\n");
process.exit(2);
`,
  );
  chmodSync(executable, 0o755);
  return { directory, log, revision };
};

const runAzureScript = (fake, script, args) =>
  spawnSync("bash", [join(packageDirectory, "scripts", script), ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      APIM_FAKE_AZ_LOG: fake.log,
      APIM_FAKE_REVISION: fake.revision,
      PATH: `${fake.directory}:${process.env.PATH}`,
    },
  });

test("accepts the checked-in secret-free deployment contract", () => {
  const result = runConfigurationValidation(example);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /Validated APIM configuration/u);
});

test("accepts deployment-owned values without weakening the schema", () => {
  const document = clone(example);
  document.parameters.apimServiceName.value = "governed-apim";
  document.parameters.appInsightsLoggerResourceId.value =
    "/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/governed-rg/providers/Microsoft.ApiManagement/service/governed-apim/loggers/applicationinsights";
  document.parameters.contentSafetyAccountName.value = "governed-safety";
  document.parameters.contentSafetyEndpoint.value =
    "https://governed-safety.cognitiveservices.azure.com";
  document.parameters.foundryAccountName.value = "governed-foundry";
  document.parameters.keyVaultName.value = "governed-vault";
  const values = document.parameters.namedValues.value;
  values["accepted-tenant"] = "11111111-1111-1111-1111-111111111111";
  values["entra-tenant-id"] = "11111111-1111-1111-1111-111111111111";
  values["entra-issuer"] =
    "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0";
  values["foundry-project-endpoint"] =
    "https://governed-foundry.services.ai.azure.com/api/projects/research";
  values["allowed-models"] = "gpt-4.1,gpt-5";
  const result = runConfigurationValidation(document);
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
});

test("rejects undeclared deployment parameters", () => {
  expectDenied((document) => {
    document.parameters.unreviewed = { value: "denied" };
  }, /Undeclared deployment parameters/u);
  expectDenied((document) => {
    document.parameters.foundrySubscriptionId = { value: false };
  }, /foundrySubscriptionId must match its schema type/u);
});

test("rejects issuer and tenant drift", () => {
  expectDenied((document) => {
    document.parameters.namedValues.value["accepted-tenant"] =
      "11111111-1111-1111-1111-111111111111";
  }, /Accepted tenant and Entra issuer/u);
  expectDenied((document) => {
    document.parameters.namedValues.value["keycloak-openid-configuration"] =
      "https://other.example.com/realms/local-studio/.well-known/openid-configuration";
  }, /Keycloak discovery/u);
});

test("rejects malformed allowlists and role sets", () => {
  expectDenied((document) => {
    document.parameters.namedValues.value["allowed-models"] = "gpt-4.1,";
  }, /allowed-models must contain unique/u);
  expectDenied((document) => {
    document.parameters.namedValues.value["agent-operation-roles"] =
      "LocalStudio.Scientist,LocalStudio.Scientist";
  }, /agent-operation-roles must contain unique/u);
  expectDenied((document) => {
    document.parameters.namedValues.value["clearance-claim"] = "invalid claim";
  }, /clearance-claim is not a valid identifier/u);
});

test("rejects unbounded limits and backend substitution", () => {
  expectDenied((document) => {
    document.parameters.namedValues.value["request-max-bytes"] = "10485761";
  }, /request-max-bytes must be an integer/u);
  expectDenied((document) => {
    document.parameters.namedValues.value["foundry-backend-id"] = "untrusted-backend";
  }, /foundry-backend-id is generated by the deployment/u);
  expectDenied((document) => {
    document.parameters.namedValues.value["foundry-project-endpoint"] =
      "https://other.services.ai.azure.com/api/projects/project";
  }, /foundry-project-endpoint must identify/u);
  expectDenied((document) => {
    document.parameters.namedValues.value["foundry-project-endpoint"] =
      "https://replace-foundry-account.services.ai.azure.com/api/projects/%2e%2e";
  }, /foundry-project-endpoint must identify/u);
  expectDenied((document) => {
    document.parameters.namedValues.value["apim-api-audience"] =
      "https://user@example.com/local-studio";
  }, /apim-api-audience must be an api or HTTPS URI/u);
});

test("rejects version-pinned and cross-vault secret references", () => {
  expectDenied((document) => {
    document.parameters.keyVaultNamedValues.value["client-secret"] =
      "https://replace-key-vault.vault.azure.net/secrets/client-secret/version";
  }, /must use an unversioned Azure secret URL/u);
  expectDenied((document) => {
    document.parameters.keyVaultNamedValues.value["client-secret"] =
      "https://other-vault.vault.azure.net/secrets/client-secret";
  }, /must use an unversioned Azure secret URL/u);
  expectDenied((document) => {
    document.parameters.keyVaultNamedValues.value["client-secret"] =
      "https://replace-key-vault.vault.azure.net/secrets/client-secret";
  }, /Unused Key Vault named values/u);
});

test("uses gateway-generated correlation and a TLS-validated Foundry backend", () => {
  assert.match(policy, /context\.RequestId\.ToString\(\)/u);
  assert.doesNotMatch(policy, /Headers\.GetValueOrDefault\("x-correlation-id"/u);
  assert.match(policy, /set-backend-service backend-id="\{\{foundry-backend-id\}\}"/u);
  assert.match(bicep, /name: foundryBackendId/u);
  assert.match(bicep, /var snapshotPrefix = '\$\{apiId\}-\$\{apiRevision\}-'/u);
  assert.match(bicep, /value: apiPolicySnapshot/u);
  assert.match(bicep, /validateCertificateChain: true/u);
  assert.match(bicep, /validateCertificateName: true/u);
});

test("requires a digest-bound, unexpired rollback approval", () => {
  const manifest = approvedRollbackManifest();
  const accepted = runRollbackValidation(manifest);
  assert.equal(accepted.status, 0, `${accepted.stdout}${accepted.stderr}`);
  manifest.policy_sha256 = "0".repeat(64);
  const denied = runRollbackValidation(manifest);
  assert.notEqual(denied.status, 0);
  assert.match(`${denied.stdout}${denied.stderr}`, /policy digest does not match/u);
  manifest.policy_sha256 = sha256(join(packageDirectory, "policy.xml"));
  manifest.required_checks.pop();
  const incomplete = runRollbackValidation(manifest);
  assert.notEqual(incomplete.status, 0);
  assert.match(`${incomplete.stdout}${incomplete.stderr}`, /every required verification gate/u);
  const mismatched = approvedRollbackManifest();
  mismatched.approved_revision = "1";
  const wrongTarget = runRollbackValidation(mismatched);
  assert.notEqual(wrongTarget.status, 0);
  assert.match(`${wrongTarget.stdout}${wrongTarget.stderr}`, /target does not match/u);
});

test("executes promotion and digest-bound rollback without contacting Azure", () => {
  const revision = example.parameters.apiRevision.value;
  const fake = createFakeAzure(revision);
  const promotion = runAzureScript(fake, "promote-revision.sh", [
    "governed-rg",
    "replace-apim-name",
    "local-studio-ai",
    revision,
  ]);
  assert.equal(promotion.status, 0, `${promotion.stdout}${promotion.stderr}`);
  const manifestPath = join(fake.directory, "rollback.json");
  writeFileSync(manifestPath, JSON.stringify(approvedRollbackManifest()));
  const rollback = runAzureScript(fake, "rollback-revision.sh", [
    "governed-rg",
    "replace-apim-name",
    manifestPath,
    examplePath,
  ]);
  assert.equal(rollback.status, 0, `${rollback.stdout}${rollback.stderr}`);
  const calls = readFileSync(fake.log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  rmSync(fake.directory, { force: true, recursive: true });
  assert.equal(
    calls.filter((args) => args.slice(0, 4).join(" ") === "apim api release create").length,
    2,
  );
  assert.ok(calls.some((args) => args.includes("--query")));
  assert.match(rollback.stdout, /Validated APIM configuration/u);
  assert.match(rollback.stdout, /Validated approved rollback manifest/u);
});
