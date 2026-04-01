#!/bin/bash
# ═══════════════════════════════════════════════════════
# Document Integrity System — Azure Deployment Script
# ═══════════════════════════════════════════════════════

set -e

# Configuration
RESOURCE_GROUP="rg-document-integrity"
LOCATION="centralindia"
APP_SERVICE_PLAN="plan-document-integrity"
WEB_APP_NAME="document-integrity-$(date +%s)"
SKU="F1"
NODE_VERSION="20-lts"

echo "╔══════════════════════════════════════════════════╗"
echo "║  🚀 Deploying Document Integrity System         ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Step 1: Login check
echo "📋 Checking Azure CLI login..."
az account show > /dev/null 2>&1 || {
    echo "⚠️  Not logged in. Running 'az login'..."
    az login
}

# Step 2: Create Resource Group
echo "📦 Creating Resource Group: $RESOURCE_GROUP"
az group create \
    --name $RESOURCE_GROUP \
    --location $LOCATION \
    --output none

# Step 3: Create App Service Plan
echo "📐 Creating App Service Plan: $APP_SERVICE_PLAN ($SKU)"
az appservice plan create \
    --name $APP_SERVICE_PLAN \
    --resource-group $RESOURCE_GROUP \
    --sku $SKU \
    --is-linux \
    --output none

# Step 4: Create Web App
echo "🌐 Creating Web App: $WEB_APP_NAME"
az webapp create \
    --name $WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --plan $APP_SERVICE_PLAN \
    --runtime "NODE:$NODE_VERSION" \
    --output none

# Step 5: Configure startup
echo "⚙️  Configuring Node.js startup..."
az webapp config set \
    --name $WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --startup-file "node backend/app.js" \
    --output none

# Step 6: Set environment variables
echo "🔐 Setting environment variables..."
az webapp config appsettings set \
    --name $WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --settings \
        NODE_ENV=production \
        PORT=8080 \
        WEBSITE_NODE_DEFAULT_VERSION=~20 \
    --output none

# Step 7: Enable health check
echo "❤️  Enabling health check..."
az webapp config set \
    --name $WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --generic-configurations '{"healthCheckPath":"/health"}' \
    --output none

# Step 8: Deploy from local directory
echo "📤 Deploying application code..."
cd "$(dirname "$0")/.."
zip -r deploy.zip . \
    -x ".git/*" \
    -x "node_modules/*" \
    -x "modules/*" \
    -x "uploads/*" \
    -x ".env" \
    -x "*.zip"

az webapp deploy \
    --name $WEB_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --src-path deploy.zip \
    --type zip

# Cleanup
rm -f deploy.zip

# Step 9: Open in browser
APP_URL="https://${WEB_APP_NAME}.azurewebsites.net"
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✅ Deployment Complete!                        ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  🌐 URL: $APP_URL"
echo "║  📊 Health: ${APP_URL}/health"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "Opening in browser..."
az webapp browse --name $WEB_APP_NAME --resource-group $RESOURCE_GROUP
