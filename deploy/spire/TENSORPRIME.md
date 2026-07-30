# TensorPrime Phase-0 workload identity

`tensorprime-connection-profile.json` is the typed Local Studio service catalog for the TensorPrime environment. It is decoded with Effect Schema before use. Set `LOCAL_STUDIO_TENSORPRIME_PROFILE` to its deployment-owned path alongside `LOCAL_STUDIO_SPIFFE_CONFIG`.

The connection profile binds:

- trust domain `tprime.vlans.ca`;
- identity template `spiffe://tprime.vlans.ca/ns/{namespace}/sa/{serviceaccount}`;
- CSI driver `csi.spiffe.io`;
- mount `/run/spiffe/workload`;
- socket `/run/spiffe/workload/spire-agent.sock`;
- one-hour X.509-SVIDs watched through the Workload API;
- Ray, vLLM, LiteLLM, embedding HTTP/gRPC, ASR, and unified external endpoints.

## Phase-0 security boundary

SPIRE can issue and rotate an X.509-SVID after a workload mounts the socket. That is workload-identity readiness, not service authentication proof.

TensorPrime Ray and inference services currently accept plaintext connections. They do not validate client SVIDs. Ray TLS is not configured. Evidence emitted from the typed profile therefore keeps `service_mtls_enforced=false` and `ray_tls_configured=false`, even when SVID acquisition and rotation are observed.

Do not use an HTTPS or mTLS endpoint until the corresponding TensorPrime service is configured to present and validate SVIDs and a separate live acceptance proves the path.

## Deployment

### Local development

To enable SPIFFE workload identity against a local SPIRE daemon, set both environment variables before starting the controller and agent runtime:

```sh
export LOCAL_STUDIO_SPIFFE_CONFIG=deploy/spire/workload-identity.example.json
export LOCAL_STUDIO_TENSORPRIME_PROFILE=deploy/spire/tensorprime-connection-profile.json
```

The example workload-identity config and the TensorPrime connection profile share the same trust domain (`tprime.vlans.ca`) and Workload API socket (`unix:///run/spiffe/workload/spire-agent.sock`), so they bind without modification. A local SPIRE agent must be listening on that socket.

Validate locally:

```sh
deploy/spire/scripts/validate.sh
```

After review, install the SPIRE package as described in `README.md`, then apply the Local Studio workloads, generated profile ConfigMap, runtime bindings, and destination-specific egress policy:

```sh
kubectl apply --kustomize deploy/spire
```

The Kustomize package creates the profile ConfigMap and sets:

```sh
LOCAL_STUDIO_TENSORPRIME_PROFILE=/etc/local-studio/tensorprime/tensorprime-connection-profile.json
```

No secret, token, SVID, private key, or trust bundle belongs in the profile.

## Readiness and rotation acceptance

For each Local Studio workload:

1. Confirm its ServiceAccount matches the profile identity.
2. Confirm `/run/spiffe/workload/spire-agent.sock` exists and is a Unix socket.
3. Fetch the X.509-SVID through the Workload API.
4. Confirm the URI SAN equals the configured SPIFFE ID.
5. Record expiry and rotation generation without persisting certificate or key material.
6. Keep TensorPrime service transport evidence at plaintext/not-configured.
7. Wait for a streamed SVID update and prove the generation increases before the prior certificate expires.

The local validator and hermetic tests prove configuration and evidence semantics only. Live SPIRE issuance, CSI mounting, rotation, NetworkPolicy behavior, service reachability, revocation, and future server-side mTLS remain deployment acceptance gates.

## Rollback

Remove `LOCAL_STUDIO_TENSORPRIME_PROFILE` to disable the TensorPrime catalog binding. Remove the TensorPrime egress NetworkPolicy if the integration is offboarded. Do not change workload identity from required to optional except during a bounded, reviewed recovery.
