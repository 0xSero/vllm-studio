import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const policy = readFileSync(join(root, "deploy/azure/apim/policy.xml"), "utf8");
const openapi = readFileSync(join(root, "deploy/azure/apim/api.openapi.yaml"), "utf8");
const parameters = JSON.parse(
  readFileSync(join(root, "deploy/azure/apim/parameters.example.json"), "utf8"),
) as Record<string, string>;
const diagnostics = JSON.parse(
  readFileSync(join(root, "deploy/azure/apim/diagnostics.example.json"), "utf8"),
) as Record<string, unknown>;
const bicep = readFileSync(join(root, "deploy/azure/apim/infra/main.bicep"), "utf8");
const roleModules = ["cognitive-role-assignment.bicep", "key-vault-role-assignment.bicep"]
  .map((name) => readFileSync(join(root, "deploy/azure/apim/infra/modules", name), "utf8"))
  .join("\n");
const deploymentParameters = JSON.parse(
  readFileSync(join(root, "deploy/azure/apim/infra/main.parameters.example.json"), "utf8"),
) as { parameters: { keyVaultNamedValues: { value: Record<string, string> } } };
const parameterSchema = JSON.parse(
  readFileSync(join(root, "deploy/azure/apim/parameters.schema.json"), "utf8"),
) as { properties: { parameters: { required: string[] } } };
const scriptsDirectory = join(root, "deploy/azure/apim/scripts");
const previewDirectory = join(root, "deploy/azure/apim-preview");

describe("standard APIM Foundry package", () => {
  test("declares exactly the stable public operations", () => {
    expect(openapi.match(/operationId:/gu)?.length).toBe(5);
    for (const operation of [
      "models-list",
      "chat-completions",
      "responses-create",
      "agents-list",
      "agent-invoke",
    ]) {
      expect(openapi).toContain(`operationId: ${operation}`);
      expect(policy).toContain(`context.Operation.Id == &quot;${operation}&quot;`);
    }
  });

  test("cryptographically validates both issuers before claim authorization", () => {
    expect(policy).toContain("<validate-azure-ad-token");
    expect(policy).toContain("<validate-jwt");
    expect(policy.match(/output-token-variable-name="validated-jwt"/gu)?.length).toBe(2);
    expect(policy).toContain("{{accepted-tenant}}");
    expect(policy).toContain("{{clearance-claim}}");
    expect(policy).toContain("C2");
    expect(policy).toContain("{{model-operation-roles}}");
    expect(policy).toContain("{{agent-operation-roles}}");
  });

  test("enforces operation governance before backend dispatch", () => {
    for (const control of [
      "rate-limit-by-key",
      "validate-content",
      "llm-content-safety",
      "llm-token-limit",
      "llm-emit-token-metric",
      "{{allowed-models}}",
      "{{allowed-agents}}",
      '<trace source="local-studio-ai-gateway"',
    ]) {
      expect(policy).toContain(control);
    }
    expect(policy).toContain('<categories output-type="EightSeverityLevels">');
    expect(policy).not.toContain("<azure-openai-token-limit");
    expect(policy).not.toContain("<azure-openai-emit-token-metric");
    expect(policy).toContain('body["agent_reference"]');
    expect(policy).toContain('new JProperty("type", "agent_reference")');
    expect(policy.indexOf("{{allowed-models}}")).toBeLessThan(
      policy.indexOf('template="/openai/v1/chat/completions"'),
    );
    expect(policy.indexOf("{{allowed-agents}}")).toBeLessThan(
      policy.indexOf('template="/openai/v1/responses"', policy.indexOf("agent-input")),
    );
    expect(policy.indexOf("{{allowed-models}}")).toBeLessThan(
      policy.indexOf("<llm-content-safety"),
    );
    expect(policy.indexOf("{{allowed-agents}}")).toBeLessThan(
      policy.indexOf("<llm-content-safety"),
    );
    expect(policy.indexOf("<validate-content")).toBeLessThan(policy.indexOf("{{allowed-models}}"));
    expect(policy.indexOf("<validate-azure-ad-token")).toBeLessThan(
      policy.indexOf('name="subject"'),
    );
    expect(policy.indexOf("<validate-jwt")).toBeLessThan(policy.indexOf('name="subject"'));
    expect(policy).toContain('context.Operation.Id == "models-list" ? "{{allowed-models}}"');
    expect(policy).toContain('body["data"] = new JArray');
    expect(policy.indexOf('body["data"] = new JArray')).toBeGreaterThan(
      policy.indexOf("<outbound>"),
    );
    for (const reason of ["tenant", "clearance", "role", "model", "agent", "operation"]) {
      expect(policy).toContain(`denied reason=${reason} correlation=`);
    }
    expect(policy.match(/severity="warning"/gu)?.length).toBe(6);
    expect(policy.match(/name="x-correlation-id" exists-action="override"/gu)?.length).toBe(9);
  });

  test("removes caller credentials and routes through the managed identity backend", () => {
    for (const route of [
      "/openai/v1/models",
      "/openai/v1/chat/completions",
      "/openai/v1/responses",
      "/agents",
    ]) {
      expect(policy).toContain(`template="${route}"`);
    }
    expect(policy).toContain("<value>v1</value>");
    const managedIdentityIndex = policy.indexOf("<authentication-managed-identity");
    for (const header of [
      "Authorization",
      "Proxy-Authorization",
      "api-key",
      "x-api-key",
      "Ocp-Apim-Subscription-Key",
      "x-functions-key",
      "Cookie",
    ]) {
      expect(policy).toContain(`name="${header}" exists-action="delete"`);
      expect(policy.indexOf(`name="${header}" exists-action="delete"`)).toBeLessThan(
        managedIdentityIndex,
      );
    }
    expect(policy).toContain('resource="https://ai.azure.com"');
    expect(policy).toContain('set-backend-service backend-id="{{foundry-backend-id}}"');
    expect(policy).toContain('value="@(context.RequestId.ToString())"');
    expect(policy).not.toContain('Headers.GetValueOrDefault("x-correlation-id"');
  });

  test("ships non-secret named values and redacted diagnostics", () => {
    for (const name of [
      "accepted-tenant",
      "allowed-agents",
      "allowed-models",
      "apim-api-audience",
      "foundry-project-endpoint",
      "request-max-bytes",
      "token-quota-per-minute",
    ]) {
      expect(parameters[name]).toBeTruthy();
    }
    expect(deploymentParameters.parameters.keyVaultNamedValues.value).toEqual({});
    const serializedDiagnostics = JSON.stringify(diagnostics);
    expect(serializedDiagnostics).not.toContain("authorization");
    expect(serializedDiagnostics).not.toContain("api-key");
    expect(serializedDiagnostics).not.toContain("request-body");
  });

  test("deploys an immutable standard APIM revision and its dependencies", () => {
    for (const resource of [
      "Microsoft.ApiManagement/service/apis@2024-05-01",
      "Microsoft.ApiManagement/service/namedValues@2024-05-01",
      "Microsoft.ApiManagement/service/backends@2024-05-01",
      "Microsoft.ApiManagement/service/apis/policies@2024-05-01",
      "Microsoft.ApiManagement/service/apis/diagnostics@2024-05-01",
      "Microsoft.Authorization/roleAssignments@2022-04-01",
    ]) {
      expect(`${bicep}\n${roleModules}`).toContain(resource);
    }
    expect(bicep).toContain("var apiName = '${apiId};rev=${apiRevision}'");
    expect(bicep).toContain("name: apiName");
    expect(bicep).toContain("param bootstrapRevision bool = false");
    expect(bicep).toContain("isCurrent: bootstrapRevision");
    expect(bicep).toContain("apim.identity.principalId");
    expect(bicep).toContain("scheme: 'ManagedIdentity'");
    expect(bicep).toContain("var foundryBackendId = '${snapshotPrefix}foundry'");
    expect(bicep).toContain("name: '${snapshotPrefix}${item.key}'");
    expect(bicep).toContain("value: apiPolicySnapshot");
    expect(bicep).toContain("url: string(namedValues['foundry-project-endpoint'])");
    expect(bicep).toContain("keyVault: {");
    expect(bicep).toContain("secretIdentifier: string(item.value)");
    expect(readFileSync(join(scriptsDirectory, "validate.mjs"), "utf8")).toContain(
      "must use an unversioned Azure secret URL",
    );
  });

  test("binds the APIM identity to the narrow deployment roles", () => {
    for (const role of [
      "53ca6127-db72-4b80-b1b0-d745d6d5456d",
      "a97b65f3-24c7-4388-baec-2e87135dc908",
      "4633458b-17de-408a-b874-0445c86b69e6",
    ]) {
      expect(bicep).toContain(role);
    }
    expect(bicep).not.toContain("Owner");
    expect(bicep).not.toContain("Contributor");
  });

  test("ships explicit deployment, validation, promotion, and rollback commands", () => {
    for (const script of [
      "deploy.sh",
      "enable-system-identity.sh",
      "preflight-azure.sh",
      "prove-revision-isolation.mjs",
      "promote-revision.sh",
      "rollback-revision.sh",
      "validate-azure.sh",
      "validate-rollback.mjs",
      "validate.mjs",
    ]) {
      expect(existsSync(join(scriptsDirectory, script))).toBe(true);
    }
    const promotion = readFileSync(join(scriptsDirectory, "promote-revision.sh"), "utf8");
    const rollback = readFileSync(join(scriptsDirectory, "rollback-revision.sh"), "utf8");
    expect(promotion).toContain("az apim api release create");
    expect(promotion).toContain("--api-revision");
    expect(promotion).toContain("is already current");
    expect(rollback).toContain("rollback-manifest");
    expect(rollback).toContain("validate-rollback.mjs");
    expect(parameterSchema.properties.parameters.required).toContain("namedValues");
    expect(readFileSync(join(scriptsDirectory, "preflight-azure.sh"), "utf8")).toContain(
      "bootstrapRevision=true",
    );
  });

  test("keeps the preview profile non-deployable", () => {
    const deployables = readdirSync(previewDirectory).filter((name) =>
      /\.(bicep|bicepparam|json|sh|mjs)$/u.test(name),
    );
    expect(deployables).toEqual([]);
  });
});
