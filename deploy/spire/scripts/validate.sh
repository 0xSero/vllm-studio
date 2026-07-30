#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CHART_VERSION="0.29.0"
CRDS_VERSION="0.5.0"
REPOSITORY="https://spiffe.github.io/helm-charts-hardened/"

RENDERED="$(mktemp)"
trap 'rm -f "$RENDERED"' EXIT

node "$SCRIPT_DIR/validate.mjs"
helm template spire-crds spire-crds \
  --repo "$REPOSITORY" \
  --version "$CRDS_VERSION" \
  --namespace spire-mgmt >/dev/null
helm template spire spire \
  --repo "$REPOSITORY" \
  --version "$CHART_VERSION" \
  --namespace spire-mgmt \
  --values "$ROOT_DIR/values.yaml" >"$RENDERED"
test "$(grep -c '^kind: ClusterSPIFFEID$' "$RENDERED")" -eq 3
grep -q 'name: spire-mgmt-spire-local-studio-frontend' "$RENDERED"
grep -q 'name: spire-mgmt-spire-local-studio-controller' "$RENDERED"
grep -q 'name: spire-mgmt-spire-local-studio-agent-runtime' "$RENDERED"
grep -q 'k8s:sa:local-studio-frontend' "$RENDERED"
grep -q 'k8s:sa:local-studio-controller' "$RENDERED"
grep -q 'k8s:sa:local-studio-agent-runtime' "$RENDERED"
if grep -Eq 'name: spire-mgmt-spire-(default|oidc|spike|test)' "$RENDERED"; then
  exit 1
fi
KUSTOMIZED="$(kubectl kustomize "$ROOT_DIR")"
test "$(grep -c '^kind: Deployment$' "$ROOT_DIR/workloads.yaml")" -eq 3
test "$(grep -c '^kind: Service$' "$ROOT_DIR/workloads.yaml")" -eq 3
test "$(grep -c 'driver: csi.spiffe.io' "$ROOT_DIR/workloads.yaml")" -eq 3
test "$(grep -c 'mountPath: /run/spiffe/workload' "$ROOT_DIR/workloads.yaml")" -eq 3
test "$(grep -c 'readOnlyRootFilesystem: true' "$ROOT_DIR/workloads.yaml")" -eq 3
test "$(grep -c 'serviceAccountName: local-studio-' "$ROOT_DIR/workloads.yaml")" -eq 3
test "$(grep -c 'fsGroup: 10001' "$ROOT_DIR/workloads.yaml")" -eq 3
test "$(grep -c 'mountPath: /tmp' "$ROOT_DIR/workloads.yaml")" -eq 3
test "$(grep -c 'tcpSocket:' "$ROOT_DIR/workloads.yaml")" -eq 6
grep -q 'https://local-studio-controller:8080' "$ROOT_DIR/workloads.yaml"
grep -q 'https://local-studio-agent-runtime:8081' "$ROOT_DIR/workloads.yaml"
test "$(grep -c 'name: BACKEND_URL' "$ROOT_DIR/workloads.yaml")" -eq 2
grep -q 'kubernetes.io/metadata.name: kuberay-system' "$ROOT_DIR/tensorprime-network-policy.yaml"
grep -q 'kubernetes.io/metadata.name: cortaix-llm-inference' "$ROOT_DIR/tensorprime-network-policy.yaml"
test "$(printf '%s\n' "$KUSTOMIZED" | grep -c 'name: LOCAL_STUDIO_TENSORPRIME_PROFILE')" -eq 2
test "$(printf '%s\n' "$KUSTOMIZED" | grep -c 'name: tensorprime-profile')" -eq 4
printf '%s\n' "$KUSTOMIZED" | grep -q 'name: tensorprime-connection-profile'
printf '%s\n' "SPIRE Helm and workload manifests validated"
