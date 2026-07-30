#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: enable-system-identity.sh <resource-group> <apim-service-name>" >&2
  exit 64
fi

resource_group=$1
apim_service=$2
principal_id=$(az apim show --resource-group "${resource_group}" --name "${apim_service}" --query identity.principalId --output tsv)

if [[ -n "${principal_id}" ]]; then
  printf '%s\n' "${principal_id}"
  exit 0
fi

identity_type=$(az apim show --resource-group "${resource_group}" --name "${apim_service}" --query identity.type --output tsv)
desired_identity_type=SystemAssigned
[[ "${identity_type}" == "UserAssigned" ]] && desired_identity_type="SystemAssigned, UserAssigned"
az apim update --resource-group "${resource_group}" --name "${apim_service}" --set "identity.type=${desired_identity_type}" --output none

for _ in {1..10}; do
  principal_id=$(az apim show --resource-group "${resource_group}" --name "${apim_service}" --query identity.principalId --output tsv)
  if [[ -n "${principal_id}" ]]; then
    printf '%s\n' "${principal_id}"
    exit 0
  fi
  sleep 3
done

echo "APIM system-assigned identity was not provisioned" >&2
exit 1
