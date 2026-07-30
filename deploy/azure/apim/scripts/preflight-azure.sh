#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: preflight-azure.sh <resource-group> <apim-service-name> <parameters-file>" >&2
  exit 64
fi

resource_group=$1
apim_service=$2
parameters_file=$3
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
node "${script_dir}/validate.mjs" "${parameters_file}" "${apim_service}"

current_subscription=$(az account show --query id --output tsv)
apim=$(az apim show --resource-group "${resource_group}" --name "${apim_service}" --output json)
principal_id=$(jq -r '.identity.principalId // empty' <<<"${apim}")
[[ -n "${principal_id}" ]] || { echo "APIM system-assigned identity is required" >&2; exit 1; }
apim_sku=$(jq -r '.sku.name' <<<"${apim}")
[[ "${apim_sku}" =~ ^(Developer|Basic|BasicV2|Standard|StandardV2|Premium|PremiumV2)$ ]] || { echo "APIM SKU ${apim_sku} does not support the required Content Safety policy" >&2; exit 1; }

api_id=$(jq -r '.parameters.apiId.value // "local-studio-ai"' "${parameters_file}")
bootstrap_revision=$(jq -r '.parameters.bootstrapRevision.value' "${parameters_file}")
if az apim api show --resource-group "${resource_group}" --service-name "${apim_service}" --api-id "${api_id}" --output none 2>/dev/null; then
  api_exists=true
else
  api_exists=false
fi
if [[ "${api_exists}" == "true" && "${bootstrap_revision}" == "true" ]]; then
  echo "bootstrapRevision cannot replace an existing current API" >&2
  exit 1
fi
if [[ "${api_exists}" == "false" && "${bootstrap_revision}" != "true" ]]; then
  echo "The first API revision must explicitly set bootstrapRevision=true" >&2
  exit 1
fi

logger_id=$(jq -r '.parameters.appInsightsLoggerResourceId.value' "${parameters_file}")
expected_logger_prefix="/subscriptions/${current_subscription}/resourceGroups/${resource_group}/providers/Microsoft.ApiManagement/service/${apim_service}/loggers/"
normalized_logger_id=$(printf '%s' "${logger_id}" | tr '[:upper:]' '[:lower:]')
normalized_logger_prefix=$(printf '%s' "${expected_logger_prefix}" | tr '[:upper:]' '[:lower:]')
[[ "${normalized_logger_id}" == "${normalized_logger_prefix}"* ]] || { echo "Application Insights logger must belong to the target APIM service" >&2; exit 1; }
logger_type=$(az resource show --ids "${logger_id}" --query properties.loggerType --output tsv)
[[ "${logger_type}" == "applicationInsights" ]] || { echo "APIM logger must use Application Insights" >&2; exit 1; }

foundry_subscription=$(jq -r --arg fallback "${current_subscription}" '.parameters.foundrySubscriptionId.value // $fallback' "${parameters_file}")
foundry_group=$(jq -r '.parameters.foundryResourceGroupName.value' "${parameters_file}")
foundry_name=$(jq -r '.parameters.foundryAccountName.value' "${parameters_file}")
foundry_id="/subscriptions/${foundry_subscription}/resourceGroups/${foundry_group}/providers/Microsoft.CognitiveServices/accounts/${foundry_name}"
foundry_kind=$(az resource show --ids "${foundry_id}" --query kind --output tsv)
[[ "${foundry_kind}" == "AIServices" ]] || { echo "Foundry account must have kind AIServices" >&2; exit 1; }

content_subscription=$(jq -r --arg fallback "${current_subscription}" '.parameters.contentSafetySubscriptionId.value // $fallback' "${parameters_file}")
content_group=$(jq -r '.parameters.contentSafetyResourceGroupName.value' "${parameters_file}")
content_name=$(jq -r '.parameters.contentSafetyAccountName.value' "${parameters_file}")
content_id="/subscriptions/${content_subscription}/resourceGroups/${content_group}/providers/Microsoft.CognitiveServices/accounts/${content_name}"
content_kind=$(az resource show --ids "${content_id}" --query kind --output tsv)
[[ "${content_kind}" == "ContentSafety" ]] || { echo "Content Safety account must have kind ContentSafety" >&2; exit 1; }

secret_count=$(jq '.parameters.keyVaultNamedValues.value | length' "${parameters_file}")
if (( secret_count > 0 )); then
  vault_subscription=$(jq -r --arg fallback "${current_subscription}" '.parameters.keyVaultSubscriptionId.value // $fallback' "${parameters_file}")
  vault_group=$(jq -r '.parameters.keyVaultResourceGroupName.value' "${parameters_file}")
  vault_name=$(jq -r '.parameters.keyVaultName.value' "${parameters_file}")
  vault_rbac=$(az keyvault show --subscription "${vault_subscription}" --resource-group "${vault_group}" --name "${vault_name}" --query properties.enableRbacAuthorization --output tsv)
  [[ "${vault_rbac}" == "true" ]] || { echo "Key Vault must use Azure RBAC authorization" >&2; exit 1; }
fi
