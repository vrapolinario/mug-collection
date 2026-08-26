# V&M Coffee Mug Collection

An independent public archive for a personal coffee mug collection. Visitors can browse and map mugs without signing in. Administrators authenticate with a Microsoft account to manage mugs, images, and the administrator allow-list.

This project is unofficial and is not affiliated with or endorsed by any coffee company or trademark owner.

For first-time production setup and release instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

## Architecture

- React, Vite, and TypeScript frontend on Azure Static Web Apps Standard
- Node.js 22 Azure Functions API on Flex Consumption FC1
- Private Azure Blob Storage for mug images and Function deployment packages
- Azure Table Storage for mugs and the administrator allow-list
- Azure Maps Gen2, accessed through the API with managed identity
- Application Insights backed by Log Analytics
- GitHub Actions deployment authenticated to Azure with OIDC

Storage shared keys, public blob access, and Azure Maps local authentication are disabled. The Function App uses a user-assigned managed identity for Blob, Table, Queue, and Maps data access. The linked Function App is the Static Web App API backend.

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
3. Add a federated credential whose subject is `repo:OWNER/REPOSITORY:environment:production`.
4. Grant the service principal `Contributor` and `Role Based Access Control Administrator` on the target resource group. The second role is required because the Bicep template creates managed-identity role assignments.
5. Create a protected GitHub environment named `production` and add required reviewers. This approval gate must be configured before enabling production deployment.
6. Add these non-secret variables to that environment:

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Entra application client ID |
| `AZURE_TENANT_ID` | Entra tenant ID |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID |
| `AZURE_RESOURCE_GROUP` | Existing target resource group name |

No Azure client secret or persistent SWA deployment token is used. After OIDC login, the deployment workflow reads the SWA upload token from Azure, masks it, uses it for that job, and does not save it in GitHub.

## Deploy

`.github/workflows/deploy.yml` runs only when manually dispatched from the `main` branch. Its `production` environment then pauses for the separately configured reviewer approval. It:

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
$now = (Get-Date).ToUniversalTime().ToString('o')

az storage entity insert `
  --account-name $storageAccount `
  --table-name Admins `
  --auth-mode login `
  --entity PartitionKey=admin RowKey=$email email=$email addedAt=$now addedBy=bootstrap
```

Sign in from the site with **Admin sign in**. Once authorized, that account can manage additional administrators in the application. The last administrator cannot be removed.

## Repository data policy

Do not commit mug records, uploaded images, Azure outputs, local settings, generated ARM JSON, deployment packages, credentials, tokens, or environment state. Runtime data belongs only in Azure Storage; local runtime data and deployment artifacts are covered by `.gitignore`.
