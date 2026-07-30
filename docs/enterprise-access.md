# Enterprise access

Local Studio supports independent Microsoft Entra ID and Keycloak issuers. Shared web deployments use `required_oidc`; desktop loopback can retain `local`.

## Configuration

Set `LOCAL_STUDIO_ENTERPRISE_AUTH_CONFIG` to an absolute JSON file path available to both the frontend and controller. The file follows `EnterpriseAuthConfig` in `controller/contracts/enterprise-auth.ts`. Role and clearance mappings are deployment-owned. Client secrets are supplied only through `LOCAL_STUDIO_OIDC_SECRET_<ISSUER_ID>` and must come from the deployment secret store.

Set `LOCAL_STUDIO_ENTERPRISE_SESSION_KEYS` from the deployment secret store on every frontend instance. Its value is an ordered JSON array such as `[{"id":"2026-07","key":"<at-least-32-bytes>"},{"id":"2026-04","key":"<previous-key>"}]`. The first entry is the write key and remaining entries are read-only migration keys. `LOCAL_STUDIO_ENTERPRISE_SESSION_KEY` remains a single-key compatibility input when the keyring variable is absent. Do not configure both variables; ambiguous dual configuration fails closed. Key identifiers and key material must be unique.

All instances must use the same ordered keyring. The default `LOCAL_STUDIO_ENTERPRISE_STATE_STORE=posix` adapter encrypts session, refresh-token, callback, logout, replay, index, and MSAL cache records in the process-locked, atomically replaced `enterprise-sessions.json`. It coordinates processes on one POSIX host and remains the local desktop compatibility mode.

Shared multi-node deployments set `LOCAL_STUDIO_ENTERPRISE_STATE_STORE=redis`, `LOCAL_STUDIO_ENTERPRISE_REDIS_URL`, and an optional `LOCAL_STUDIO_ENTERPRISE_REDIS_NAMESPACE`. Remote Redis URLs must use `rediss://`; unencrypted `redis://` is accepted only for loopback fixtures. Redis stores the same AES-GCM envelopes, coordinates mutations through optimistic CAS, and uses renewable token-bound leases for refresh and MSAL cache fencing. A configured Redis outage fails closed and never falls back to POSIX. Use a dedicated ACL identity restricted to the configured namespace, require TLS, enable durable replication appropriate to the deployment, and keep Redis credentials in the deployment secret store.

Entra app registrations use authorization code with PKCE and a confidential web redirect:

`https://<local-studio-host>/api/auth/callback/<issuer-id>`

Expose the APIM API scope and assign app roles or groups that are explicitly mapped to Local Studio roles. The Foundry delegated scope is `https://ai.azure.com/.default`.

Keycloak clients use standard authorization code with PKCE, the same redirect pattern, exact issuer and audience values, and explicit realm or client-role mappings. ID and Logout Token signatures default to the registration default `RS256`; set `id_token_signing_algorithm` to `PS256` or `ES256` only when the client registration explicitly selects it and discovery advertises it. Token and revocation client authentication is negotiated from discovery metadata. `client_secret_basic` is preferred, `client_secret_post` is supported, and issuers advertising no supported confidential-client method fail closed. Implicit and resource-owner password grants are not supported.

For Keycloak back-channel logout, set `backchannel_logout` to `{"enabled":true,"session_required":true}` on the issuer and register:

`https://<local-studio-host>/api/auth/backchannel-logout/<issuer-id>`

Keep Keycloak front-channel logout disabled for that client, configure the Backchannel Logout URL to the exact URI, and enable Backchannel logout session required. Local Studio accepts only signed form-posted Logout Tokens from a configured issuer, validates the logout event profile, stores encrypted `jti` replay evidence, and removes sessions through issuer-bound `sid` and `sub` indices. Microsoft Entra currently documents front-channel single sign-out rather than the signed OIDC back-channel protocol, so Entra issuer configuration rejects back-channel enablement instead of claiming unsupported registration.

## APIM

The executable standard-APIM package is under `deploy/azure/apim`. Its Bicep targets an existing APIM service and existing Foundry, Content Safety, Key Vault, and Application Insights resources. It imports the five-operation `/ai/v1` API as a non-current revision, materializes revision-scoped named values and backend entities, binds the policy to that immutable configuration snapshot, applies diagnostics, and binds APIM's system-assigned identity to Foundry User, Cognitive Services User, and conditional Key Vault Secrets User roles. Values containing credentials use unversioned Key Vault-backed secret named values and are not committed.

Run `node deploy/azure/apim/scripts/validate.mjs` for local package validation. The schema-bound validator includes hermetic denial fixtures for issuer, tenant, claim, allowlist, quota, endpoint, secret-reference, and rollback-manifest drift. Azure provider validation, resource preflight, first-revision bootstrap, what-if, deployment, revision promotion, and digest-bound approved-revision rollback are documented in `deploy/azure/apim/README.md`. Do not run the deployment scripts without an authorized and validated Azure deployment plan.

The policy validates Entra or Keycloak tokens before authorization, rate-limits by validated principal, replaces caller-provided correlation values, removes inbound bearer, proxy, API-key, subscription-key, function-key, and cookie credentials, obtains a Foundry backend token with APIM managed identity, and routes through a TLS-validating backend entity. Assign that identity only the Foundry project roles needed for model and agent invocation.

Configure operations for:

- `GET /ai/v1/models`
- `POST /ai/v1/chat/completions`
- `POST /ai/v1/responses`
- `GET /ai/v1/agents`
- `POST /ai/v1/agents/{agentId}/invoke`

The included policy enforces deployment model and agent allowlists, C2 claim mappings, request body limits, content-safety controls, subject-and-tenant quotas, non-streaming token metrics, correlation IDs, and diagnostic redaction. Streaming remains enabled; its usage evidence depends on backend token headers because APIM token-metric emission is applied only to non-streaming operations. Do not promote a policy without negative tests for every denied model, agent, issuer, audience, role, clearance, and tenant.

The preview AI Gateway tier is evaluation-only. Its gateway-wide runtime key model does not replace the per-user authorization boundary required here.

## Rotation and incident response

OIDC signing keys rotate through issuer discovery and JWKS. Invalid discovery, issuer, audience, signature, expiry, nonce, or role mapping fails closed. Authorization callback state is consumed only after issuer, expiry, and constant-time state validation, and logout independently requires the browser CSRF cookie/header proof before deleting a session.

Rotate session encryption keys in three phases. First distribute `[old, new]` to every process so all readers know both keys while writes remain on the old primary. Then distribute `[new, old]`; either rollout cohort can read records written by the other while active records migrate to the new primary on access. Finally, remove the old key only after every process uses the new primary and the maximum session, callback, logout-ticket, and MSAL-cache retention window has elapsed, or after all sessions and caches have been deliberately invalidated. Removing a key earlier makes unmigrated records unreadable by design.

Rotate confidential-client credentials in the secret store, restart frontend instances to rebuild MSAL token caches, and invalidate active sessions. During Redis maintenance, drain frontend traffic or preserve quorum; do not switch a live deployment between Redis and POSIX because the adapters do not migrate state automatically. A Redis outage in an OIDC deployment denies session access until the configured store recovers.

For a compromised issuer or role mapping:

1. Remove the issuer or mapping from the enterprise configuration.
2. Revoke affected identity sessions at the issuer.
3. Rotate the confidential-client credential.
4. Remove APIM access for the affected issuer or audience.
5. Review correlation IDs in APIM diagnostics and Local Studio audit events.
6. Restore access only after signed configuration review and denial-path testing.

Authentication events are appended to `enterprise-audit.jsonl` with restrictive permissions. Controller authorization and invocation events are emitted as structured JSON for collection by the deployment log pipeline. Neither surface includes access, refresh, or identity tokens.

The frontend removes browser cookies, authorization headers, and browser-supplied enterprise identity headers before agent-runtime forwarding. It adds the active session token only in the dedicated internal header. The agent runtime independently validates signature, issuer, audience, expiry, mapped roles, and the model or agent entitlement before dispatch. Its existing service credential remains a separate authorization layer.

Rollback explicitly promotes an operator-selected approved APIM revision whose time-bounded manifest matches the policy and parameter SHA-256 digests. It never infers a revision from deployment history. A rollback must not re-enable browser-held API keys or forward user credentials to Foundry.

The checked-in policy contract tests and XML validation do not compile or deploy the policy in Azure. Import validation, managed-identity RBAC, content-safety backend wiring, diagnostics delivery, streaming, revocation, and denied-operation behavior remain live acceptance gates.

## Acceptance boundary

`npm run check` and `npm run test:integration` establish local conformance only. Live acceptance separately proves both issuer flows, APIM validation and revocation, managed-identity access, model and project-agent invocation, streaming, correlation telemetry, and RBAC denial in the target Azure tenant.
