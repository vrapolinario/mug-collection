# Production deployment guide

This guide deploys the application through GitHub Actions. Pushing code does not deploy anything. The repository owner manually dispatches and explicitly confirms each production deployment. Teams can optionally add a separate reviewer approval when their GitHub plan supports it.

## 1. Prerequisites

You need:

- An Azure subscription where you can create a resource group, app registration, service principal, and role assignments
- An Azure account allowed to create Microsoft Entra app registrations
- Azure CLI, Git, and GitHub CLI
- A GitHub account with administrator access to the repository
- Node.js 22 for local validation

Confirm the tools:

```powershell
az version
git --version
gh --version
node --version
```

## 2. Choose deployment values

Set these values in PowerShell. Use the exact owner and repository names from the GitHub URL. Step 3 retrieves their immutable GitHub IDs because the OIDC subject must be an exact match.

```powershell
$GitHubOwner = '<github-owner>'
$GitHubRepo = 'mug-collection'
$SubscriptionId = '<azure-subscription-id>'
$ResourceGroup = 'rg-mug-collection-prod'
$Location = 'westus2' # Change this to another supported Azure region if needed.
$AppDisplayName = "github-$GitHubRepo-production"
$RepositoryRoot = 'C:\GitHub\mug-collection'
```

## 3. Create an empty GitHub repository

Create `$GitHubOwner/$GitHubRepo` on GitHub. Do not initialize it with a README, `.gitignore`, or license because those files already exist locally.

Sign in to GitHub CLI if needed, then retrieve the immutable owner and repository IDs:

```powershell
gh auth status
# Run `gh auth login` if the preceding command reports that you are not signed in.

$GitHubRepository = gh api "repos/$GitHubOwner/$GitHubRepo" | ConvertFrom-Json
$GitHubOwnerId = $GitHubRepository.owner.id
$GitHubRepoId = $GitHubRepository.id
$GitHubOidcSubject = "repo:${GitHubOwner}@${GitHubOwnerId}/${GitHubRepo}@${GitHubRepoId}:environment:production"
$GitHubOidcSubject
```

For example, the subject has the form `repo:OWNER@OWNER-ID/REPOSITORY@REPOSITORY-ID:environment:production`. GitHub uses this immutable format for repositories created after July 15, 2026. The numeric IDs prevent a renamed, transferred, or recreated repository from inheriting the deployment trust merely by using the same names.

Do not push the code yet. The next steps establish the deployment identity and protected environment first.

## 4. Create the Azure resource group

Sign in, select the subscription, and create the resource group:

```powershell
az login
az account set --subscription $SubscriptionId
az account show --query '{subscription:id, tenant:tenantId, user:user.name}' --output table
az group create --name $ResourceGroup --location $Location
```

Register the resource providers used by the Bicep template. Registration is subscription-wide, can be run repeatedly, and does not deploy application resources:

```powershell
$ResourceProviders = @(
  'Microsoft.Insights'
  'Microsoft.ManagedIdentity'
  'Microsoft.Maps'
  'Microsoft.OperationalInsights'
  'Microsoft.Storage'
  'Microsoft.Web'
)

foreach ($ResourceProvider in $ResourceProviders) {
  az provider register --namespace $ResourceProvider --wait
}

az provider list `
  --query "[?contains(['Microsoft.Insights','Microsoft.ManagedIdentity','Microsoft.Maps','Microsoft.OperationalInsights','Microsoft.Storage','Microsoft.Web'], namespace)].{Namespace:namespace,State:registrationState}" `
  --output table
```

Confirm every listed provider reports `Registered` before continuing. Registering providers requires subscription-level permission for `Microsoft.Resources/subscriptions/providers/register/action`.

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

Create the federated credential using the immutable subject retrieved in step 3. The temporary file is stored outside the repository and deleted immediately afterward:

```powershell
$credentialPath = Join-Path $env:TEMP 'mug-collection-github-oidc.json'
@{
  name = 'github-production'
  issuer = 'https://token.actions.githubusercontent.com'
  subject = $GitHubOidcSubject
  description = 'GitHub Actions production environment'
  audiences = @('api://AzureADTokenExchange')
} | ConvertTo-Json | Set-Content -Path $credentialPath -Encoding utf8

az rest `
  --method POST `
  --url "https://graph.microsoft.com/v1.0/applications/$AppObjectId/federatedIdentityCredentials" `
  --headers 'Content-Type=application/json' `
  --body "@$credentialPath"

Remove-Item $credentialPath
```

This uses Microsoft Graph directly. Some Azure CLI versions can create the same credential through `az ad app federated-credential create` but fail while decoding an empty Graph response, producing `JSONDecodeError: Expecting value`.

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

## 6. Configure the GitHub environment

In the GitHub repository:

1. Open **Settings > Environments**.
2. Create an environment named exactly `production`.
3. Under **Deployment branches and tags**, restrict deployment to `main`.
4. If **Required reviewers** is visible and you want a separate approval, add a person or team and optionally enable **Prevent self-review**. This section is not available for every private-repository GitHub plan and is not required for a single-owner deployment.
5. Add these environment variables under **Environment variables**, not secrets:

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
$env:AZURE_LOCATION = $Location

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

Run validation once before creating the rule so GitHub knows the status-check names:

1. Open the repository's **Actions** tab.
2. In the left sidebar, select **Validate**.
3. Select **Run workflow**.
4. Choose the `main` branch and select the green **Run workflow** button.
5. Open the resulting workflow run and confirm both **Application** and **Infrastructure** succeed.

Create a branch ruleset from the page shown in the screenshot:

1. Open **Settings** in the repository.
2. In the left sidebar, select **Branches**.
3. Select **Add branch ruleset**. GitHub opens **Rules > Rulesets > New branch ruleset**.
4. Enter `Protect main` under **Ruleset name**.
5. Set **Enforcement status** to **Active**.
6. Leave **Bypass list** empty. This makes the rule apply to repository administrators too. Add a bypass only if you intentionally need an emergency override.
7. Under **Target branches**, select **Add a target**, then **Include default branch**. Confirm that GitHub shows `main` as the target.
8. Under **Branch protections**, enable **Restrict deletions** and **Block force pushes**.
9. Enable **Require a pull request before merging**.
10. Expand its settings and set **Required approvals** to `0` for a single-owner repository. Leave **Require review from Code Owners** off. The pull request still provides a visible change record without requiring another person.
11. Enable **Require status checks to pass** or **Require status checks to pass before merging**.
12. Select **Add checks**, search for `Application`, select it, and add it.
13. Select **Add checks** again, search for `Infrastructure`, select it, and add it.
14. Enable **Require branches to be up to date before merging** if that option is shown.
15. Select **Create** at the bottom of the page.

If `Application` or `Infrastructure` is not listed, wait for the manually started **Validate** workflow to finish successfully, refresh the ruleset page, and try **Add checks** again.

If GitHub displays an upgrade requirement or does not allow **Active** enforcement for this private repository, do not make the repository public just to enable the rule. Skip the ruleset for now and retain the manual deployment confirmation from step 10. Branch protection improves the development workflow, but it is not required for OIDC authentication or deployment.

After this rule is active, make future changes on a branch, open a pull request into `main`, wait for both checks, and merge the pull request yourself. Direct pushes to `main` will be blocked.

## 10. Deploy production

The following actions create billable Azure resources:

1. Open **Actions > Deploy production**.
2. Select **Run workflow** and choose `main`.
3. Enter the Azure region in **Azure region for application resources**.
4. Select **Run workflow** to approve and start your deployment.
5. If a separate environment reviewer is configured, wait for that reviewer to approve the deployment.
6. Wait for infrastructure, API, and frontend deployment steps to finish.

The workflow does nothing unless the confirmation checkbox is selected. After approval, it passes the selected region to Bicep through `AZURE_LOCATION`, deploys Bicep first, packages the Flex Function App, and uploads the already-built frontend. It does not persist credentials or deployment data in the repository. Confirm that the selected region supports Static Web Apps Standard, Functions Flex Consumption, Azure Maps Gen2, and the other template resources before approval.

The storage public endpoint remains network-reachable because the Flex Consumption deployment service must upload and validate the API package in the `function-releases` container. This does not make storage content public: blob anonymous access and shared-key authentication are disabled, containers are private, and data operations require Microsoft Entra roles. The API upload retries briefly because a newly created managed-identity role assignment can take time to propagate.

If **Deploy API** reports `InaccessibleStorageException` with status `403`, verify both controls before retrying:

```powershell
$StorageAccountName = az storage account list `
  --resource-group $ResourceGroup `
  --query "[?starts_with(name, 'mugcollectionprod')].name | [0]" `
  --output tsv

az storage account show `
  --resource-group $ResourceGroup `
  --name $StorageAccountName `
  --query '{PublicNetworkAccess:publicNetworkAccess,DefaultAction:networkRuleSet.defaultAction,SharedKeyAccess:allowSharedKeyAccess}' `
  --output table
```

The expected values are `Enabled`, `Allow`, and `False`. If those values are correct, confirm the `mugcollection-prod-runtime` identity has `Storage Blob Data Owner` on the storage account. Do not enable shared-key access or make the container public to resolve this error.

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
if ($AdminEmail -match '^<.*>$' -or $AdminEmail -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
  throw 'Set $AdminEmail to the Microsoft account email used to sign in to the site.'
}

$Now = (Get-Date).ToUniversalTime().ToString('o')

az storage entity insert `
  --account-name $StorageAccountName `
  --table-name Admins `
  --auth-mode login `
  --entity "PartitionKey=admin" "RowKey=$AdminEmail" "email=$AdminEmail" "addedAt=$Now" "addedBy=bootstrap" `
  --if-exists replace

$AdminEntity = az storage entity show `
  --account-name $StorageAccountName `
  --table-name Admins `
  --auth-mode login `
  --partition-key admin `
  --row-key $AdminEmail | ConvertFrom-Json

if ($AdminEntity.email -cne $AdminEmail) {
  throw 'The administrator entity was not stored with the expected email.'
}
```

If an earlier attempt ran with `$AdminEmail` unset, it may have created an empty administrator entity. After the valid entity above is verified, remove only that malformed row:

```powershell
az storage entity delete `
  --account-name $StorageAccountName `
  --table-name Admins `
  --auth-mode login `
  --partition-key admin `
  --row-key=
```

After the insert succeeds, remove your temporary data-plane role:

```powershell
az role assignment delete `
  --assignee-object-id $OperatorObjectId `
  --role 'Storage Table Data Contributor' `
  --scope $StorageAccountId
```

### Troubleshoot administrator sign-in

After signing in, open `https://<static-web-app-hostname>/.auth/me` in the same browser. `clientPrincipal` must not be `null`; its `userDetails` value identifies the Microsoft account known to Static Web Apps.

Open the browser developer tools, select **Network**, reload the site, and inspect `GET /api/management/session`. The expected status is `200` with an `authenticated`, `authorized`, and `email` result:

- `authenticated: false` means the API did not receive a Static Web Apps identity.
- `authenticated: true` and `authorized: false` means the returned `email` does not exactly match a normalized `Admins` row key.
- `404` means the frontend or API is from an older deployment that still uses the `/api/admin*` path, which this linked backend does not forward.
- `500` means the Function reached an application or Storage error. Query Application Insights using the request's approximate time.

The frontend also displays session-check failures in the page footer. Do not share the complete `/.auth/me` response publicly because it contains identity details.

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
6. Review and select the production confirmation checkbox.
7. If configured, have the separate production reviewer approve it.
8. Repeat the production smoke test.

To roll back application code, revert the offending commit on a new pull request and deploy the resulting `main`. To roll back infrastructure, revert the Bicep change, inspect `what-if`, and deploy only after confirming that the rollback does not delete stored mug data.
