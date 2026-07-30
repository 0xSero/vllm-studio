#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: validate-azure.sh <resource-group> <apim-service-name> <parameters-file>" >&2
  exit 64
fi

resource_group=$1
apim_service=$2
parameters_file=$3
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
template_file="${script_dir}/../infra/main.bicep"
"${script_dir}/preflight-azure.sh" "${resource_group}" "${apim_service}" "${parameters_file}"

az deployment group validate \
  --resource-group "${resource_group}" \
  --template-file "${template_file}" \
  --parameters "@${parameters_file}" \
  --parameters apimServiceName="${apim_service}" \
  --validation-level Provider

az deployment group what-if \
  --resource-group "${resource_group}" \
  --template-file "${template_file}" \
  --parameters "@${parameters_file}" \
  --parameters apimServiceName="${apim_service}"
