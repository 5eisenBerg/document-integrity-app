#!/usr/bin/env bash
set -euo pipefail

# Document Integrity System — Azure deployment for frontend + backend
# Usage:
#   bash deploy-new.sh -s <subscription-id> -l <location>
# Example:
#   bash deploy-new.sh -s 420177a0-18b0-4eee-b0f1-e2a2d80a8171 -l centralindia

ALLOWED_LOCATIONS=(malaysiawest eastasia koreacentral centralindia uaenorth)
RESOURCE_GROUP="rg-document-integrity-app"
LOCATION="centralindia"
APP_SERVICE_PLAN="plan-document-integrity-app"
WEB_APP_NAME="document-integrity-app-$(date +%s)"
STORAGE_NAME="documentintegrityapp$(date +%s)"
SERVICEBUS_NAMESPACE="document-integrity-sb-$(date +%s)"
SERVICEBUS_QUEUE="document-integrity-queue"
SQL_SERVER_NAME=""
SQL_DATABASE_NAME="db-document-integrity"
NODE_VERSION="20-lts"
SKU="F1"
SUBSCRIPTION_ID=""

function usage() {
  cat <<EOF
Usage: bash deploy-new.sh [options]

Options:
  -s SUBSCRIPTION_ID   Azure subscription ID or name
  -l LOCATION          Azure region (allowed: ${ALLOWED_LOCATIONS[*]})
  -n SQL_SERVER_NAME   Optional SQL Server name to use instead of prompt
  -h                   Show this help message

Example:
  bash deploy-new.sh -s 420177a0-18b0-4eee-b0f1-e2a2d80a8171 -l centralindia -n documentintegritysql
EOF
  exit 1
}

while getopts ":s:l:n:h" opt; do
  case "$opt" in
    s) SUBSCRIPTION_ID="$OPTARG" ;;
    l) LOCATION="$OPTARG" ;;
    n) SQL_SERVER_NAME="$OPTARG" ;;
    h) usage ;;
    *) usage ;;
  esac
done

if [[ -z "$SUBSCRIPTION_ID" ]]; then
  echo "ERROR: subscription ID is required."
  usage
fi

if [[ -z "$SQL_SERVER_NAME" ]]; then
  read -rp "Enter SQL server name (lowercase letters and numbers only): " SQL_SERVER_NAME
fi

if [[ ! " ${ALLOWED_LOCATIONS[*]} " =~ " ${LOCATION} " ]]; then
  echo "ERROR: Invalid location '$LOCATION'. Allowed locations: ${ALLOWED_LOCATIONS[*]}"
  exit 1
fi

function az_check() {
  command -v az >/dev/null 2>&1 || {
    echo "ERROR: Azure CLI not found. Install az and try again."
    exit 1
  }
}

az_check

echo "🔐 Logging into Azure..."
az account show >/dev/null 2>&1 || az login

echo "📌 Setting subscription to '$SUBSCRIPTION_ID'..."
az account set --subscription "$SUBSCRIPTION_ID"

echo "📍 Validating allowed location '$LOCATION'..."
if ! az account list-locations --query "[].name" -o tsv | grep -qx "$LOCATION"; then
  echo "ERROR: location '$LOCATION' is not available for this subscription."
  exit 1
fi

cd "$(dirname "$0")/.."

echo "
══════════════ Azure deployment starting ══════════════"

# Create resource group
echo "📦 Creating resource group: $RESOURCE_GROUP"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

# Create storage account
STORAGE_NAME=$(echo "$STORAGE_NAME" | tr '[:upper:]' '[:lower:]' | cut -c1-24)
echo "🧱 Creating storage account: $STORAGE_NAME"
az storage account create \
  --name "$STORAGE_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --https-only true \
  --min-tls-version TLS1_2 \
  --output none

# Wait for storage key availability
echo "⏳ Waiting for storage account keys..."
for i in {1..12}; do
  STORAGE_KEY=$(az storage account keys list --resource-group "$RESOURCE_GROUP" --account-name "$STORAGE_NAME" --query '[0].value' -o tsv 2>/dev/null || true)
  if [[ -n "$STORAGE_KEY" ]]; then
    break
  fi
  echo "  waiting... ($i/12)"
  sleep 10
done
if [[ -z "$STORAGE_KEY" ]]; then
  echo "ERROR: Storage account keys were not available in time."
  exit 1
fi

echo "📁 Creating blob container: pdf-uploads"
az storage container create \
  --name "pdf-uploads" \
  --account-name "$STORAGE_NAME" \
  --account-key "$STORAGE_KEY" \
  --output none

# Create Service Bus
echo "📨 Creating Service Bus namespace: $SERVICEBUS_NAMESPACE"
az servicebus namespace create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$SERVICEBUS_NAMESPACE" \
  --location "$LOCATION" \
  --sku Basic \
  --output none

echo "📬 Creating Service Bus queue: $SERVICEBUS_QUEUE"
az servicebus queue create \
  --resource-group "$RESOURCE_GROUP" \
  --namespace-name "$SERVICEBUS_NAMESPACE" \
  --name "$SERVICEBUS_QUEUE" \
  --output none

# Create SQL Server and Database
read -rp "Enter SQL admin username (example: sqladminuser): " SQL_ADMIN_USER
read -rsp "Enter SQL admin password: " SQL_ADMIN_PASSWORD
printf "\n"

echo "💾 Creating SQL server: $SQL_SERVER_NAME"
az sql server create \
  --name "$SQL_SERVER_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --admin-user "$SQL_ADMIN_USER" \
  --admin-password "$SQL_ADMIN_PASSWORD" \
  --output none

echo "🗄️  Creating SQL database: $SQL_DATABASE_NAME"
az sql db create \
  --resource-group "$RESOURCE_GROUP" \
  --server "$SQL_SERVER_NAME" \
  --name "$SQL_DATABASE_NAME" \
  --service-objective Basic \
  --output none

echo "🔓 Allowing Azure services to access SQL Server"
az sql server firewall-rule create \
  --resource-group "$RESOURCE_GROUP" \
  --server "$SQL_SERVER_NAME" \
  --name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0 \
  --output none

PUBLIC_IP=""
if command -v curl >/dev/null 2>&1; then
  PUBLIC_IP=$(curl -s https://api.ipify.org || true)
elif command -v wget >/dev/null 2>&1; then
  PUBLIC_IP=$(wget -qO- https://api.ipify.org || true)
fi

if [[ -n "$PUBLIC_IP" ]]; then
  echo "🌐 Adding local client IP firewall rule: $PUBLIC_IP"
  az sql server firewall-rule create \
    --resource-group "$RESOURCE_GROUP" \
    --server "$SQL_SERVER_NAME" \
    --name AllowClientIP \
    --start-ip-address "$PUBLIC_IP" \
    --end-ip-address "$PUBLIC_IP" \
    --output none || true
else
  echo "⚠️  Could not determine local public IP. Add SQL firewall rule manually if needed."
fi

# Create App Service plan and Web App
echo "🧩 Creating App Service plan: $APP_SERVICE_PLAN ($SKU)"
az appservice plan create \
  --name "$APP_SERVICE_PLAN" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku "$SKU" \
  --is-linux \
  --output none

echo "🌍 Creating Web App: $WEB_APP_NAME"
az webapp create \
  --name "$WEB_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --plan "$APP_SERVICE_PLAN" \
  --runtime "NODE|$NODE_VERSION" \
  --output none

echo "⚙️  Configuring Node.js startup..."
az webapp config set \
  --name "$WEB_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --startup-file "node backend/app.js" \
  --output none

# Configure app settings and startup
SERVICEBUS_CONNECTION_STRING=$(az servicebus namespace authorization-rule keys list \
  --resource-group "$RESOURCE_GROUP" \
  --namespace-name "$SERVICEBUS_NAMESPACE" \
  --name RootManageSharedAccessKey \
  --query primaryConnectionString -o tsv)
STORAGE_CONNECTION_STRING=$(az storage account show-connection-string \
  --resource-group "$RESOURCE_GROUP" \
  --name "$STORAGE_NAME" \
  --query connectionString -o tsv)
SQL_CONNECTION_STRING="Server=tcp:$SQL_SERVER_NAME.database.windows.net,1433;Initial Catalog=$SQL_DATABASE_NAME;Persist Security Info=False;User ID=$SQL_ADMIN_USER;Password=$SQL_ADMIN_PASSWORD;MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;"

echo "⚙️  Configuring App Service settings"
az webapp config appsettings set \
  --name "$WEB_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --settings \
    NODE_ENV=production \
    PORT=8080 \
    WEBSITE_NODE_DEFAULT_VERSION=~20 \
    AZURE_SERVICE_BUS_CONNECTION_STRING="$SERVICEBUS_CONNECTION_STRING" \
    AZURE_SERVICE_BUS_QUEUE_NAME="$SERVICEBUS_QUEUE" \
    AZURE_STORAGE_CONNECTION_STRING="$STORAGE_CONNECTION_STRING" \
    AZURE_STORAGE_CONTAINER_NAME="pdf-uploads" \
    AZURE_SQL_CONNECTION_STRING="$SQL_CONNECTION_STRING" \
    AZURE_SQL_SERVER="$SQL_SERVER_NAME" \
    AZURE_SQL_DATABASE="$SQL_DATABASE_NAME" \
  --output none

echo "🚚 Packaging frontend + backend for deployment"
ZIP_FILE="deploy.zip"
rm -f "$ZIP_FILE"
zip -r "$ZIP_FILE" . -x ".git/*" "node_modules/*" "modules/*" "uploads/*" ".env" "*.zip"

echo "📦 Deploying ZIP package to Azure Web App"
az webapp deploy \
  --resource-group "$RESOURCE_GROUP" \
  --name "$WEB_APP_NAME" \
  --src-path "$ZIP_FILE" \
  --type zip \
  --output none

rm -f "$ZIP_FILE"

APP_URL="https://$WEB_APP_NAME.azurewebsites.net"

echo "\n══════════════ Deployment complete ══════════════"
echo "Web app URL: $APP_URL"
echo "Health check: $APP_URL/health"

echo "Deployment finished successfully."
