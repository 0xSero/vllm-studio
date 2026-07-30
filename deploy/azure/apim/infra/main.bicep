targetScope = 'resourceGroup'

@minLength(1)
param apimServiceName string

@minLength(1)
param apiId string = 'local-studio-ai'

@minLength(1)
param apiRevision string

@maxLength(256)
param apiRevisionDescription string

param bootstrapRevision bool = false

param namedValues object

@secure()
param keyVaultNamedValues object = {}

param foundrySubscriptionId string = subscription().subscriptionId

@minLength(1)
param foundryResourceGroupName string

@minLength(2)
param foundryAccountName string

param contentSafetySubscriptionId string = subscription().subscriptionId

@minLength(1)
param contentSafetyResourceGroupName string

@minLength(2)
param contentSafetyAccountName string

@minLength(1)
param contentSafetyEndpoint string

param keyVaultSubscriptionId string = subscription().subscriptionId

@minLength(1)
param keyVaultResourceGroupName string

@minLength(1)
param keyVaultName string

@minLength(1)
param appInsightsLoggerResourceId string

var apiName = '${apiId};rev=${apiRevision}'
var apiOpenApi = loadTextContent('../api.openapi.yaml')
var apiPolicy = loadTextContent('../policy.xml')
var diagnostics = loadJsonContent('../diagnostics.example.json')
var snapshotPrefix = '${apiId}-${apiRevision}-'
var contentSafetyBackendId = '${snapshotPrefix}content-safety'
var foundryBackendId = '${snapshotPrefix}foundry'
var policyNamedValues = union(namedValues, {
  'content-safety-backend-id': contentSafetyBackendId
  'foundry-backend-id': foundryBackendId
})
var policyNamedValueNames = concat(
  map(items(policyNamedValues), item => item.key),
  map(items(keyVaultNamedValues), item => item.key)
)
var apiPolicySnapshot = reduce(
  policyNamedValueNames,
  apiPolicy,
  (current, name) => replace(current, '{{${name}}}', '{{${snapshotPrefix}${name}}}')
)
var foundryRoleDefinitionId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'
var contentSafetyRoleDefinitionId = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var keyVaultReaderRoleDefinitionId = '4633458b-17de-408a-b874-0445c86b69e6'

resource apim 'Microsoft.ApiManagement/service@2024-05-01' existing = {
  name: apimServiceName
}

resource api 'Microsoft.ApiManagement/service/apis@2024-05-01' = {
  parent: apim
  name: apiName
  properties: {
    apiRevision: apiRevision
    apiRevisionDescription: apiRevisionDescription
    apiType: 'http'
    displayName: 'Local Studio governed AI gateway'
    format: 'openapi'
    isCurrent: bootstrapRevision
    path: 'ai/v1'
    protocols: [
      'https'
    ]
    subscriptionRequired: false
    type: 'http'
    value: apiOpenApi
  }
}

resource plainNamedValues 'Microsoft.ApiManagement/service/namedValues@2024-05-01' = [
  for item in items(policyNamedValues): {
    parent: apim
    name: '${snapshotPrefix}${item.key}'
    properties: {
      displayName: item.key
      secret: false
      tags: [
        'local-studio'
        'governed-ai'
      ]
      value: string(item.value)
    }
  }
]

resource secretNamedValues 'Microsoft.ApiManagement/service/namedValues@2024-05-01' = [
  for item in items(keyVaultNamedValues): {
    parent: apim
    name: '${snapshotPrefix}${item.key}'
    properties: {
      displayName: item.key
      keyVault: {
        secretIdentifier: string(item.value)
      }
      secret: true
      tags: [
        'local-studio'
        'key-vault'
      ]
    }
  }
]

resource contentSafetyBackend 'Microsoft.ApiManagement/service/backends@2024-05-01' = {
  parent: apim
  name: contentSafetyBackendId
  properties: {
    credentials: {
      authorization: {
        parameter: 'https://cognitiveservices.azure.com'
        scheme: 'ManagedIdentity'
      }
    }
    description: 'Azure AI Content Safety through APIM system-assigned managed identity'
    protocol: 'http'
    title: 'Foundry content safety'
    tls: {
      validateCertificateChain: true
      validateCertificateName: true
    }
    type: 'Single'
    url: contentSafetyEndpoint
  }
}

resource foundryBackend 'Microsoft.ApiManagement/service/backends@2024-05-01' = {
  parent: apim
  name: foundryBackendId
  properties: {
    description: 'Microsoft Foundry project endpoint'
    protocol: 'http'
    title: 'Foundry project'
    tls: {
      validateCertificateChain: true
      validateCertificateName: true
    }
    type: 'Single'
    url: string(namedValues['foundry-project-endpoint'])
  }
}

resource apiPolicyResource 'Microsoft.ApiManagement/service/apis/policies@2024-05-01' = {
  parent: api
  name: 'policy'
  properties: {
    format: 'rawxml'
    value: apiPolicySnapshot
  }
  dependsOn: [
    plainNamedValues
    secretNamedValues
    contentSafetyBackend
    foundryBackend
  ]
}

resource apiDiagnostic 'Microsoft.ApiManagement/service/apis/diagnostics@2024-05-01' = {
  parent: api
  name: 'applicationinsights'
  properties: union(diagnostics, {
    loggerId: appInsightsLoggerResourceId
  })
}

module foundryInvocationRole './modules/cognitive-role-assignment.bicep' = {
  scope: resourceGroup(foundrySubscriptionId, foundryResourceGroupName)
  name: 'foundry-invocation-${uniqueString(foundrySubscriptionId, foundryResourceGroupName, foundryAccountName, apimServiceName)}'
  params: {
    accountName: foundryAccountName
    principalId: apim.identity.principalId
    roleDefinitionId: foundryRoleDefinitionId
  }
}

module contentSafetyInvocationRole './modules/cognitive-role-assignment.bicep' = {
  scope: resourceGroup(contentSafetySubscriptionId, contentSafetyResourceGroupName)
  name: 'content-safety-${uniqueString(contentSafetySubscriptionId, contentSafetyResourceGroupName, contentSafetyAccountName, apimServiceName)}'
  params: {
    accountName: contentSafetyAccountName
    principalId: apim.identity.principalId
    roleDefinitionId: contentSafetyRoleDefinitionId
  }
}

module keyVaultSecretRole './modules/key-vault-role-assignment.bicep' = if (length(items(keyVaultNamedValues)) > 0) {
  scope: resourceGroup(keyVaultSubscriptionId, keyVaultResourceGroupName)
  name: 'key-vault-${uniqueString(keyVaultSubscriptionId, keyVaultResourceGroupName, keyVaultName, apimServiceName)}'
  params: {
    keyVaultName: keyVaultName
    principalId: apim.identity.principalId
    roleDefinitionId: keyVaultReaderRoleDefinitionId
  }
}

output apiId string = api.id
output apiRevision string = apiRevision
output apimPrincipalId string = apim.identity.principalId
output gatewayPath string = '/ai/v1'
output configurationSnapshotPrefix string = snapshotPrefix
