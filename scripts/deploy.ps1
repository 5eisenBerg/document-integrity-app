    param(
        [string]$Subscription = "",
        [string]$ResourceGroup = "rg-document-integrity",
        [string]$Location = "centralindia",
        [string]$AppServicePlan = "plan-document-integrity",
        [string]$WebAppName = "document-integrity-$([int](Get-Date -UFormat %s))",
        [string]$StorageName = "documentintegrity$([int](Get-Date -UFormat %s))",
        [string]$ServiceBusNamespace = "sb-document-integrity-$([int](Get-Date -UFormat %s))",
        [string]$ServiceBusQueue = "document-analysis",
        [string]$SqlServerName = "sql-document-integrity-$([int](Get-Date -UFormat %s))",
        [string]$SqlDatabaseName = "db-document-integrity",
        [string]$AppInsightsName = "ai-document-integrity-$([int](Get-Date -UFormat %s))",
        [string]$NodeVersion = "20-lts",
        [string]$AppServiceSku = "F1"
    )

    Set-StrictMode -Version Latest
    $ErrorActionPreference = 'Stop'

    function Prompt-IfEmpty {
        param(
            [string]$Value,
            [string]$PromptText
        )
        if ([string]::IsNullOrWhiteSpace($Value)) {
            return Read-Host $PromptText
        }
        return $Value
    }

    function Invoke-Az {
        param(
            [string[]]$AzArgs,
            [string]$Message = "",
            [int]$MaxRetries = 4,
            [int]$RetryDelaySeconds = 15
        )

        if ($Message) {
            Write-Host $Message
        }

        for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
            $oldErrorAction = $ErrorActionPreference
            $ErrorActionPreference = 'Continue'
            $output = & az @AzArgs 2>&1
            $exitCode = $LASTEXITCODE
            $ErrorActionPreference = $oldErrorAction

            if ($exitCode -eq 0) {
                return $output
            }

            if ($attempt -lt $MaxRetries) {
                Write-Warning "Azure CLI command failed with ARM propagation lag or capacity error (Attempt $attempt of $MaxRetries). Retrying in $RetryDelaySeconds seconds..."
                Start-Sleep -Seconds $RetryDelaySeconds
            } else {
                Write-Error $output
                throw "Azure CLI failed after $MaxRetries attempts: $Message`nCommand: az $($AzArgs -join ' ')"
            }
        }
    }

    Write-Host "Azure deployment starting..." -ForegroundColor Cyan

    # Login
    Write-Host "Checking Azure login..."
    $loginStatus = & az account show > $null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Invoke-Az -AzArgs @('login') -Message 'Logging in to Azure...'
    }

    # Register required resource providers
    Invoke-Az -AzArgs @('provider','register','--namespace','Microsoft.Web','--output','none') -Message 'Registering required Azure provider Microsoft.Web...'
    Invoke-Az -AzArgs @('provider','register','--namespace','Microsoft.OperationalInsights','--output','none') -Message 'Registering required Azure provider Microsoft.OperationalInsights...'
    Invoke-Az -AzArgs @('provider','register','--namespace','Microsoft.Insights','--output','none') -Message 'Registering required Azure provider Microsoft.Insights...'

    # Set subscription
    if (![string]::IsNullOrWhiteSpace($Subscription)) {
        Write-Host "Setting subscription to '$Subscription'..."
        Invoke-Az -AzArgs @('account','set','--subscription',$Subscription,'--output','none')
    } else {
        Write-Host "No explicit subscription parameter provided. Using default active subscription..."
    }

    # Create resource group
    Write-Host "Creating Resource Group: $ResourceGroup"
    Invoke-Az -AzArgs @('group','create','--name',$ResourceGroup,'--location',$Location,'--output','none')

    # Create storage account
    $StorageName = $StorageName.ToLower()
    if ($StorageName.Length -gt 24) { $StorageName = $StorageName.Substring(0,24) }
    Write-Host "Creating Storage Account: $StorageName"
    Invoke-Az -AzArgs @('storage','account','create','--name',$StorageName,'--resource-group',$ResourceGroup,'--location',$Location,'--sku','Standard_LRS','--kind','StorageV2','--https-only','true','--min-tls-version','TLS1_2','--output','none')

    # Create blob container
    Write-Host "Creating Blob Container: pdf-uploads"

    Write-Host "Polling for Storage Account keys (waiting for ARM propagation)..."
    $storageKey = $null
    for ($i = 0; $i -lt 12; $i++) {
        $oldErrorAction = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $keys = az storage account keys list --resource-group $ResourceGroup --account-name $StorageName --query '[0].value' -o tsv 2>$null
        $ErrorActionPreference = $oldErrorAction

        if ($LASTEXITCODE -eq 0 -and ![string]::IsNullOrWhiteSpace($keys)) {
            $storageKey = $keys
            break
        }
        Write-Host "Waiting 10s for Storage deployment logic... ($($i*10)s elapsed)"
        Start-Sleep -Seconds 10
    }

    if ([string]::IsNullOrWhiteSpace($storageKey)) {
        throw "Azure Storage Account keys were not available in time. Deployment aborted."
    }

    Invoke-Az -AzArgs @('storage','container','create','--name','pdf-uploads','--account-name',$StorageName,'--account-key',$storageKey,'--output','none')

    # Create Service Bus namespace and queue
    Write-Host "Creating Service Bus Namespace: $ServiceBusNamespace"
    Invoke-Az -AzArgs @('servicebus','namespace','create','--resource-group',$ResourceGroup,'--name',$ServiceBusNamespace,'--location',$Location,'--sku','Basic','--output','none')
    Write-Host "Creating Service Bus queue: $ServiceBusQueue"
    Invoke-Az -AzArgs @('servicebus','queue','create','--resource-group',$ResourceGroup,'--namespace-name',$ServiceBusNamespace,'--name',$ServiceBusQueue,'--output','none')

    # Create SQL Server and database
    $SqlAdmin = Prompt-IfEmpty $env:AZURE_SQL_ADMIN_USER "Enter SQL admin username (example: sqladminuser):"
    $SqlPassword = Prompt-IfEmpty $env:AZURE_SQL_ADMIN_PASSWORD "Enter SQL admin password (strong password required):"
    Write-Host "Creating SQL Server: $SqlServerName"
    Invoke-Az -AzArgs @('sql','server','create','--name',$SqlServerName,'--resource-group',$ResourceGroup,'--location',$Location,'--admin-user',$SqlAdmin,'--admin-password',$SqlPassword,'--output','none')
    Write-Host "Creating SQL Database: $SqlDatabaseName"
    Invoke-Az -AzArgs @('sql','db','create','--resource-group',$ResourceGroup,'--server',$SqlServerName,'--name',$SqlDatabaseName,'--service-objective','Basic','--output','none')

    Write-Host "Allowing Azure services to access SQL Server"
    Invoke-Az -AzArgs @('sql','server','firewall-rule','create','--resource-group',$ResourceGroup,'--server',$SqlServerName,'--name','AllowAzureServices','--start-ip-address','0.0.0.0','--end-ip-address','0.0.0.0','--output','none')

    try {
        $clientIP = (Invoke-RestMethod "https://api.ipify.org").Trim()
        if ($clientIP -and $clientIP -ne "") {
            Write-Host "Creating SQL firewall rule for local client IP: $clientIP"
            Invoke-Az -AzArgs @('sql','server','firewall-rule','create','--resource-group',$ResourceGroup,'--server',$SqlServerName,'--name','AllowClientIP','--start-ip-address',$clientIP,'--end-ip-address',$clientIP,'--output','none')
        }
    } catch {
        Write-Warning "Unable to detect local public IP for SQL firewall. Local access may require manual firewall configuration."
    }

    function Get-AppServicePlanName {
        param(
            [string]$PlanName,
            [string]$ResourceGroup
        )
        try {
            return az appservice plan show --name $PlanName --resource-group $ResourceGroup --query name -o tsv 2>$null
        } catch {
            return $null
        }
    }

    function Wait-AppServicePlanCreation {
        param(
            [string]$PlanName,
            [string]$ResourceGroup,
            [int]$MaxRetries = 18,
            [int]$DelaySeconds = 10
        )

        for ($i = 0; $i -lt $MaxRetries; $i++) {
            try {
                $planName = az appservice plan show --name $PlanName --resource-group $ResourceGroup --query name -o tsv 2>$null
                if ($planName) {
                    return $true
                }
            } catch {
                # resource not yet available
            }
            Start-Sleep -Seconds $DelaySeconds
        }
        return $false
    }

    function Create-AppServicePlanWithFallback {
        param(
            [string]$PlanName,
            [string]$ResourceGroup,
            [string]$Location,
            [string[]]$SkuOptions
        )

        foreach ($sku in $SkuOptions) {
            for ($attempt = 1; $attempt -le 3; $attempt++) {
                Write-Host "Attempting App Service plan creation with SKU: $sku (attempt $attempt of 3)"
                
                # Temporarily suppress terminating errors from native command stderr
                $oldErrorAction = $ErrorActionPreference
                $ErrorActionPreference = 'Continue'
                $result = az appservice plan create --name $PlanName --resource-group $ResourceGroup --location $Location --sku $sku --is-linux --no-wait 2>&1
                $ErrorActionPreference = $oldErrorAction

                if ($LASTEXITCODE -eq 0) {
                    if (Wait-AppServicePlanCreation -PlanName $PlanName -ResourceGroup $ResourceGroup) {
                        Write-Host "App Service plan '$PlanName' created successfully with SKU $sku"
                        return
                    }
                    Write-Warning "App Service plan '$PlanName' did not become available within the expected time for SKU $sku."
                } else {
                    Write-Warning "SKU $sku attempt $attempt failed with exit code $LASTEXITCODE."
                    Write-Warning $result
                }

                if ($attempt -lt 3) {
                    Write-Host "Waiting 20 seconds before retrying SKU $sku..."
                    Start-Sleep -Seconds 20
                }
            }

            Write-Host "Moving to next SKU option."
            Start-Sleep -Seconds 10
        }

        throw "App Service plan '$PlanName' could not be created or is not available. Please retry later or use a different SKU/region."
    }

    # Create App Service plan and Web App
    $skuCandidates = @($AppServiceSku, 'F1') | Where-Object { $_ -ne $null -and $_ -ne '' } | Select-Object -Unique
    Write-Host "Creating App Service plan: $AppServicePlan"
    Create-AppServicePlanWithFallback -PlanName $AppServicePlan -ResourceGroup $ResourceGroup -Location $Location -SkuOptions $skuCandidates

    Write-Host "Creating Web App: $WebAppName"
    az webapp create --name $WebAppName --resource-group $ResourceGroup --plan $AppServicePlan --runtime "NODE:$NodeVersion" --output none

    try {
        $webAppName = az webapp show --name $WebAppName --resource-group $ResourceGroup --query name -o tsv 2>$null
    } catch {
        $webAppName = $null
    }
    if (-not $webAppName) {
        throw "Web App '$WebAppName' could not be created. Please verify the App Service plan and retry."
    }

    # Create Application Insights
    Write-Host "Creating Application Insights: $AppInsightsName"
    $appInsightsCreated = $false
    try {
        az config set extension.use_dynamic_install=yes_without_prompt --output none | Out-Null
        az monitor app-insights component create --app $AppInsightsName --location $Location --resource-group $ResourceGroup --application-type web --kind web --output none
        $appInsightsCreated = $true
    } catch {
        Write-Warning "Application Insights creation failed: $($_.Exception.Message). Continuing without Application Insights."
    }

    # Verify Application Insights resource exists before using it
    if ($appInsightsCreated) {
        try {
            az monitor app-insights component show --app $AppInsightsName --resource-group $ResourceGroup --query name -o tsv | Out-Null
        } catch {
            Write-Warning "Application Insights resource not found after creation. Skipping Application Insights settings."
            $appInsightsCreated = $false
        }
    }

    # Configure Web App settings
    Write-Host "Configuring Web App settings"
    $serviceBusConn = az servicebus namespace authorization-rule keys list --resource-group $ResourceGroup --namespace-name $ServiceBusNamespace --name RootManageSharedAccessKey --query primaryConnectionString -o tsv
    $storageConn = az storage account show-connection-string --resource-group $ResourceGroup --name $StorageName --query connectionString -o tsv
    $sqlConn = "Server=tcp:$SqlServerName.database.windows.net,1433;Initial Catalog=$SqlDatabaseName;Persist Security Info=False;User ID=$SqlAdmin;Password=$SqlPassword;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;"

    $appSettings = @(
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

    if ($appInsightsCreated) {
        $appInsightsConn = az monitor app-insights component show --app $AppInsightsName --resource-group $ResourceGroup --query connectionString -o tsv
        $appInsightsKey = az monitor app-insights component show --app $AppInsightsName --resource-group $ResourceGroup --query instrumentationKey -o tsv
        $appSettings += "APPLICATIONINSIGHTS_CONNECTION_STRING=$appInsightsConn"
        $appSettings += "APPINSIGHTS_INSTRUMENTATIONKEY=$appInsightsKey"
    }

    az webapp config appsettings set --name $WebAppName --resource-group $ResourceGroup --settings $appSettings --output none

    # Configure startup command
    Write-Host "Configuring startup command"
    az webapp config set --name $WebAppName --resource-group $ResourceGroup --startup-file "node backend/app.js" --output none

    # Configure health check
    Write-Host "Configuring health check"
    $healthConfig = '{"healthCheckPath":"/health"}'
    az webapp config set --name $WebAppName --resource-group $ResourceGroup --generic-configurations $healthConfig --output none

    # Deploy app content
    Write-Host "Packaging and deploying application"
    Push-Location (Join-Path $PSScriptRoot "..")
    try {
        $zipPath = Join-Path (Get-Location) deploy.zip
        if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

        $items = Get-ChildItem -Path (Get-Location) -Recurse -File | Where-Object {
            $path = $_.FullName.ToLower()
            -not ($path -match '\\.git\\|\\node_modules\\|\\modules\\|\\uploads\\') -and
            $_.Name -ne '.env' -and
            -not $_.Name.EndsWith('.zip')
        }

        Compress-Archive -Path ($items | Select-Object -ExpandProperty FullName) -DestinationPath $zipPath -Force
        az webapp deploy --name $WebAppName --resource-group $ResourceGroup --src-path $zipPath --type zip --output none
        Remove-Item $zipPath -Force
    } finally {
        Pop-Location
    }

    $webAppUrl = "https://$WebAppName.azurewebsites.net"
    Write-Host "Deployment complete!" -ForegroundColor Green
    Write-Host "Web App URL: $webAppUrl"
    Write-Host "Health check: $webAppUrl/health"
    Write-Host "Application Insights: $AppInsightsName"
    Write-Host "Storage account: $StorageName"
    Write-Host "Service Bus namespace: $ServiceBusNamespace"
    Write-Host "SQL Server: $SqlServerName"
