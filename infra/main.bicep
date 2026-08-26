targetScope = 'resourceGroup'

@description('Deployment environment name used in resource names and tags.')
@minLength(2)
@maxLength(10)
param environmentName string = 'prod'

@description('Azure region for the application resources.')
param location string

@description('Short workload name used in resource names.')
@minLength(3)
@maxLength(16)
param workloadName string = 'mugcollection'

var resourceToken = toLower(uniqueString(subscription().id, resourceGroup().id))
var namePrefix = '${workloadName}-${environmentName}'
var storageAccountName = take(toLower(replace('${workloadName}${environmentName}${resourceToken}', '-', '')), 24)
var tags = {
  environment: environmentName
  workload: workloadName
  'managed-by': 'bicep'
}

module runtimeIdentity 'br:mcr.microsoft.com/bicep/avm/res/managed-identity/user-assigned-identity:0.6.0' = {
  params: {
    name: '${namePrefix}-runtime'
    location: location
    tags: tags
  }
}

module logAnalytics 'br:mcr.microsoft.com/bicep/avm/res/operational-insights/workspace:0.16.1' = {
  params: {
    name: '${namePrefix}-logs'
    location: location
    dailyQuotaGb: '0.5'
    dataRetention: 30
    features: {
      disableLocalAuth: true
      immediatePurgeDataOn30Days: true
    }
    tags: tags
  }
}

module applicationInsights 'br:mcr.microsoft.com/bicep/avm/res/insights/component:0.8.0' = {
  params: {
    name: '${namePrefix}-insights'
    location: location
    workspaceResourceId: logAnalytics.outputs.resourceId
    disableLocalAuth: true
    retentionInDays: 30
    samplingPercentage: 25
    tags: tags
  }
}

module storage 'br:mcr.microsoft.com/bicep/avm/res/storage/storage-account:0.33.0' = {
  params: {
    name: storageAccountName
    location: location
    kind: 'StorageV2'
    skuName: 'Standard_LRS'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    blobServices: {
      containers: [
        {
          name: 'function-releases'
          publicAccess: 'None'
        }
        {
          name: 'mug-images'
          publicAccess: 'None'
        }
      ]
    }
    tableServices: {
      tables: [
        {
          name: 'Mugs'
        }
        {
          name: 'Admins'
        }
      ]
    }
    roleAssignments: [
      {
        principalId: runtimeIdentity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: 'Storage Blob Data Owner'
      }
      {
        principalId: runtimeIdentity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: 'Storage Table Data Contributor'
      }
      {
        principalId: runtimeIdentity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: 'Storage Queue Data Contributor'
      }
    ]
    tags: tags
  }
}

module maps 'br:mcr.microsoft.com/bicep/avm/res/maps/account:0.2.1' = {
  params: {
    name: '${namePrefix}-maps'
    location: location
    kind: 'Gen2'
    sku: 'G2'
    disableLocalAuth: true
    roleAssignments: [
      {
        principalId: runtimeIdentity.outputs.principalId
        principalType: 'ServicePrincipal'
        roleDefinitionIdOrName: 'Azure Maps Search and Render Data Reader'
      }
    ]
    tags: tags
  }
}

module functionPlan 'br:mcr.microsoft.com/bicep/avm/res/web/serverfarm:0.7.0' = {
  params: {
    name: take('${namePrefix}-plan', 40)
    location: location
    kind: 'linux'
    reserved: true
    skuName: 'FC1'
    skuCapacity: 1
    zoneRedundant: false
    tags: tags
  }
}

module functionApp 'br:mcr.microsoft.com/bicep/avm/res/web/site:0.24.0' = {
  params: {
    name: take('${namePrefix}-${resourceToken}-api', 60)
    location: location
    kind: 'functionapp,linux'
    serverFarmResourceId: functionPlan.outputs.resourceId
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    managedIdentities: {
      userAssignedResourceIds: [
        runtimeIdentity.outputs.resourceId
      ]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: 'https://${storage.outputs.name}.blob.${environment().suffixes.storage}/function-releases'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: runtimeIdentity.outputs.resourceId
          }
        }
      }
      runtime: {
        name: 'node'
        version: '22'
      }
      scaleAndConcurrency: {
        instanceMemoryMB: 2048
        maximumInstanceCount: 20
      }
    }
    configs: [
      {
        name: 'appsettings'
        storageAccountResourceId: storage.outputs.resourceId
        storageAccountUseIdentityAuthentication: true
        applicationInsightResourceId: applicationInsights.outputs.resourceId
        properties: {
          AZURE_CLIENT_ID: runtimeIdentity.outputs.clientId
          AzureWebJobsStorage__clientId: runtimeIdentity.outputs.clientId
          STORAGE_ACCOUNT_NAME: storage.outputs.name
          MUG_IMAGES_CONTAINER: 'mug-images'
          MUGS_TABLE_NAME: 'Mugs'
          ADMINS_TABLE_NAME: 'Admins'
          AZURE_MAPS_CLIENT_ID: reference(resourceId('Microsoft.Maps/accounts', '${namePrefix}-maps'), '2024-07-01-preview').uniqueId
        }
      }
    ]
    tags: tags
  }
}

module staticWebApp 'br:mcr.microsoft.com/bicep/avm/res/web/static-site:0.9.5' = {
  params: {
    name: take('${namePrefix}-${resourceToken}-web', 40)
    location: location
    sku: 'Standard'
    provider: 'None'
    publicNetworkAccess: 'Enabled'
    stagingEnvironmentPolicy: 'Disabled'
    linkedBackend: {
      resourceId: functionApp.outputs.resourceId
      location: location
    }
    tags: tags
  }
}

output application object = {
  functionAppName: functionApp.outputs.name
  staticWebAppHostname: staticWebApp.outputs.defaultHostname
  staticWebAppName: staticWebApp.outputs.name
}
