# Document Integrity App

## Project Overview

This project is a Node.js-based document integrity system that analyzes uploaded PDF files. It performs:

- PDF text extraction
- plagiarism analysis
- grammar checking
- paraphrasing

The app serves a frontend from `public/` and provides an API in `app.js`.

## What We Did

1. Reviewed and cleaned the repository.
2. Fixed deployment automation for Azure using a PowerShell script (`deploy.ps1`).
3. Added Azure provider registration to avoid missing provider errors.
4. Added SQL firewall rules so App Service and local IP can access Azure SQL.
5. Added safe handling for Application Insights creation failures.
6. Fixed Azure health check configuration formatting.
7. Ensured zip packaging works on Windows PowerShell.

## Project Components

### `app.js`

Main Express server that:

- accepts PDF uploads through `/analyze`
- extracts text using `pdf-parse`
- runs analysis services in parallel
- returns a JSON result with plagiarism, grammar, and paraphrase reports
- exposes a `/health` endpoint for health checks

### `services/grammar-service.js`

Performs grammar and spelling analysis. Uses LanguageTool via HTTP API and a fallback regex-based checker.

### `services/paraphrase-service.js`

Generates paraphrased versions of text using synonyms, phrase replacements, and grammar corrections.

### `services/plagiarism-service.js`

Performs a basic plagiarism check using text similarity methods.

### `public/`

Contains frontend files for uploading PDFs and displaying results.

## Azure Services Used

### Azure App Service

- Hosts the Node.js application.
- Runs the API and frontend.
- Managed compute for serving requests.
- Configured with startup command `node app.js`.

### Azure Storage Blob

- Used for PDF upload storage.
- Stores raw PDF files in a container named `pdf-uploads`.
- Provides durable object storage for documents.

### Azure Service Bus (Basic)

- Used as a queueing layer for document analysis tasks.
- Basic tier works for simple message-based workflows.
- In future, can support async processing and scaling across workers.

### Azure SQL Database (Basic)

- Used for application data persistence.
- Stores metadata, analysis results, or user activity.
- Basic tier is used in this deployment.

### Azure Monitor / Application Insights

- Used for telemetry and monitoring.
- Tracks app health, errors, and performance.
- In this project, it is optional and safely skipped if unavailable.

## Deployment Script (`deploy.ps1`)

The PowerShell deploy script does the following:

1. Logs into Azure if needed.
2. Registers required providers:
   - `Microsoft.Web`
   - `Microsoft.OperationalInsights`
   - `Microsoft.Insights`
3. Creates or reuses a resource group.
4. Creates Storage Account and Blob Container.
5. Creates Service Bus namespace and queue.
6. Creates SQL Server and Basic SQL Database.
7. Adds SQL firewall rules for Azure services and local client IP.
8. Creates App Service plan and Web App.
9. Attempts to create Application Insights if supported.
10. Configures App Service app settings with connection strings.
11. Sets startup command and health check.
12. Packages the app and deploys it as a ZIP.

## How to Run Deployment

From PowerShell inside `E:\MADE IN VS\document-integrity-app`:

```powershell
az login
powershell -ExecutionPolicy Bypass -File ".\deploy.ps1" -Subscription "420177a0-18b0-4eee-b0f1-e2a2d80a8171" -Location "centralindia"
```

If you want to reset everything before a re-run, delete the resource group first:

```powershell
az group delete --name rg-document-integrity --yes --no-wait
```

## Important Notes

- The App Service plan is currently `B1`, which does not support autoscaling.
- Application Insights may fail to create on some subscriptions; the script handles this gracefully.
- Service Bus Basic is sufficient for simple workloads, but Standard/Premium is recommended for production.
- SQL firewall rules allow Azure services and the local client IP, but additional configuration may be needed for other networks.

## Final Status

This project is ready for Azure deployment with a working Node.js backend, PDF processing features, and support for Azure-managed resources. The deployment script now includes provider registration, health checks, and compatibility measures for Windows PowerShell.
