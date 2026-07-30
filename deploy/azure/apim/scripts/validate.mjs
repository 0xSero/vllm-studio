import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(scriptsDirectory, "..");
const repositoryDirectory = resolve(packageDirectory, "../../..");
const previewDirectory = resolve(packageDirectory, "../apim-preview");
const policyPath = join(packageDirectory, "policy.xml");
const schemaPath = join(packageDirectory, "parameters.schema.json");
const legacyParametersPath = join(packageDirectory, "parameters.example.json");
const parametersPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(packageDirectory, "infra/main.parameters.example.json");
const bicepPath = join(packageDirectory, "infra/main.bicep");
const policy = readFileSync(policyPath, "utf8");
const bicep = readFileSync(bicepPath, "utf8");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const parameters = JSON.parse(readFileSync(parametersPath, "utf8"));
const parameterValues = parameters?.parameters;
const schemaParameterProperties = schema?.properties?.parameters?.properties;
const schemaRequiredParameters = schema?.properties?.parameters?.required;

if (
  !schemaParameterProperties ||
  typeof schemaParameterProperties !== "object" ||
  Array.isArray(schemaParameterProperties) ||
  !Array.isArray(schemaRequiredParameters)
) {
  throw new Error("Deployment parameter schema is malformed");
}

if (
  parameters?.$schema !==
    "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#" ||
  parameters?.contentVersion !== "1.0.0.0" ||
  Object.keys(parameters).some(
    (name) => !["$schema", "contentVersion", "parameters"].includes(name),
  )
) {
  throw new Error("Deployment parameter envelope does not match parameters.schema.json");
}

if (!parameterValues || typeof parameterValues !== "object" || Array.isArray(parameterValues)) {
  throw new Error("Deployment parameters must contain a parameters object");
}

const undeclaredParameters = Object.keys(parameterValues).filter(
  (name) => !(name in schemaParameterProperties),
);
if (undeclaredParameters.length > 0) {
  throw new Error(`Undeclared deployment parameters: ${undeclaredParameters.join(", ")}`);
}

const valueOf = (name) => {
  const entry = parameterValues[name];
  if (
    !entry ||
    typeof entry !== "object" ||
    Array.isArray(entry) ||
    Object.keys(entry).length !== 1 ||
    !("value" in entry)
  ) {
    throw new Error(`Deployment parameter ${name} must have a value`);
  }
  return entry.value;
};

for (const name of schemaRequiredParameters) {
  valueOf(name);
}

for (const [name, entry] of Object.entries(parameterValues)) {
  const reference = schemaParameterProperties[name]?.$ref;
  const definitionName =
    typeof reference === "string"
      ? reference.match(/^#\/\$defs\/([A-Za-z]+Parameter)$/u)?.[1]
      : null;
  const expectedType = definitionName
    ? schema?.$defs?.[definitionName]?.properties?.value?.type
    : null;
  const value = valueOf(name);
  const actualType = Array.isArray(value) ? "array" : typeof value;
  if (
    !expectedType ||
    actualType !== expectedType ||
    (expectedType === "object" && (value === null || Array.isArray(value))) ||
    (expectedType === "string" && value.length === 0)
  ) {
    throw new Error(`Deployment parameter ${name} must match its schema type`);
  }
}

const namedValues = valueOf("namedValues");
const keyVaultNamedValues = valueOf("keyVaultNamedValues");

if (!namedValues || typeof namedValues !== "object" || Array.isArray(namedValues)) {
  throw new Error("namedValues must be an object");
}
if (
  !keyVaultNamedValues ||
  typeof keyVaultNamedValues !== "object" ||
  Array.isArray(keyVaultNamedValues)
) {
  throw new Error("keyVaultNamedValues must be an object");
}
if (typeof valueOf("bootstrapRevision") !== "boolean") {
  throw new Error("bootstrapRevision must be a boolean");
}

const apiRevision = valueOf("apiRevision");
if (typeof apiRevision !== "string" || !/^[A-Za-z0-9._-]{1,100}$/u.test(apiRevision)) {
  throw new Error("apiRevision must use 1-100 safe identifier characters");
}
const apiId = parameterValues.apiId?.value ?? "local-studio-ai";
if (
  typeof apiId !== "string" ||
  apiId.length > 80 ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(apiId)
) {
  throw new Error("apiId must use safe identifier characters");
}
const snapshotPrefix = `${apiId}-${apiRevision}-`;
for (const backendId of [`${snapshotPrefix}content-safety`, `${snapshotPrefix}foundry`]) {
  if (backendId.length > 80) {
    throw new Error("apiId and apiRevision produce an oversized APIM backend identifier");
  }
}
if (
  typeof valueOf("apiRevisionDescription") !== "string" ||
  valueOf("apiRevisionDescription").length < 1 ||
  valueOf("apiRevisionDescription").length > 256
) {
  throw new Error("apiRevisionDescription must contain 1 through 256 characters");
}

const validateParameterString = (name, pattern, minimumLength, maximumLength) => {
  const value = valueOf(name);
  if (
    typeof value !== "string" ||
    value.length < minimumLength ||
    value.length > maximumLength ||
    !pattern.test(value)
  ) {
    throw new Error(`Deployment parameter ${name} is invalid`);
  }
};

validateParameterString("apimServiceName", /^[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u, 1, 50);
for (const name of [
  "contentSafetyResourceGroupName",
  "foundryResourceGroupName",
  "keyVaultResourceGroupName",
]) {
  validateParameterString(name, /^(?!.*\.$)[A-Za-z0-9_().-]+$/u, 1, 90);
}
for (const name of ["contentSafetyAccountName", "foundryAccountName"]) {
  validateParameterString(name, /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u, 2, 64);
}
validateParameterString("keyVaultName", /^[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u, 3, 24);
for (const name of [
  "contentSafetySubscriptionId",
  "foundrySubscriptionId",
  "keyVaultSubscriptionId",
]) {
  if (parameterValues[name]) {
    validateParameterString(
      name,
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu,
      36,
      36,
    );
  }
}

const expectedApimService = process.argv[3] ?? valueOf("apimServiceName");
if (
  typeof expectedApimService !== "string" ||
  expectedApimService.length > 50 ||
  !/^[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(expectedApimService)
) {
  throw new Error("Target APIM service name is invalid");
}
const loggerResourceId = valueOf("appInsightsLoggerResourceId");
const loggerMatch =
  typeof loggerResourceId === "string"
    ? loggerResourceId.match(
        /^\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.ApiManagement\/service\/([^/]+)\/loggers\/([^/]+)$/iu,
      )
    : null;
if (!loggerMatch || loggerMatch[1].toLowerCase() !== expectedApimService.toLowerCase()) {
  throw new Error(
    "appInsightsLoggerResourceId must identify a logger under the target APIM service",
  );
}

const parseUrl = (value, label) => {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
};

const contentSafetyEndpoint = parseUrl(valueOf("contentSafetyEndpoint"), "contentSafetyEndpoint");
if (
  contentSafetyEndpoint.protocol !== "https:" ||
  contentSafetyEndpoint.hostname.toLowerCase() !==
    `${valueOf("contentSafetyAccountName")}.cognitiveservices.azure.com`.toLowerCase() ||
  contentSafetyEndpoint.username !== "" ||
  contentSafetyEndpoint.password !== "" ||
  contentSafetyEndpoint.port !== "" ||
  !["", "/"].includes(contentSafetyEndpoint.pathname) ||
  contentSafetyEndpoint.search !== "" ||
  contentSafetyEndpoint.hash !== ""
) {
  throw new Error("contentSafetyEndpoint must be an origin-only Azure Cognitive Services URL");
}

const placeholders = [...policy.matchAll(/\{\{([a-z0-9-]+)\}\}/gu)].map((match) => match[1]);
const generatedNamedValueNames = new Set(["content-safety-backend-id", "foundry-backend-id"]);
for (const name of generatedNamedValueNames) {
  if (name in namedValues || name in keyVaultNamedValues) {
    throw new Error(`Named value ${name} is generated by the deployment`);
  }
}
const configuredNamedValueNames = new Set([
  ...Object.keys(namedValues),
  ...Object.keys(keyVaultNamedValues),
  ...generatedNamedValueNames,
]);
const missing = [...new Set(placeholders)].filter((name) => !configuredNamedValueNames.has(name));
const bicepNamedValues = [...bicep.matchAll(/namedValues\['([a-z0-9-]+)'\]/gu)].map(
  (match) => match[1],
);
const consumedNamedValues = new Set([...placeholders, ...bicepNamedValues]);
const unused = Object.keys(namedValues).filter((name) => !consumedNamedValues.has(name));

if (missing.length > 0) throw new Error(`Missing named values: ${missing.join(", ")}`);
if (unused.length > 0) throw new Error(`Unused named values: ${unused.join(", ")}`);
for (const [name, value] of Object.entries(namedValues)) {
  if (
    !/^[A-Za-z0-9-._]{1,256}$/u.test(name) ||
    `${snapshotPrefix}${name}`.length > 256 ||
    typeof value !== "string" ||
    value === ""
  ) {
    throw new Error(`Named value ${name} must have a valid name and nonempty string value`);
  }
}

const foundryProjectEndpoint = parseUrl(
  namedValues["foundry-project-endpoint"],
  "foundry-project-endpoint",
);
if (
  foundryProjectEndpoint.protocol !== "https:" ||
  foundryProjectEndpoint.hostname.toLowerCase() !==
    `${valueOf("foundryAccountName")}.services.ai.azure.com`.toLowerCase() ||
  foundryProjectEndpoint.username !== "" ||
  foundryProjectEndpoint.password !== "" ||
  foundryProjectEndpoint.port !== "" ||
  !/^\/api\/projects\/[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/u.test(foundryProjectEndpoint.pathname) ||
  foundryProjectEndpoint.search !== "" ||
  foundryProjectEndpoint.hash !== ""
) {
  throw new Error("foundry-project-endpoint must identify one Microsoft Foundry project");
}

const tenantId = namedValues["entra-tenant-id"];
const acceptedTenant = namedValues["accepted-tenant"];
const entraIssuer = parseUrl(namedValues["entra-issuer"], "entra-issuer");
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(tenantId) ||
  acceptedTenant.toLowerCase() !== tenantId.toLowerCase() ||
  entraIssuer.href !== `https://login.microsoftonline.com/${tenantId}/v2.0`
) {
  throw new Error("Accepted tenant and Entra issuer must exactly match the configured tenant");
}

const keycloakIssuer = parseUrl(namedValues["keycloak-issuer"], "keycloak-issuer");
const keycloakDiscovery = parseUrl(
  namedValues["keycloak-openid-configuration"],
  "keycloak-openid-configuration",
);
if (
  keycloakIssuer.protocol !== "https:" ||
  keycloakIssuer.username !== "" ||
  keycloakIssuer.password !== "" ||
  keycloakDiscovery.username !== "" ||
  keycloakDiscovery.password !== "" ||
  keycloakDiscovery.origin !== keycloakIssuer.origin ||
  keycloakDiscovery.pathname !==
    `${keycloakIssuer.pathname.replace(/\/$/u, "")}/.well-known/openid-configuration` ||
  keycloakIssuer.search !== "" ||
  keycloakIssuer.hash !== "" ||
  keycloakDiscovery.search !== "" ||
  keycloakDiscovery.hash !== ""
) {
  throw new Error("Keycloak discovery must be HTTPS and derived from the exact issuer");
}

const parseBoundedInteger = (name, minimum, maximum) => {
  const raw = namedValues[name];
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
};

parseBoundedInteger("request-max-bytes", 1024, 10_485_760);
parseBoundedInteger("request-quota-calls", 1, 100_000);
parseBoundedInteger("token-quota-per-minute", 1, 100_000_000);
if (!/^[0-7]$/u.test(namedValues["content-safety-threshold"])) {
  throw new Error("content-safety-threshold must be an integer from 0 through 7");
}

const validateIdentifier = (name, pattern) => {
  const value = namedValues[name];
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${name} is not a valid identifier`);
  }
};

for (const name of ["clearance-claim", "entra-role-claim", "keycloak-role-claim"]) {
  validateIdentifier(name, /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/u);
}

const validateCsv = (name, pattern, maximumItems) => {
  const value = namedValues[name];
  const entries = typeof value === "string" ? value.split(",") : [];
  if (
    entries.length < 1 ||
    entries.length > maximumItems ||
    entries.some((entry) => !pattern.test(entry)) ||
    new Set(entries).size !== entries.length
  ) {
    throw new Error(`${name} must contain unique comma-separated identifiers`);
  }
};

validateCsv("allowed-agents", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, 100);
validateCsv("allowed-models", /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u, 100);
validateCsv("agent-operation-roles", /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u, 20);
validateCsv("model-operation-roles", /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u, 20);

const apiAudience = parseUrl(namedValues["apim-api-audience"], "apim-api-audience");
if (
  !["api:", "https:"].includes(apiAudience.protocol) ||
  apiAudience.username !== "" ||
  apiAudience.password !== "" ||
  apiAudience.hostname === "" ||
  apiAudience.search !== "" ||
  apiAudience.hash !== ""
) {
  throw new Error("apim-api-audience must be an api or HTTPS URI without query or fragment");
}
for (const [name, secretIdentifier] of Object.entries(keyVaultNamedValues)) {
  if (!/^[A-Za-z0-9-._]{1,256}$/u.test(name) || `${snapshotPrefix}${name}`.length > 256) {
    throw new Error(`Key Vault named value ${name} has an invalid name`);
  }
  if (name in namedValues) throw new Error(`Named value ${name} is declared as plain and secret`);
  const secretUrl = parseUrl(secretIdentifier, `Key Vault named value ${name}`);
  const segments = secretUrl.pathname.split("/").filter(Boolean);
  if (
    secretUrl.protocol !== "https:" ||
    secretUrl.hostname.toLowerCase() !==
      `${valueOf("keyVaultName")}.vault.azure.net`.toLowerCase() ||
    secretUrl.username !== "" ||
    secretUrl.password !== "" ||
    secretUrl.port !== "" ||
    segments.length !== 2 ||
    segments[0] !== "secrets" ||
    secretUrl.search !== "" ||
    secretUrl.hash !== ""
  ) {
    throw new Error(`Key Vault named value ${name} must use an unversioned Azure secret URL`);
  }
}
const unusedSecretNames = Object.keys(keyVaultNamedValues).filter(
  (name) => !placeholders.includes(name),
);
if (unusedSecretNames.length > 0) {
  throw new Error(`Unused Key Vault named values: ${unusedSecretNames.join(", ")}`);
}

const previewEntries = readdirSync(previewDirectory, { recursive: true, withFileTypes: true });
if (
  previewEntries.length !== 1 ||
  !previewEntries[0].isFile() ||
  previewEntries[0].name !== "README.md"
) {
  throw new Error(
    `Preview profile must contain only README.md: ${previewEntries.map(({ name }) => name).join(", ")}`,
  );
}

const legacyNamedValues = JSON.parse(readFileSync(legacyParametersPath, "utf8"));
const sortedKeys = (value) => JSON.stringify(Object.keys(value).sort());
if (sortedKeys(legacyNamedValues) !== sortedKeys(namedValues)) {
  throw new Error("Legacy and deployable named-value names have drifted");
}

if (process.argv.includes("--configuration-only")) {
  process.stdout.write(`Validated APIM configuration with ${basename(parametersPath)}\n`);
  process.exit(0);
}

execFileSync("xmllint", ["--noout", policyPath], { stdio: "inherit" });
execFileSync("node", ["--test", "deploy/azure/apim/tests/hermetic-contract.test.mjs"], {
  cwd: repositoryDirectory,
  stdio: "inherit",
});
execFileSync("bun", ["test", "controller/tests/apim-policy-contract.test.ts"], {
  cwd: repositoryDirectory,
  stdio: "inherit",
});
execFileSync("node", ["deploy/azure/apim/scripts/prove-revision-isolation.mjs", parametersPath], {
  cwd: repositoryDirectory,
  stdio: "inherit",
});

const outputDirectory = mkdtempSync(join(tmpdir(), "local-studio-apim-"));
try {
  execFileSync(
    "az",
    ["bicep", "build", "--file", bicepPath, "--outfile", join(outputDirectory, "main.json")],
    { stdio: "inherit" },
  );
} finally {
  rmSync(outputDirectory, { force: true, recursive: true });
}

process.stdout.write(
  `Validated ${basename(packageDirectory)} stable deployment package with ${basename(parametersPath)}\n`,
);
