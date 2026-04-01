param(
    [string]$Subscription = "",
    [string]$Location = "centralindia",
    [string]$ResourceGroup = "rg-document-integrity",
    [string]$AppServicePlan = "plan-document-integrity",
    [string]$WebAppName = "document-integrity-$([int](Get-Date -UFormat %s))",
    [string]$StorageName = "documentintegrity$([int](Get-Date -UFormat %s))",
    [string]$ServiceBusNamespace = "sb-document-integrity-$([int](Get-Date -UFormat %s))",
    [string]$ServiceBusQueue = "document-analysis",
    [string]$SqlServerName = "sql-document-integrity-$([int](Get-Date -UFormat %s))",
    [string]$SqlDatabaseName = "db-document-integrity",
    [string]$NodeVersion = "20-lts",
    [string]$AppServiceSku = "F1"
)

$ErrorActionPreference = 'Stop'

$AllowedLocations = @('malaysiawest','eastasia','koreacentral','centralindia','uaenorth')
if (-not ($AllowedLocations -contains $Location)) {
    throw "Invalid location '$Location'. Use one of: $($AllowedLocations -join ', ')"
}

function ExecAz {
    param(
        [string[]]$AzArgs
    )

    $result = & az @AzArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Azure CLI failed: az $($AzArgs -join ' ')"
    }
    return $result
}

if ([string]::IsNullOrWhiteSpace($Subscription)) {
    throw "Subscription is required. Run the script with -Subscription <id or name>."
}

Write-Host "Starting Azure deployment in region '$Location'..."

try {
    ExecAz @('account','show') > $null 2>&1
} catch {
    ExecAz @('login')
}

ExecAz @('account','set','--subscription',$Subscription,'--output','none')

Write-Host "Registering Azure providers..."
ExecAz @('provider','register','--namespace','Microsoft.Web','--output','none')
ExecAz @('provider','register','--namespace','Microsoft.OperationalInsights','--output','none')
ExecAz @('provider','register','--namespace','Microsoft.Insights','--output','none')

Write-Host "Creating resource group '$ResourceGroup'..."
ExecAz @('group','create','--name',$ResourceGroup,'--location',$Location,'--output','none')

$StorageName = $StorageName.ToLower()
if ($StorageName.Length -gt 24) {
    $StorageName = $StorageName.Substring(0,24)
}

Write-Host "Creating Storage Account '$StorageName'..."
ExecAz @('storage','account','create','--name',$StorageName,'--resource-group',$ResourceGroup,'--location',$Location,'--sku','Standard_LRS','--kind','StorageV2','--https-only','true','--min-tls-version','TLS1_2','--output','none')

Write-Host "Creating blob container 'pdf-uploads'..."
$storageKey = ExecAz @('storage','account','keys','list','--resource-group',$ResourceGroup,'--account-name',$StorageName,'--query','[0].value','-o','tsv')
ExecAz @('storage','container','create','--name','pdf-uploads','--account-name',$StorageName,'--account-key',$storageKey,'--output','none')

Write-Host "Creating Service Bus namespace '$ServiceBusNamespace'..."
ExecAz @('servicebus','namespace','create','--resource-group',$ResourceGroup,'--name',$ServiceBusNamespace,'--location',$Location,'--sku','Basic','--output','none')
ExecAz @('servicebus','queue','create','--resource-group',$ResourceGroup,'--namespace-name',$ServiceBusNamespace,'--name',$ServiceBusQueue,'--output','none')

$SqlAdmin = Read-Host "Enter SQL admin username (example: sqladminuser)"
$SqlPassword = Read-Host "Enter SQL admin password (strong password required)"

Write-Host "Creating SQL Server '$SqlServerName'..."
ExecAz @('sql','server','create','--name',$SqlServerName,'--resource-group',$ResourceGroup,'--location',$Location,'--admin-user',$SqlAdmin,'--admin-password',$SqlPassword,'--output','none')
ExecAz @('sql','db','create','--resource-group',$ResourceGroup,'--server',$SqlServerName,'--name',$SqlDatabaseName,'--service-objective','Basic','--output','none')
ExecAz @('sql','server','firewall-rule','create','--resource-group',$ResourceGroup,'--server',$SqlServerName,'--name','AllowAzureServices','--start-ip-address','0.0.0.0','--end-ip-address','0.0.0.0','--output','none')

try {
    $clientIP = (Invoke-RestMethod 'https://api.ipify.org').Trim()
    if ($clientIP) {
        Write-Host "Adding local SQL firewall IP: $clientIP"
        ExecAz @('sql','server','firewall-rule','create','--resource-group',$ResourceGroup,'--server',$SqlServerName,'--name','AllowClientIP','--start-ip-address',$clientIP,'--end-ip-address',$clientIP,'--output','none')
    }
} catch {
    Write-Warning "Unable to detect local IP for SQL firewall. Add it manually later if needed."
}

Write-Host "Creating App Service plan '$AppServicePlan'..."
try {
    ExecAz @('appservice','plan','create','--name',$AppServicePlan,'--resource-group',$ResourceGroup,'--location',$Location,'--sku',$AppServiceSku,'--is-linux','--output','none')
} catch {
    Write-Warning "Free tier (F1) unavailable or throttled. Falling back to Basic tier (B1)..."
    $AppServiceSku = 'B1'
    ExecAz @('appservice','plan','create','--name',$AppServicePlan,'--resource-group',$ResourceGroup,'--location',$Location,'--sku',$AppServiceSku,'--is-linux','--output','none')
}

Write-Host "Creating Web App '$WebAppName'..."
ExecAz @('webapp','create','--name',$WebAppName,'--resource-group',$ResourceGroup,'--plan',$AppServicePlan,'--runtime',"NODE|$NodeVersion",'--output','none')

Write-Host "Configuring app settings..."
$serviceBusConn = ExecAz @('servicebus','namespace','authorization-rule','keys','list','--resource-group',$ResourceGroup,'--namespace-name',$ServiceBusNamespace,'--name','RootManageSharedAccessKey','--query','primaryConnectionString','-o','tsv')
$storageConn = ExecAz @('storage','account','show-connection-string','--resource-group',$ResourceGroup,'--name',$StorageName,'--query','connectionString','-o','tsv')
$sqlConn = "Server=tcp:$SqlServerName.database.windows.net,1433;Initial Catalog=$SqlDatabaseName;Persist Security Info=False;User ID=$SqlAdmin;Password=$SqlPassword;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;"

ExecAz @('webapp','config','appsettings','set','--name',$WebAppName,'--resource-group',$ResourceGroup,'--settings',
    "NODE_ENV=production",
    "PORT=8080",
    "WEBSITE_NODE_DEFAULT_VERSION=~20",
    "AZURE_SERVICE_BUS_CONNECTION_STRING=$serviceBusConn",
    "AZURE_SERVICE_BUS_QUEUE_NAME=$ServiceBusQueue",
    "AZURE_STORAGE_CONNECTION_STRING=$storageConn",
    "AZURE_STORAGE_CONTAINER_NAME=pdf-uploads",
    "AZURE_SQL_CONNECTION_STRING=$sqlConn",
    "AZURE_SQL_SERVER=$SqlServerName",
    "AZURE_SQL_DATABASE=$SqlDatabaseName"
)

Write-Host "Configuring startup command..."
ExecAz @('webapp','config','set','--name',$WebAppName,'--resource-group',$ResourceGroup,'--startup-file',"node backend/app.js",'--output','none')

Write-Host "Packaging app for deployment..."
Push-Location (Join-Path $PSScriptRoot "..")
try {
    $zipPath = Join-Path (Get-Location) deploy.zip
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    $items = Get-ChildItem -Path . -Recurse -File | Where-Object { $_.FullName -notmatch '\.git\|\bnode_modules\b|\bmodules\b|\buploads\b' -and $_.Name -ne '.env' -and -not $_.Name.EndsWith('.zip') }
    Compress-Archive -Path ($items | Select-Object -ExpandProperty FullName) -DestinationPath $zipPath -Force
    ExecAz @('webapp','deploy','--name',$WebAppName,'--resource-group',$ResourceGroup,'--src-path',$zipPath,'--type','zip','--output','none')
    Remove-Item $zipPath -Force
} finally {
    Pop-Location
}

$webAppUrl = "https://$WebAppName.azurewebsites.net"
Write-Host "Deployment complete!"
Write-Host "Web App URL: $webAppUrl"
