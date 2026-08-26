# Production deployment guide

This guide deploys the application through GitHub Actions. Pushing code does not deploy anything. Production requires both a manual workflow dispatch and approval by a different reviewer.

## 1. Prerequisites

You need:

- An Azure subscription where you can create a resource group, app registration, service principal, and role assignments
- An Azure account allowed to create Microsoft Entra app registrations
- Azure CLI and Git
- A GitHub account and a second person or team to approve production
- Node.js 22 for local validation

Confirm the tools:

```powershell
az version
git --version
node --version
```

## 2. Choose deployment values

Set these values in PowerShell. Use the exact owner and repository names from the GitHub URL because the OIDC subject is an exact match.

```powershell
$GitHubOwner = '<github-owner>'
$GitHubRepo = 'mug-collection'
$SubscriptionId = '<azure-subscription-id>'
$ResourceGroup = 'rg-mug-collection-prod'
$Location = 'westus2'
$AppDisplayName = "github-$GitHubRepo-production"
$RepositoryRoot = 'C:\GitHub\mug-collection'
```

## 3. Create an empty GitHub repository

Create `$GitHubOwner/$GitHubRepo` on GitHub. Do not initialize it with a README, `.gitignore`, or license because those files already exist locally.

Do not push the code yet. The next steps establish the deployment identity and protected environment first.

## 4. Create the Azure resource group

Sign in, select the subscription, and create the resource group:

```powershell
az login
az account set --subscription $SubscriptionId
az account show --query '{subscription:id, tenant:tenantId, user:user.name}' --output table
az group create --name $ResourceGroup --location $Location
```

The Bicep deployment creates all application resources inside this resource group.

## 5. Create the GitHub OIDC identity

Create a Microsoft Entra application and service principal. This does not create a client secret:

```powershell
$app = az ad app create --display-name $AppDisplayName | ConvertFrom-Json
$ClientId = $app.appId
$AppObjectId = $app.id

$servicePrincipal = az ad sp create --id $ClientId | ConvertFrom-Json
$ServicePrincipalObjectId = $servicePrincipal.id
$TenantId = az account show --query tenantId --output tsv
```

Create the federated credential in the system temporary folder, then delete the temporary file:

```powershell
$credentialPath = Join-Path $env:TEMP 'mug-collection-github-oidc.json'
@{
  name = 'github-production'
  issuer = 'https://token.actions.githubusercontent.com'
  subject = "repo:${GitHubOwner}/${GitHubRepo}:environment:production"
  description = 'GitHub Actions production environment'
  audiences = @('api://AzureADTokenExchange')
} | ConvertTo-Json | Set-Content -Path $credentialPath -Encoding utf8

az ad app federated-credential create `
  --id $AppObjectId `
  --parameters "@$credentialPath"

Remove-Item $credentialPath
```

Grant deployment permissions only at the application resource-group scope:

```powershell
$ResourceGroupScope = az group show --name $ResourceGroup --query id --output tsv

az role assignment create `
  --assignee-object-id $ServicePrincipalObjectId `
  --assignee-principal-type ServicePrincipal `
  --role Contributor `
  --scope $ResourceGroupScope

az role assignment create `
  --assignee-object-id $ServicePrincipalObjectId `
  --assignee-principal-type ServicePrincipal `
  --role 'Role Based Access Control Administrator' `
  --scope $ResourceGroupScope
```

`Contributor` deploys resources. `Role Based Access Control Administrator` is required because Bicep grants the Function App managed identity its Storage and Maps data roles. Do not scope either role to the subscription.

Record these non-secret values:

```powershell
[pscustomobject]@{
  AZURE_CLIENT_ID = $ClientId
  AZURE_TENANT_ID = $TenantId
  AZURE_SUBSCRIPTION_ID = $SubscriptionId
  AZURE_RESOURCE_GROUP = $ResourceGroup
} | Format-List
```

## 6. Configure the protected GitHub environment

In the GitHub repository:

1. Open **Settings > Environments**.
2. Create an environment named exactly `production`.
3. Add the second person or team under **Required reviewers**.
4. Enable **Prevent self-review**.
5. Restrict deployment branches to `main`.
6. Add these environment variables under **Environment variables**, not secrets:

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | `$ClientId` from step 5 |
| `AZURE_TENANT_ID` | `$TenantId` from step 5 |
| `AZURE_SUBSCRIPTION_ID` | `$SubscriptionId` |
| `AZURE_RESOURCE_GROUP` | `$ResourceGroup` |

There is no Azure client secret. The workflow retrieves and masks the Static Web Apps upload token only for the active job.

## 7. Validate and preview locally

Run all checks before the first push:

```powershell
Set-Location $RepositoryRoot
npm ci
npm run lint
npm run build

Push-Location api
npm ci
npm test
Pop-Location

az bicep build `
  --file infra/main.bicep `
  --outfile "$env:TEMP\mug-collection-main.json"

az bicep build-params `
  --file infra/main.prod.bicepparam `
  --outfile "$env:TEMP\mug-collection-main.parameters.json"
```

Preview the Azure changes. `what-if` does not deploy the resources:

```powershell
az deployment group what-if `
  --name mug-collection-preview `
  --resource-group $ResourceGroup `
  --template-file infra/main.bicep `
  --parameters infra/main.prod.bicepparam
```

Review unexpected deletes, replacements, locations, SKUs, role assignments, and public network settings before continuing.

## 8. Push the repository

This workspace does not currently contain Git metadata, so initialize it and push `main`:

```powershell
Set-Location $RepositoryRoot
git init -b main
git add .
git status --short
git commit -m 'Initial secure mug collection application'
git remote add origin "https://github.com/$GitHubOwner/$GitHubRepo.git"
git push -u origin main
```

Inspect `git status --short` before committing. It must not include `local.settings.json`, `.azurite`, generated ARM JSON, runtime data, uploaded images, credentials, or deployment packages.

Pushing does not run the production deployment workflow.

## 9. Protect `main` and run repository validation

In GitHub:

1. Open **Actions > Validate** and run the workflow on `main`.
2. Confirm the `Application` and `Infrastructure` jobs pass.
3. Open **Settings > Branches** or **Rules > Rulesets**.
4. Protect `main`, require pull requests, and require the validation checks before merge.

Future changes should go through a branch and pull request rather than direct pushes to `main`.

## 10. Deploy production

The following actions create billable Azure resources:

1. Open **Actions > Deploy production**.
2. Select **Run workflow** and choose `main`.
3. Wait for the `production` environment approval request.
4. Have the configured reviewer inspect the commit and the earlier `what-if` result.
5. The reviewer selects **Review deployments > Approve and deploy**.
6. Wait for infrastructure, API, and frontend deployment steps to finish.

The workflow deploys Bicep first, packages the Flex Function App, and uploads the already-built frontend. It does not persist credentials or deployment data in the repository.

## 11. Find the site URL

After the workflow succeeds:

```powershell
$StaticWebAppName = az staticwebapp list `
  --resource-group $ResourceGroup `
  --query '[0].name' `
  --output tsv

$Hostname = az staticwebapp show `
  --resource-group $ResourceGroup `
  --name $StaticWebAppName `
  --query defaultHostname `
  --output tsv

$SiteUrl = "https://$Hostname"
$SiteUrl
```

## 12. Bootstrap the first administrator

The first administrator is inserted directly into the private `Admins` table. Temporarily grant your signed-in account Table data access:

```powershell
$StorageAccountName = az storage account list `
  --resource-group $ResourceGroup `
  --query "[?starts_with(name, 'mugcollectionprod')].name | [0]" `
  --output tsv

$StorageAccountId = az storage account show `
  --resource-group $ResourceGroup `
  --name $StorageAccountName `
  --query id `
  --output tsv

$OperatorObjectId = az ad signed-in-user show --query id --output tsv

az role assignment create `
  --assignee-object-id $OperatorObjectId `
  --assignee-principal-type User `
  --role 'Storage Table Data Contributor' `
  --scope $StorageAccountId
```

Role assignments can take several minutes to propagate. Then insert the Microsoft-account email used to sign in to the site:

```powershell
$AdminEmail = '<microsoft-account-email>'.Trim().ToLowerInvariant()
$Now = (Get-Date).ToUniversalTime().ToString('o')

az storage entity insert `
  --account-name $StorageAccountName `
  --table-name Admins `
  --auth-mode login `
  --entity PartitionKey=admin RowKey=$AdminEmail email=$AdminEmail addedAt=$Now addedBy=bootstrap
```

After the insert succeeds, remove your temporary data-plane role:

```powershell
az role assignment delete `
  --assignee-object-id $OperatorObjectId `
  --role 'Storage Table Data Contributor' `
  --scope $StorageAccountId
```

## 13. Smoke-test production

Verify:

1. `$SiteUrl` loads without authentication.
2. The empty collection and map render without API errors.
3. **Admin sign in** accepts the bootstrapped Microsoft account.
4. A non-admin Microsoft account can sign in but cannot edit data.
5. The administrator can add a mug and upload an image.
6. The new mug is visible after sign-out.
7. The direct Function App endpoint rejects anonymous access; requests should go through the Static Web App `/api` route.
8. Blob containers remain private and Storage shared-key access remains disabled.

## 14. Subsequent releases

For each later release:

1. Create a branch and pull request.
2. Require the `Validate` workflow to pass.
3. Merge the reviewed pull request to `main`.
4. Run `what-if` for infrastructure changes.
5. Manually dispatch **Deploy production** from `main`.
6. Have the separate production reviewer approve it.
7. Repeat the production smoke test.

To roll back application code, revert the offending commit on a new pull request and deploy the resulting `main`. To roll back infrastructure, revert the Bicep change, inspect `what-if`, and deploy only after confirming that the rollback does not delete stored mug data.
