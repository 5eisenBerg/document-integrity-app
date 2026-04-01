console.log(
  "🚀 PRODUCTION: Document Integrity API v1.0 - Azure App Service Live",
);

require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env"),
});

const { BlobServiceClient } = require("@azure/storage-blob");
const express = require("express");
const multer = require("multer");
const pdfParseModule = require("pdf-parse");
const path = require("path");
const cors = require("cors");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const isPdfParseClass =
  typeof pdfParseModule === "function" &&
  pdfParseModule.prototype &&
  typeof pdfParseModule.prototype.load === "function";
const pdfParserFactory = isPdfParseClass
  ? pdfParseModule
  : pdfParseModule.PDFParse || pdfParseModule.default || pdfParseModule;

async function parsePdfBuffer(buffer) {
  if (
    typeof pdfParserFactory === "function" &&
    !(
      pdfParserFactory.prototype &&
      typeof pdfParserFactory.prototype.load === "function"
    )
  ) {
    const result = await pdfParserFactory(buffer);
    return {
      text: result?.text || result,
      numpages: result?.numpages || result?.numPages || 0,
    };
  }

  const parser = new pdfParserFactory({ data: buffer });
  await parser.load();
  const result = await parser.getText();
  return {
    text: result?.text || result,
    numpages: parser.doc?.numPages || result?.total || 0,
  };
}

// Import analysis services
const { analyzePlagiarism } = require("./services/plagiarism-service");
const { analyzeGrammar } = require("./services/grammar-service");
const { analyzeParaphrase } = require("./services/paraphrase-service");

const app = express();
const PORT = process.env.PORT || 3000;

const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.AZURE_STORAGE_CONNECTION_STRING,
);

const containerClient = blobServiceClient.getContainerClient(
  process.env.AZURE_STORAGE_CONTAINER_NAME,
);

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, "../frontend")));

// Use memory storage so we get req.file.buffer (fixes the original bug)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"), false);
    }
  },
});

// Store analysis results by ID for later retrieval
const analysisResults = new Map();

// ──────────────────────────────────────────────
// Health Check Endpoint (for Azure App Service)
// ──────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: "1.0.0",
  });
});

// ──────────────────────────────────────────────
// Main Analysis Endpoint
// ──────────────────────────────────────────────
app.post("/analyze", upload.single("pdf"), async (req, res) => {
  const startTime = Date.now();

  try {
    // Validate file
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error:
          'No PDF file uploaded. Please attach a PDF file with field name "pdf".',
      });
    }

    console.log(
      `📄 Analyzing: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)}KB)`,
    );

    const blobName = `${uuidv4()}-${req.file.originalname}`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    await blockBlobClient.uploadData(req.file.buffer, {
      blobHTTPHeaders: {
        blobContentType: req.file.mimetype,
      },
    });

    console.log("Uploaded to Azure Blob:", blobName);

    // Extract text from PDF
    const data = await parsePdfBuffer(req.file.buffer);
    const text = data.text;

    if (!text || text.trim().length < 10) {
      return res.status(400).json({
        success: false,
        error:
          "Could not extract text from PDF. The file may be image-based or corrupted.",
      });
    }

    // Truncate to first 10K chars for API limits and performance
    const analysisText = text.substring(0, 10000);
    const totalChars = text.length;

    console.log(
      `📝 Extracted ${totalChars} chars, analyzing first ${analysisText.length} chars...`,
    );

    // Run all 3 analyses in parallel
    const [plagiarismResult, grammarResult, paraphraseResult] =
      await Promise.allSettled([
        analyzePlagiarism(analysisText),
        analyzeGrammar(analysisText),
        analyzeParaphrase(analysisText),
      ]);

    const processingTime = Date.now() - startTime;
    const reportId = uuidv4();

    const results = {
      reportId,
      filename: req.file.originalname,
      fileSize: req.file.size,
      totalCharacters: totalChars,
      analyzedCharacters: analysisText.length,
      pageCount: data.numpages || 0,
      processingTimeMs: processingTime,
      timestamp: new Date().toISOString(),
      textPreview: analysisText.substring(0, 500),

      plagiarism:
        plagiarismResult.status === "fulfilled"
          ? plagiarismResult.value
          : {
              overallScore: 0,
              status: "error",
              message: plagiarismResult.reason?.message || "Analysis failed",
            },

      grammar:
        grammarResult.status === "fulfilled"
          ? grammarResult.value
          : {
              qualityScore: 0,
              status: "error",
              message: grammarResult.reason?.message || "Analysis failed",
            },

      paraphrase:
        paraphraseResult.status === "fulfilled"
          ? paraphraseResult.value
          : {
              qualityScore: 0,
              status: "error",
              message: paraphraseResult.reason?.message || "Analysis failed",
            },
    };

    // Cache result for report retrieval
    analysisResults.set(reportId, results);

    // Clean old results (keep last 100)
    if (analysisResults.size > 100) {
      const oldestKey = analysisResults.keys().next().value;
      analysisResults.delete(oldestKey);
    }

    console.log(
      `✅ Analysis complete in ${processingTime}ms | Plagiarism: ${results.plagiarism.overallScore}% | Grammar: ${results.grammar.qualityScore}/100 | Paraphrase diversity: ${results.paraphrase.qualityScore}%`,
    );

    res.json({ success: true, results });
  } catch (err) {
    console.error("❌ Analysis error:", err);
    res.status(500).json({
      success: false,
      error: err.message,
      hint: "Make sure you uploaded a valid PDF file.",
    });
  }
});

// ──────────────────────────────────────────────
// Report Retrieval Endpoint
// ──────────────────────────────────────────────
app.get("/api/report/:id", (req, res) => {
  const report = analysisResults.get(req.params.id);
  if (!report) {
    return res
      .status(404)
      .json({ success: false, error: "Report not found or expired" });
  }
  res.json({ success: true, results: report });
});

// ──────────────────────────────────────────────
// API Info Endpoint
// ──────────────────────────────────────────────
app.get("/api/info", (req, res) => {
  res.json({
    name: "Document Integrity API",
    version: "1.0.0",
    services: ["plagiarism", "grammar", "paraphrase"],
    maxFileSize: "50MB",
    supportedFormats: ["PDF"],
    endpoints: {
      analyze: 'POST /analyze (multipart/form-data, field: "pdf")',
      health: "GET /health",
      report: "GET /api/report/:id",
      info: "GET /api/info",
    },
  });
});

// ──────────────────────────────────────────────
// Default route → serve frontend
// ──────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend", "index.html"));
});

// ──────────────────────────────────────────────
// Error handling middleware
// ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        error: "File too large. Maximum size is 50MB.",
      });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err.message === "Only PDF files are allowed") {
    return res.status(400).json({ success: false, error: err.message });
  }
  console.error("Server error:", err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

// ──────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║     🔒 Document Integrity System v1.0.0         ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  🌐 Server:    http://localhost:${PORT}              ║`);
  console.log(
    "║  📊 Health:    http://localhost:" + PORT + "/health         ║",
  );
  console.log(
    "║  ℹ️  API Info:  http://localhost:" + PORT + "/api/info      ║",
  );
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║  Services:                                      ║");
  console.log("║    🔍 Plagiarism Detection (TF-IDF + Cosine)    ║");
  console.log("║    ✏️  Grammar Checking (LanguageTool API)       ║");
  console.log("║    🔄 Paraphrasing (NLP Synonym Engine)         ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log("");
});

module.exports = app;
