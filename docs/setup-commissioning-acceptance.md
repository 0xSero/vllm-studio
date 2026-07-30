# Setup commissioning acceptance

This document defines the evidence required to accept the workstation commissioning flow. It does not treat configuration, a rendered control, or a green unit test as proof of a live external connection.

## Track-to-proof matrix

| Track                  | Local acceptance                                                                                                                                                                                                                                                                                                                                                                         | Live acceptance                                                                                                                                                                                               | Failure expectation                                                                                                                                                                                                                                                     | Standing                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Enterprise access      | Session API decodes `local`, `optional_oidc`, and `required_oidc`; forged, expired, wrong-issuer, wrong-audience, and unmapped-role tokens fail closed; the browser receives only an opaque session cookie.                                                                                                                                                                              | Complete Entra and Keycloak authorization-code flows with PKCE, validate roles and C2 clearance, sign out, revoke the session at the issuer, and observe denial on the next request.                          | Discovery, JWKS, callback, nonce, issuer, audience, expiry, role, clearance, and logout failures remain explicit and do not create an authenticated session.                                                                                                            | `observed` only after token validation; issuer metadata alone is `observed` metadata, not an authenticated identity.                                                     |
| Credentials and agents | Onboarding schemas reject unknown services, invalid credential references, oversized credentials, invalid URLs, and invalid SSH targets; keyring reads return reference presence only; apply requires current probes and emits an unsigned digest-bound receipt.                                                                                                                         | Probe Vault, GitLab, Jira, the inference runtime, FastCRW, and an enabled SSH agent from the deployed runtime; apply, revoke, and recovery paths complete against the selected local agents.                  | Missing keyring, rejected credentials, stale probes, profile-digest drift, partial apply, and partial revoke remain visible and block replacement enrollment.                                                                                                           | Saved configuration is `claimed`; a successful current probe and an unsigned enrollment receipt are `observed`; only a cryptographically verified receipt is `attested`. |
| Execution environment  | Kubernetes configuration accepts HTTPS endpoints and loopback HTTP only, resolves bounded controller or projected-service-account credential references, persists no credential bytes or absolute paths, replaces the active gateway only after persistence, and validates Kubernetes and Ray discovery documents. Access-fabric tests cover plan, probe, apply, offboard, and recovery. | From the target deployment, probe the private Kubernetes API and `ray.io/v1`, submit a governed C2 RayJob, reconcile it to a terminal state, and verify NetBird or Boundary when private routing is required. | Missing files, unreadable credentials, escaping or symbolic-link references, permissive token modes, insecure URLs, request timeout, non-2xx responses, malformed documents, failed persistence, and failed access-fabric recovery do not produce an observed standing. | Saved metadata is `claimed`; both live discovery calls are required for `observed`; failures are `contradicted`.                                                         |
| Inference              | All six persisted stages remain reachable: storage, runtime, model, acquisition, serving, and verification. Provider routing preserves qualified model identity and rejects unknown models without silent local fallback.                                                                                                                                                                | Invoke the configured remote or local model through the complete client path, including streaming where supported, and capture the selected provider/model identity, response status, and usage evidence.     | Storage, runtime install, acquisition, launch, readiness, routing, model rejection, cancellation, and benchmark errors remain on the stage that owns remediation.                                                                                                       | Selection or launch configuration is `claimed`; a successful end-to-end request is `observed`.                                                                           |
| Review                 | The review derives each row from the same session, onboarding, environment, access-fabric, and inference state used by its track. No row becomes ready because a component rendered or an endpoint was merely configured.                                                                                                                                                                | Repeat the track probes in the deployment and compare timestamps, immutable identities, digests, and correlation identifiers with the review surface.                                                         | Missing, stale, contradicted, or unavailable evidence prevents a ready verdict and links back to the owning track.                                                                                                                                                      | Review preserves the source standing; it never promotes `claimed` to `observed` or `attested`.                                                                           |

## Local verification

Run the repository gates from the repository root:

```sh
npm run check
npm run test:integration
```

Run the focused environment boundary tests while developing that slice:

```sh
bun test controller/tests/environment-routes.test.ts
bun test controller/tests/kuberay-gateway.test.ts
bun test frontend/src/features/setup/setup-view/setup-shell-design.test.ts
```

Start the full application through the repository workflow in a dedicated terminal:

```sh
npm run dev
```

From a second terminal, verify the three expected listeners and the controller-facing setup contract:

```sh
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:8080 -sTCP:LISTEN
lsof -nP -iTCP:8081 -sTCP:LISTEN
curl --fail --silent http://127.0.0.1:8080/health
curl --fail --silent http://127.0.0.1:8080/environment/kubernetes
curl --fail --silent http://127.0.0.1:3000/api/auth/session
```

Browser acceptance must exercise all five tracks at desktop and narrow viewport widths. It must record JavaScript exceptions, hydration errors, console errors, failed same-origin API requests, keyboard reachability, focus visibility, and horizontal overflow. Repeat the setup surface in cortAIx light, cortAIx dark, high-contrast, and forced-colors modes. Static token presence is supporting evidence, not rendered acceptance.

## Live acceptance boundary

Local tests may use hermetic OIDC, Kubernetes, Ray, inference, and access-fabric fixtures. They prove contract behavior only. They do not prove:

- Entra or Keycloak tenant configuration, Conditional Access, issuer revocation, or group and app-role assignment.
- APIM token validation, managed-identity substitution, Foundry model or agent invocation, quotas, diagnostics, or correlation.
- Kubernetes RBAC, admission policy, NetworkPolicy, GPU scheduling, RayJob execution, or namespace cleanup in the target cluster.
- Vault, GitLab, Jira, FastCRW, NetBird, Boundary, remote SSH, DNS, certificate, or private-routing reachability from the deployed runtime.
- Hardware qualification, model performance, or sustained streaming under the target workload.

Record live acceptance separately with target identity, deployment revision, timestamps, immutable model and agent identifiers, policy decisions, correlation identifiers, and redacted command output. A local green gate must not be reported as live acceptance.

## Failure and recovery checks

Acceptance includes negative behavior:

1. Stop each dependency independently and confirm that only its owning track degrades.
2. Present expired or incorrect credentials and confirm that no credential value appears in the response, UI, log, receipt, or error.
3. Use wrong issuer, audience, tenant, role, clearance, model, agent, Kubernetes document, and Ray API versions and confirm fail-closed behavior.
4. Interrupt configuration persistence and enrollment apply operations and confirm either rollback or an explicit recovery state.
5. Restart the frontend, controller, and agent runtime and confirm persisted non-secret configuration is reconstructed without reusing browser-held credentials.
6. Revoke an OIDC session, onboarding receipt, access-fabric enrollment, and Kubernetes connection and confirm downstream invocation is denied.

## Secret-handling constraints

- Do not enter, print, commit, screenshot, attach, or persist raw access tokens, refresh tokens, client secrets, API keys, service-account tokens, kubeconfigs, SSH private keys, or keyring values.
- OIDC secrets come from the deployment secret store. Browser storage contains no identity or Foundry token.
- Service credentials are written through the native keyring interface. UI and API responses expose only approved reference names and presence.
- Kubernetes configuration stores endpoint metadata and bounded references such as `controller:cluster.token` or `kubernetes:token`. Responses and persisted settings contain neither credential bytes nor absolute credential paths. The controller resolves and reads credential files at request time.
- APIM removes inbound credentials before backend forwarding and uses managed identity toward Foundry.
- Evidence and diagnostic artifacts must be reviewed for credential fragments before retention or sharing.

## Completion rule

Commissioning is accepted only when every required track has current evidence at its declared standing, every negative path fails as specified, the full repository gates pass, rendered browser acceptance passes in all required modes, and separately required live checks are attached. Unsupported or unavailable external checks remain open; they are not converted into local acceptance.
