#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: rollback-revision.sh <resource-group> <apim-service-name> <rollback-manifest> <parameters-file>" >&2
  exit 64
fi

resource_group=$1
apim_service=$2
rollback_manifest=$3
parameters_file=$4
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
policy_file="${script_dir}/../policy.xml"

node "${script_dir}/validate.mjs" \
  "${parameters_file}" \
  "${apim_service}" \
  --configuration-only

node "${script_dir}/validate-rollback.mjs" \
  "${rollback_manifest}" \
  "${parameters_file}" \
  "${policy_file}"

api_id=$(jq -r '.api_id' "${rollback_manifest}")
revision=$(jq -r '.approved_revision' "${rollback_manifest}")
approval_reference=$(jq -r '.approval_reference' "${rollback_manifest}")

"${script_dir}/promote-revision.sh" \
  "${resource_group}" \
  "${apim_service}" \
  "${api_id}" \
  "${revision}" \
  "Rollback Local Studio governed AI gateway to revision ${revision}; approval ${approval_reference}"

current=$(az apim api revision list \
  --resource-group "${resource_group}" \
  --service-name "${apim_service}" \
  --api-id "${api_id}" \
  --query "[?apiRevision=='${revision}' && isCurrent].apiRevision | [0]" \
  --output tsv)
[[ "${current}" == "${revision}" ]] || { echo "Rollback revision did not become current" >&2; exit 1; }
