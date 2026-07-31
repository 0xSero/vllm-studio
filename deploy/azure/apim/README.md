# Standard APIM deployment

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/group/github/ci/sybil-solutions/local-studio+github/license/sybil-solutions/local-studio.svg?variant=secondary&mode=dark">
  <img alt="CI, license" src="https://shieldcn.dev/group/github/ci/sybil-solutions/local-studio+github/license/sybil-solutions/local-studio.svg?variant=secondary&mode=light">
</picture>

This package deploys the governed `/ai/v1` API into an existing standard Azure API Management service. It imports a non-current API revision, revision-scoped named values, Key Vault references, the API policy, revision-scoped Foundry and Azure AI Content Safety backends, diagnostics, and managed-identity role assignments.

The package does not create APIM, Microsoft Foundry, Content Safety, Key Vault, or Application Insights. Those resources remain deployment-owned. The target APIM service must be in the deployment resource group. Referenced resources may be in other resource groups or subscriptions visible to the deployment principal.

## Inputs

Copy `infra/main.parameters.example.json` outside the repository and replace every example value. The contract is defined by `parameters.schema.json` and enforced by `scripts/validate.mjs`; undeclared parameters, malformed allowlists, duplicate roles, issuer drift, tenant drift, unbounded quotas, endpoint substitution, and versioned, cross-vault, or unused secret references fail validation. `appInsightsLoggerResourceId` identifies an existing Application Insights logger under the APIM service. `keyVaultNamedValues` is an object whose keys are policy-consumed APIM named-value names and whose values are unversioned `https://<vault>.vault.azure.net/secrets/<name>` identifiers; the parameter is secure and the example is deliberately empty.

The deployment principal needs read and child-resource write access on APIM plus role-assignment write access at the Foundry account, Content Safety account, and Key Vault scopes. APIM receives:

- Foundry User on the Foundry account for model and project-agent invocation.
- Cognitive Services User on Content Safety.
- Key Vault Secrets User only when Key Vault-backed named values are declared.

## Local validation

Install the Azure CLI Bicep component, then run:

```sh
az bicep install
node deploy/azure/apim/scripts/validate.mjs
```

This compiles Bicep, checks XML and schema-bound parameter completeness, runs positive and negative hermetic APIM contracts, proves two revisions render to disjoint named-value and backend identities, and rejects deployable artifacts in the preview profile. The hermetic suite proves local configuration and policy structure only; it does not execute the policy gateway.

## Azure validation and deployment

Azure deployment remains gated by the repository deployment workflow. After an Azure preparation plan exists and validation is authorized:

```sh
deploy/azure/apim/scripts/validate-azure.sh <resource-group> <apim-service-name> <parameters-file>
deploy/azure/apim/scripts/deploy.sh <resource-group> <apim-service-name> <parameters-file>
```

Identity preparation is explicit and separate from validation and deployment:

```sh
deploy/azure/apim/scripts/enable-system-identity.sh <resource-group> <apim-service-name>
```

The preparation command preserves an existing user-assigned identity, enables the system-assigned identity, and waits for its principal. Validation and deployment fail rather than mutate identity when it is absent. Preflight verifies the supported APIM SKU, APIM logger, Foundry and Content Safety resource kinds, and Key Vault RBAC mode.

For the first API revision only, set `bootstrapRevision` to `true`. This creates the first current revision at the otherwise unused `/ai/v1` path. The deploy script rejects bootstrap mode once an API exists and rejects a non-bootstrap deployment when no current API exists. Every subsequent deployment keeps the new revision non-current.

Every revision receives a `${apiId}-${apiRevision}-` configuration prefix. Bicep rewrites policy named-value references to that snapshot and deploys uniquely named Foundry and Content Safety backends, so preparing a revision cannot mutate the configuration serving the current revision. Retain a revision's named values and backends for the entire rollback window. Remove them only through a separately reviewed retirement change after that revision can no longer be promoted.

## Promotion and rollback

Promote only a revision that passed live negative authorization, content-safety, streaming, telemetry, and managed-identity checks. Re-running promotion for the current revision is a no-op:

```sh
deploy/azure/apim/scripts/promote-revision.sh <resource-group> <apim-service-name> local-studio-ai <revision>
```

Rollback requires a time-bounded approval manifest that binds the policy template and parameter SHA-256 digests to the target revision. Run rollback from the approved revision artifact checkout, copy `rollback-manifest.example.json` outside the repository, fill its approval fields and exact digests, and retain the approving change record. The required checks must record negative authorization, content safety, managed identity, streaming, telemetry, and configuration pairing:

```sh
deploy/azure/apim/scripts/rollback-revision.sh <resource-group> <apim-service-name> <rollback-manifest> <parameters-file>
```

Promotion and rollback create APIM releases; neither silently infers a target revision. The rollback script rejects expired approvals and digest drift, then confirms the selected revision became current. After rollback, repeat the live denied-issuer, denied-audience, denied-role, denied-clearance, denied-tenant, model allowlist, agent allowlist, Content Safety, managed-identity, streaming, quota, diagnostics, and correlation checks before restoring client traffic.

## Security and diagnostics

The gateway replaces caller correlation values with its own request identifier, validates both supported token types before reading authorization claims, enforces body size before parsing, denies unadmitted models and agents before Content Safety or Foundry calls, removes inbound bearer, proxy, API-key, subscription-key, function-key, and cookie credentials, acquires a distinct Foundry token with managed identity, and routes only through the deployed TLS-validating Foundry backend. Policy-owned denial responses carry the gateway correlation identifier and emit warning traces with immutable subject and tenant identifiers. Application Insights diagnostics capture no request or response bodies, client IPs, authorization headers, API keys, or backend tokens.

Anyone who can edit an APIM policy can indirectly use the APIM managed identity. Limit API and policy write permissions, review role assignments, and require the same revision evidence used for promotion. The Foundry backend, model allowlist, agent allowlist, issuer mappings, and APIM named values are a single promotion unit.
