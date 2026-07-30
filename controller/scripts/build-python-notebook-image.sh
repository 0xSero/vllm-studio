#!/usr/bin/env bash
set -euo pipefail
context="$(cd "$(dirname "${BASH_SOURCE[0]}")/../assets/notebooks/python-smolvm" && pwd)"
output="${1:-$(cd "$context/../../../.." && pwd)/data/python-notebook-image.tar}"
image="local-studio-python-notebook:3.12.11"
docker build --pull=false --tag "$image" "$context"
mkdir -p "$(dirname "$output")"
docker save "$image" --output "$output"
digest="$(shasum -a 256 "$output" | awk '{print $1}')"
printf 'LOCAL_STUDIO_NOTEBOOK_PYTHON_IMAGE=%s@sha256:%s\n' "$output" "$digest"
