import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parametersPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(packageDirectory, "infra/main.parameters.example.json");
const policyPath = join(packageDirectory, "policy.xml");
const bicepPath = join(packageDirectory, "infra/main.bicep");
const parameters = JSON.parse(readFileSync(parametersPath, "utf8"));
const policy = readFileSync(policyPath, "utf8");
const bicep = readFileSync(bicepPath, "utf8");
const valueOf = (name, fallback) => parameters.parameters[name]?.value ?? fallback;
const apiId = valueOf("apiId", "local-studio-ai");
const configuredRevision = valueOf("apiRevision");
const namedValues = valueOf("namedValues");
const secretNames = Object.keys(valueOf("keyVaultNamedValues", {}));

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const renderRevision = (revision) => {
  const prefix = `${apiId}-${revision}-`;
  const backends = [`${prefix}content-safety`, `${prefix}foundry`];
  const values = {
    ...namedValues,
    "content-safety-backend-id": backends[0],
    "foundry-backend-id": backends[1],
  };
  const names = [...Object.keys(values), ...secretNames];
  const renderedPolicy = names.reduce(
    (current, name) => current.replaceAll(`{{${name}}}`, `{{${prefix}${name}}}`),
    policy,
  );
  const references = [...renderedPolicy.matchAll(/\{\{([a-z0-9-._]+)\}\}/gu)].map(
    (match) => match[1],
  );
  assert.ok(references.length > 0);
  assert.ok(references.every((name) => name.startsWith(prefix)));
  assert.ok(backends.every((name) => name.length <= 80));
  assert.ok(names.every((name) => `${prefix}${name}`.length <= 256));
  return {
    prefix,
    backends,
    namedValues: names.map((name) => `${prefix}${name}`).sort(),
    renderedPolicy,
  };
};

const nextRevision = configuredRevision === "isolation-next" ? "isolation-after" : "isolation-next";
const configured = renderRevision(configuredRevision);
const candidate = renderRevision(nextRevision);
const configuredResources = new Set([...configured.backends, ...configured.namedValues]);
const sharedResources = [...candidate.backends, ...candidate.namedValues].filter((name) =>
  configuredResources.has(name),
);

assert.deepEqual(sharedResources, []);
assert.notEqual(configured.renderedPolicy, candidate.renderedPolicy);
assert.match(bicep, /var apiPolicySnapshot = reduce\(/u);
assert.match(bicep, /name: '\$\{snapshotPrefix\}\$\{item\.key\}'/u);
assert.match(bicep, /var foundryBackendId = '\$\{snapshotPrefix\}foundry'/u);
assert.match(bicep, /var contentSafetyBackendId = '\$\{snapshotPrefix\}content-safety'/u);

process.stdout.write(
  `${JSON.stringify(
    {
      schema: "local-studio.apim-revision-isolation/v1",
      parameters: basename(parametersPath),
      template_sha256: sha256(policy),
      configured: {
        revision: configuredRevision,
        prefix: configured.prefix,
        backend_ids: configured.backends,
        named_value_count: configured.namedValues.length,
        rendered_policy_sha256: sha256(configured.renderedPolicy),
      },
      candidate: {
        revision: nextRevision,
        prefix: candidate.prefix,
        backend_ids: candidate.backends,
        named_value_count: candidate.namedValues.length,
        rendered_policy_sha256: sha256(candidate.renderedPolicy),
      },
      shared_mutable_resources: sharedResources,
    },
    null,
    2,
  )}\n`,
);
