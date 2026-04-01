/**
 * Document Integrity System — Client Application
 * Handles file upload, API communication, and results rendering.
 */

(function () {
  "use strict";

  // ─── DOM References ───
  const $ = (sel) => document.querySelector(sel);
  const uploadZone = $("#upload-zone");
  const fileInput = $("#file-input");
  const browseBtn = $("#browse-btn");
  const fileInfo = $("#file-info");
  const fileName = $("#file-name");
  const fileSize = $("#file-size");
  const removeFileBtn = $("#remove-file");
  const analyzeBtn = $("#analyze-btn");
  const progressSection = $("#progress-section");
  const progressBar = $("#progress-bar");
  const resultsSection = $("#results-section");
  const tabsNav = $("#tabs-nav");

  let selectedFile = null;

  // ─── File Upload Handling ───
  browseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  uploadZone.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  // Drag & Drop
  uploadZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadZone.classList.add("dragging");
  });

  uploadZone.addEventListener("dragleave", () => {
    uploadZone.classList.remove("dragging");
  });

  uploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadZone.classList.remove("dragging");
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  removeFileBtn.addEventListener("click", () => {
    selectedFile = null;
    fileInput.value = "";
    fileInfo.classList.remove("visible");
    analyzeBtn.classList.remove("visible");
  });

  function handleFile(file) {
    if (file.type !== "application/pdf") {
      alert("Please upload a PDF file.");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      alert("File too large. Maximum size is 50MB.");
      return;
    }

    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    fileInfo.classList.add("visible");
    analyzeBtn.classList.add("visible");
  }

  function formatBytes(bytes) {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  // ─── Analyze Button ───
  analyzeBtn.addEventListener("click", async () => {
    if (!selectedFile) return;

    // Show progress, hide results
    analyzeBtn.disabled = true;
    analyzeBtn.innerHTML = '<span class="spinner"></span> Analyzing...';
    progressSection.classList.add("visible");
    resultsSection.classList.remove("visible");

    // Animated progress steps
    const steps = [
      "step-extract",
      "step-plagiarism",
      "step-grammar",
      "step-paraphrase",
    ];
    let currentStep = 0;

    function advanceStep() {
      if (currentStep > 0) {
        const previousStep = $(`#${steps[currentStep - 1]}`);
        if (previousStep) {
          previousStep.classList.remove("active");
          previousStep.classList.add("done");
          const icon = previousStep.querySelector(".progress-step__icon");
          if (icon) icon.textContent = "✓";
        }
      }

      if (currentStep >= steps.length) {
        return;
      }

      const currentElement = $(`#${steps[currentStep]}`);
      if (currentElement) {
        currentElement.classList.add("active");
      }
      progressBar.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
      currentStep++;
    }

    // Reset steps
    steps.forEach((s) => {
      $(`#${s}`).classList.remove("active", "done");
    });
    progressBar.style.width = "0%";

    // Animate steps with delays
    advanceStep(); // Extract
    const stepTimer = setInterval(() => {
      if (currentStep < steps.length) advanceStep();
    }, 1200);

    try {
      const formData = new FormData();
      formData.append("pdf", selectedFile);

      const response = await fetch("/analyze", {
        method: "POST",
        body: formData,
      });

      clearInterval(stepTimer);

      // Complete remaining steps
      while (currentStep < steps.length) advanceStep();
      progressBar.style.width = "100%";

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Analysis failed");
      }

      // Short delay before showing results
      await sleep(600);
      progressSection.classList.remove("visible");
      renderResults(data.results);
      resultsSection.classList.add("visible");
    } catch (err) {
      clearInterval(stepTimer);
      progressSection.classList.remove("visible");
      alert("Analysis failed: " + err.message);
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = "🚀 Analyze Document";
    }
  });

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ─── Results Rendering ───
  function renderResults(results) {
    renderSummaryCards(results);
    renderPlagiarismTab(results.plagiarism);
    renderGrammarTab(results.grammar);
    renderParaphraseTab(results.paraphrase);
    renderMetaInfo(results);
    initTabs();
  }

  function renderSummaryCards(r) {
    const grid = $("#summary-grid");
    const plagScore = r.plagiarism?.overallScore ?? 0;
    const gramScore = r.grammar?.qualityScore ?? 0;
    const paraScore = r.paraphrase?.qualityScore ?? 0;

    grid.innerHTML = `
      <div class="summary-card summary-card--plagiarism">
        <div class="summary-card__header">
          <span class="summary-card__label">Plagiarism</span>
          <span class="summary-card__icon">🔍</span>
        </div>
        <div class="summary-card__value">${plagScore}%</div>
        <div class="summary-card__status status-${r.plagiarism?.status || "clean"}">${formatStatus(r.plagiarism?.status)}</div>
      </div>
      <div class="summary-card summary-card--grammar">
        <div class="summary-card__header">
          <span class="summary-card__label">Grammar Quality</span>
          <span class="summary-card__icon">✏️</span>
        </div>
        <div class="summary-card__value">${gramScore}<span style="font-size:1rem;font-weight:500;color:var(--text-muted)">/100</span></div>
        <div class="summary-card__status status-${r.grammar?.status || "good"}">${formatStatus(r.grammar?.status)}</div>
      </div>
      <div class="summary-card summary-card--paraphrase">
        <div class="summary-card__header">
          <span class="summary-card__label">Paraphrase Diversity</span>
          <span class="summary-card__icon">🔄</span>
        </div>
        <div class="summary-card__value">${paraScore}%</div>
        <div class="summary-card__status status-${r.paraphrase?.status || "minimal"}">${formatStatus(r.paraphrase?.status)}</div>
      </div>
      <div class="summary-card summary-card--file">
        <div class="summary-card__header">
          <span class="summary-card__label">Document</span>
          <span class="summary-card__icon">📄</span>
        </div>
        <div class="summary-card__value">${r.pageCount || 0}<span style="font-size:1rem;font-weight:500;color:var(--text-muted)"> pages</span></div>
        <div class="summary-card__status" style="color:var(--text-muted)">${formatBytes(r.fileSize || 0)}</div>
      </div>
    `;
  }

  function renderPlagiarismTab(plag) {
    if (!plag) return;

    $("#plag-message").textContent = plag.message || "—";
    $("#plag-score").textContent = plag.overallScore || 0;

    // Animate score ring
    const ring = $("#plag-ring");
    const circumference = 2 * Math.PI * 50;
    const offset =
      circumference - (circumference * (plag.overallScore || 0)) / 100;
    setTimeout(() => {
      ring.style.strokeDashoffset = offset;
    }, 100);

    // Details
    $("#plag-details").innerHTML = `
      <div class="score-details__item"><span class="score-details__key">Total Sentences</span><span class="score-details__val">${plag.totalSentences || 0}</span></div>
      <div class="score-details__item"><span class="score-details__key">Flagged Sentences</span><span class="score-details__val" style="color:var(--color-error)">${plag.flaggedCount || 0}</span></div>
      <div class="score-details__item"><span class="score-details__key">Flagged %</span><span class="score-details__val">${plag.flaggedPercentage || 0}%</span></div>
      <div class="score-details__item"><span class="score-details__key">Threshold</span><span class="score-details__val">${plag.threshold || 35}%</span></div>
    `;

    // Sentences
    const container = $("#plag-sentences");
    const sentences = (plag.sentences || []).slice(0, 30);
    container.innerHTML = sentences
      .map(
        (s) => `
      <div class="sentence-item">
        <div class="sentence-item__header">
          <span class="sentence-item__num">Sentence ${s.index}</span>
          <span class="sentence-item__score sentence-item__score--${s.severity === "high" ? "high" : s.severity === "medium" ? "medium" : "low"}">
            ${s.similarity}% ${s.isFlagged ? "⚠️" : "✓"}
          </span>
        </div>
        <div class="sentence-item__text">${escapeHtml(s.text)}</div>
        ${s.matchedSource ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.4rem;">Match: ${escapeHtml(s.matchedSource)}</div>` : ""}
      </div>
    `,
      )
      .join("");
  }

  function renderGrammarTab(gram) {
    if (!gram) return;

    $("#gram-message").textContent = gram.message || "—";
    $("#gram-score").textContent = gram.qualityScore || 0;

    // Animate score ring
    const ring = $("#gram-ring");
    const circumference = 2 * Math.PI * 50;
    const offset =
      circumference - (circumference * (gram.qualityScore || 0)) / 100;
    setTimeout(() => {
      ring.style.strokeDashoffset = offset;
    }, 100);

    // Details
    $("#gram-details").innerHTML = `
      <div class="score-details__item"><span class="score-details__key">Total Errors</span><span class="score-details__val" style="color:var(--color-error)">${gram.totalErrors || 0}</span></div>
      <div class="score-details__item"><span class="score-details__key">Text Length</span><span class="score-details__val">${(gram.textLength || 0).toLocaleString()} chars</span></div>
      <div class="score-details__item"><span class="score-details__key">API Used</span><span class="score-details__val">${gram.apiUsed || "N/A"}</span></div>
      <div class="score-details__item"><span class="score-details__key">Issues Found</span><span class="score-details__val">${gram.totalIssuesFound || 0}</span></div>
    `;

    // Category bars
    const cats = gram.categories || {};
    const maxCat = Math.max(1, ...Object.values(cats));
    const catNames = {
      spelling: "Spelling",
      grammar: "Grammar",
      style: "Style",
      punctuation: "Punctuation",
      typography: "Typography",
      other: "Other",
    };

    $("#gram-categories").innerHTML = Object.entries(catNames)
      .map(([key, label]) => {
        const count = cats[key] || 0;
        const pct = (count / maxCat) * 100;
        return `
        <div class="category-bar">
          <span class="category-bar__label">${label}</span>
          <div class="category-bar__track">
            <div class="category-bar__fill category-bar__fill--${key}" style="width:${pct}%"></div>
          </div>
          <span class="category-bar__count">${count}</span>
        </div>
      `;
      })
      .join("");

    // Issues list
    const issues = (gram.issues || []).slice(0, 30);
    $("#gram-issues").innerHTML =
      issues.length === 0
        ? '<div style="text-align:center;color:var(--text-muted);padding:2rem;">🎉 No issues found! Great writing quality.</div>'
        : issues
            .map(
              (issue) => `
        <div class="issue-item">
          <div class="issue-item__severity issue-item__severity--${issue.severity || "suggestion"}"></div>
          <div class="issue-item__content">
            <div class="issue-item__message">${escapeHtml(issue.message)}</div>
            ${issue.context ? `<div class="issue-item__context">${escapeHtml(issue.context)}</div>` : ""}
            ${issue.replacements && issue.replacements.length > 0 ? `<div class="issue-item__replacements">💡 Suggestions: ${issue.replacements.map((r) => `<strong>${escapeHtml(r)}</strong>`).join(", ")}</div>` : ""}
          </div>
        </div>
      `,
            )
            .join("");
  }

  function renderParaphraseTab(para) {
    if (!para) return;

    $("#para-message").textContent = para.message || "—";
    $("#para-score").textContent = para.qualityScore || 0;

    // Animate score ring
    const ring = $("#para-ring");
    const circumference = 2 * Math.PI * 50;
    const offset =
      circumference - (circumference * (para.qualityScore || 0)) / 100;
    setTimeout(() => {
      ring.style.strokeDashoffset = offset;
    }, 100);

    // Details
    $("#para-details").innerHTML = `
      <div class="score-details__item"><span class="score-details__key">Sentences Changed</span><span class="score-details__val">${para.changedSentences || 0} / ${para.totalSentences || 0}</span></div>
      <div class="score-details__item"><span class="score-details__key">Changed %</span><span class="score-details__val">${para.changedPercentage || 0}%</span></div>
      <div class="score-details__item"><span class="score-details__key">Original Words</span><span class="score-details__val">${para.wordCount?.original || 0}</span></div>
      <div class="score-details__item"><span class="score-details__key">Paraphrased Words</span><span class="score-details__val">${para.wordCount?.paraphrased || 0}</span></div>
    `;

    // Sentence comparison
    const sentences = (para.sentences || []).slice(0, 20);
    $("#para-sentences").innerHTML = sentences
      .map(
        (s) => `
      <div class="sentence-item">
        <div class="sentence-item__header">
          <span class="sentence-item__num">Sentence ${s.index}</span>
          <span class="sentence-item__score sentence-item__score--${s.similarity > 80 ? "high" : s.similarity > 50 ? "medium" : "low"}">
            ${s.wasChanged ? "✏️ Changed" : "— Unchanged"} · ${s.similarity}% similar
          </span>
        </div>
        <span class="sentence-item__label sentence-item__label--original">Original</span>
        <div class="sentence-item__text sentence-item__text--original">${escapeHtml(s.original)}</div>
        <span class="sentence-item__label sentence-item__label--paraphrased">Paraphrased</span>
        <div class="sentence-item__text sentence-item__text--paraphrased">${escapeHtml(s.paraphrased)}</div>
      </div>
    `,
      )
      .join("");

    // Full paraphrased text
    const fullText = para.fullParaphrase || "";
    $("#para-full-text").textContent = fullText;

    // Copy button
    $("#copy-paraphrase").addEventListener("click", () => {
      navigator.clipboard.writeText(fullText).then(() => {
        const btn = $("#copy-paraphrase");
        btn.textContent = "✓ Copied!";
        setTimeout(() => {
          btn.textContent = "📋 Copy";
        }, 2000);
      });
    });
  }

  function renderMetaInfo(r) {
    $("#meta-info").innerHTML = `
      <div class="meta-item">
        <div class="meta-item__value">${r.filename || "—"}</div>
        <div class="meta-item__label">Filename</div>
      </div>
      <div class="meta-item">
        <div class="meta-item__value">${(r.analyzedCharacters || 0).toLocaleString()}</div>
        <div class="meta-item__label">Characters Analyzed</div>
      </div>
      <div class="meta-item">
        <div class="meta-item__value">${r.processingTimeMs || 0}ms</div>
        <div class="meta-item__label">Processing Time</div>
      </div>
      <div class="meta-item">
        <div class="meta-item__value">${r.reportId ? r.reportId.substring(0, 8) : "—"}</div>
        <div class="meta-item__label">Report ID</div>
      </div>
    `;
  }

  // ─── Tabs ───
  function initTabs() {
    const btns = tabsNav.querySelectorAll(".tabs__btn");
    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        btns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        document
          .querySelectorAll(".tabs__panel")
          .forEach((p) => p.classList.remove("active"));
        $(`#panel-${btn.dataset.tab}`).classList.add("active");
      });
    });
  }

  // ─── Helpers ───
  function formatStatus(status) {
    if (!status) return "—";
    return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function escapeHtml(str) {
    if (!str) return "";
    const el = document.createElement("span");
    el.textContent = str;
    return el.innerHTML;
  }
})();
