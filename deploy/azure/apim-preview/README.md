# Preview AI Gateway evaluation

This directory is intentionally isolated from the standard API Management release package.

The preview gateway-wide runtime-key model does not satisfy the required per-user Entra or Keycloak authorization boundary. No preview deployment artifact is promoted from this directory. Evaluation results must separately prove subject, tenant, role, C2 clearance, revocation, model and agent allowlists, and credential removal before this profile can be reconsidered.

The standard package validator rejects Bicep, deployment parameter, shell, and JavaScript deployment artifacts in this directory.
