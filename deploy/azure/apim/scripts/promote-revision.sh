#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 4 || $# -gt 5 ]]; then
  echo "usage: promote-revision.sh <resource-group> <apim-service-name> <api-id> <revision> [notes]" >&2
  exit 64
fi

resource_group=$1
apim_service=$2
api_id=$3
revision=$4
notes=${5:-"Promote Local Studio governed AI gateway revision ${revision}"}
release_id="local-studio-${revision}-$(date -u +%Y%m%dT%H%M%SZ)"
[[ "${api_id}" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "api-id contains unsafe characters" >&2; exit 64; }
[[ "${revision}" =~ ^[A-Za-z0-9._-]{1,100}$ ]] || { echo "revision contains unsafe characters" >&2; exit 64; }
revisions=$(az apim api revision list --resource-group "${resource_group}" --service-name "${apim_service}" --api-id "${api_id}" --output json)
available=$(jq --arg revision "${revision}" '[.[] | select(.apiRevision == $revision)] | length' <<<"${revisions}")
current=$(jq --arg revision "${revision}" '[.[] | select(.apiRevision == $revision and .isCurrent == true)] | length' <<<"${revisions}")

if [[ "${available}" != "1" ]]; then
  echo "APIM revision ${revision} does not exist exactly once" >&2
  exit 1
fi
if [[ "${current}" == "1" ]]; then
  echo "APIM revision ${revision} is already current"
  exit 0
fi

az apim api release create \
  --resource-group "${resource_group}" \
  --service-name "${apim_service}" \
  --api-id "${api_id}" \
  --api-revision "${revision}" \
  --release-id "${release_id}" \
  --notes "${notes}"
