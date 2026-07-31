# SPIRE workload identity

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/group/github/ci/sybil-solutions/local-studio+github/license/sybil-solutions/local-studio.svg?variant=secondary&mode=dark">
  <img alt="CI, license" src="https://shieldcn.dev/group/github/ci/sybil-solutions/local-studio+github/license/sybil-solutions/local-studio.svg?variant=secondary&mode=light">
</picture>

This package pins the hardened SPIRE charts and assigns separate identities to the frontend, controller, and agent runtime. The default catch-all identity is disabled. Workload registration is restricted by namespace and component labels.

Chart pins:

- `spire` chart `0.29.0`, SPIRE application `1.14.5`
- `spire-crds` chart `0.5.0`
- repository `https://spiffe.github.io/helm-charts-hardened/`

Validate before deployment:

```sh
deploy/spire/scripts/validate.sh
```

Apply the CRDs, SPIRE release, and Local Studio namespace resources only after review:

```sh
helm upgrade --install --create-namespace --namespace spire-mgmt spire-crds spire-crds --repo https://spiffe.github.io/helm-charts-hardened/ --version 0.5.0
helm upgrade --install --namespace spire-mgmt spire spire --repo https://spiffe.github.io/helm-charts-hardened/ --version 0.29.0 --values deploy/spire/values.yaml
kubectl apply --kustomize deploy/spire
```

Mount the CSI volume at `/run/spiffe/workload` in each admitted workload, set `LOCAL_STUDIO_SPIFFE_CONFIG` to a deployment-owned copy of `workload-identity.example.json`, and retain the exact ServiceAccount and component labels from this package. For a separate agent-runtime pod, set `LOCAL_STUDIO_AGENT_RUNTIME_HOST=0.0.0.0`; non-loopback binding fails unless SPIFFE mode is `required`.

The baseline NetworkPolicy permits admitted Local Studio workloads and cluster DNS only. Add reviewed destination-specific egress policies for APIM, Foundry, Kubernetes, Vault, GitLab, Jira, and other commissioned services before starting those integrations.

JWT-SVID validation and rotating X.509-SVID mTLS authenticate each service hop independently. The receiver admits exact peer identities and rejects a JWT subject that differs from the TLS peer. Live multi-replica SPIRE, CSI, NetworkPolicy, and revocation behavior remains a deployment acceptance gate.

Rotation is handled by SPIRE. Revocation requires removing or disabling the matching ClusterSPIFFEID, terminating affected pods, and confirming new Workload API calls are denied. Rollback sets the Local Studio identity mode to `optional` only for bounded recovery; shared deployment authorization remains governed by OIDC.

Federation is disabled. Delegated Identity API and Broker API authority are not configured.

The TensorPrime Phase-0 connection profile and service-specific deployment boundary are documented in [TensorPrime Phase-0](./TENSORPRIME.md). Its service catalog deliberately declares plaintext transport, no server-side mTLS enforcement, and no Ray TLS. Local Studio's own internal service mTLS does not change those TensorPrime service facts.
