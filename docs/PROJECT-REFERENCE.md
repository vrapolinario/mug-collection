# Project Reference

Operational reference for local development, validation, Azure setup, deployment, administration, and repository data handling.

Return to the [project overview](../README.md). For detailed first-time production setup and release instructions, see the [deployment guide](../DEPLOYMENT.md).

## Local development

Install Node.js 22, Azure Functions Core Tools v4, and Azurite. Then install dependencies:

```powershell
npm ci
Push-Location api
npm ci
Pop-Location
```

Create `api/local.settings.json`; it is ignored by Git:

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "AZURE_STORAGE_CONNECTION_STRING": "UseDevelopmentStorage=true",
    "MUG_IMAGES_CONTAINER": "mug-images",
    "MUGS_TABLE_NAME": "Mugs",
    "ADMINS_TABLE_NAME": "Admins"
  }
}
```

The connection string is an Azurite-only fallback. Azure uses `STORAGE_ACCOUNT_NAME` and managed identity; do not configure `AZURE_STORAGE_CONNECTION_STRING` in Azure.

Start Azurite and initialize local storage:

```powershell
npx azurite --location .azurite
az storage container create --name mug-images --connection-string UseDevelopmentStorage=true
az storage table create --name Mugs --connection-string UseDevelopmentStorage=true
az storage table create --name Admins --connection-string UseDevelopmentStorage=true
```

In separate terminals, run the API and frontend:

```powershell
Set-Location api
npm start
```

```powershell
npm run dev
```

Vite proxies `/api` to Functions on port `7071`. Public features work locally; Microsoft sign-in should be integration-tested through Static Web Apps.

## Validate

```powershell
npm ci
npm run lint
npm run build
Push-Location api
npm ci
npm test
Pop-Location
az bicep build --file infra/main.bicep --outfile "$env:TEMP\mug-collection-main.json"
az bicep build-params --file infra/main.prod.bicepparam --outfile "$env:TEMP\mug-collection-main.parameters.json"
```

Pull requests run the same application and infrastructure checks in `.github/workflows/validate.yml`.

## Azure and GitHub setup

The production workflow accepts the Azure region at deployment time and suggests `westus2` by default. Before the first deployment:

1. Create the target resource group.
2. Create a Microsoft Entra application and service principal for GitHub Actions.
3. Add a federated credential whose subject exactly matches GitHub's OIDC token. Newly created repositories use `repo:OWNER@OWNER-ID/REPOSITORY@REPOSITORY-ID:environment:production`; repositories created before July 15, 2026 may still use the legacy name-only format. The [deployment guide](../DEPLOYMENT.md) derives the immutable IDs with GitHub CLI.
4. Grant the service principal `Contributor` and `Role Based Access Control Administrator` on the target resource group. The second role is required because the Bicep template creates managed-identity role assignments.
5. Create a GitHub environment named `production` and restrict it to `main`. For single-owner repositories, manual dispatch plus the workflow confirmation checkbox is the approval. Teams can optionally configure required reviewers when their GitHub plan supports that feature.
6. Add these non-secret variables to that environment:

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Entra application client ID |
| `AZURE_TENANT_ID` | Entra tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_RESOURCE_GROUP` | Existing target resource group name |

No Azure client secret or persistent SWA deployment token is used. After OIDC login, the deployment workflow reads the SWA upload token from Azure, masks it, uses it for that job, and does not save it in GitHub.

## Deploy

`.github/workflows/deploy.yml` runs only when manually dispatched from the `main` branch and its production confirmation checkbox is selected. If the `production` environment has required reviewers, it also pauses for their approval. It:

1. Builds and tests the frontend and API.
2. Deploys `infra/main.bicep` with `infra/main.prod.bicepparam`.
3. Deploys the API package to the Flex Function App.
4. Uploads the static frontend to Static Web Apps.

This repository setup does not itself deploy anything. Review the Azure what-if result before approving the first workflow run:

```powershell
az deployment group what-if `
  --resource-group <resource-group> `
  --template-file infra/main.bicep `
  --parameters infra/main.prod.bicepparam
```

## Bootstrap the first administrator

The API intentionally cannot self-promote the first account. After infrastructure deployment, insert the first administrator directly with Microsoft Entra authorization. The operator needs `Storage Table Data Contributor` on the deployed storage account.

```powershell
$storageAccount = az storage account list `
  --resource-group <resource-group> `
  --query "[?starts_with(name, 'mugcollectionprod')].name | [0]" `
  --output tsv

$email = '<microsoft-account-email>'.Trim().ToLowerInvariant()
if ($email -match '^<.*>$' -or $email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
  throw 'Set $email to the Microsoft account email used to sign in to the site.'
}

$now = (Get-Date).ToUniversalTime().ToString('o')

$insertArguments = @(
  'storage', 'entity', 'insert'
  '--account-name', $storageAccount
  '--table-name', 'Admins'
  '--auth-mode', 'login'
  '--entity', 'PartitionKey=admin', "RowKey=$email", "email=$email", "addedAt=$now", 'addedBy=bootstrap'
  '--if-exists', 'replace'
)
& az @insertArguments

$showArguments = @(
  'storage', 'entity', 'show'
  '--account-name', $storageAccount
  '--table-name', 'Admins'
  '--auth-mode', 'login'
  '--partition-key', 'admin'
  '--row-key', $email
  '--query', '{email:email,addedAt:addedAt,addedBy:addedBy}'
  '--output', 'table'
)
& az @showArguments
```

Sign in from the site with **Admin sign in**. Once authorized, that account can manage additional administrators in the application. The last administrator cannot be removed.

## Repository data policy

Do not commit mug records, uploaded images, Azure outputs, local settings, generated ARM JSON, deployment packages, credentials, tokens, or environment state. Runtime data belongs only in Azure Storage; local runtime data and deployment artifacts are covered by `.gitignore`.
