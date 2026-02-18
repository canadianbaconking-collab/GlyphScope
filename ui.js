/**
 * ui.js
 * Wires the Regex Explainer UI to the engine modules.
 * Includes performance guards and risk panel behavior.
 */

import { normalizePatternInput, FEATURES, assertOfflineProBuild } from "./contracts.js";
import { parsePattern } from "./parse.js";
import { explainPattern } from "./explain.js";
import { inferIntent } from "./intentmap.js";
import { executeRegex, DEFAULT_GUARD } from "./execute.js";
import { detectRisks } from "./risks.js";
import { estimateFalsePosNeg } from "./fpfnrules.js";

// --- State ---
let debounceTimer = null;

// --- DOM Elements ---
const dom = {
  inputPattern: document.getElementById("input-pattern"),
  inputSample: document.getElementById("input-sample"),
  btnRun: document.getElementById("btn-run"),
  
  // Flags
  flagG: document.getElementById("flag-g"),
  flagI: document.getElementById("flag-i"),
  flagM: document.getElementById("flag-m"),
  flagS: document.getElementById("flag-s"),
  flagU: document.getElementById("flag-u"),
  flagY: document.getElementById("flag-y"),

  // Outputs
  statusCompiled: document.getElementById("status-compiled"),
  statusMatches: document.getElementById("status-matches"),
  statusPerf: document.getElementById("status-perf"),
  
  outputExplanation: document.getElementById("output-explanation"),
  outputPreview: document.getElementById("output-preview"),
  outputWarnings: document.getElementById("output-warnings"),
  outputIntent: document.getElementById("output-intent"),

  // Overlays
  overlayRisks: document.getElementById("overlay-risks")
};

// --- Initialization ---
export function init() {
  assertOfflineProBuild();
  attachListeners();
  if (dom.inputPattern && dom.inputPattern.value) {
    runAnalysis();
  }
}

function attachListeners() {
  const inputs = [
    dom.inputPattern, dom.inputSample,
    dom.flagG, dom.flagI, dom.flagM, dom.flagS, dom.flagU, dom.flagY
  ];

  inputs.forEach(el => {
    if (el) {
      // Use 'input' for text fields, 'change' for checkboxes
      if (el.tagName === "INPUT" && (el.type === "text" || el.type === "textarea")) {
        el.addEventListener("input", handleInput);
      } else if (el.tagName === "TEXTAREA") {
        el.addEventListener("input", handleInput);
      } else if (el.tagName === "INPUT" && el.type === "checkbox") {
        el.addEventListener("change", handleInput);
      } else {
        // Fallback for buttons if passed here (not expected based on array above)
        el.addEventListener("click", handleInput);
      }
    }
  });

  if (dom.btnRun) {
    dom.btnRun.addEventListener("click", () => {
      clearTimeout(debounceTimer);
      runAnalysis();
    });
  }

}

function handleInput() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runAnalysis, 350);
}

// --- Main Analysis Pipeline ---
function runAnalysis() {
  const patternRaw = dom.inputPattern ? dom.inputPattern.value : "";
  const sampleText = dom.inputSample ? dom.inputSample.value : "";
  
  const flagsObj = getFlags();
  // Canonical flag order: gimsuy
  const flagsStr = ["g","i","m","s","u","y"].filter(k => flagsObj[k]).join("");
  
  const patternBody = normalizePatternInput(patternRaw);

  resetOutputs();

  // 1. Parse (Always runs)
  const parseResult = parsePattern(patternBody, flagsStr);
  
  if (!parseResult.ok) {
    renderError(parseResult.error);
    return;
  }
  
  const ast = parseResult.ast;
  renderStatus("Compiled OK", "success");

  // 2. Intent (Always runs)
  const intent = inferIntent(ast, flagsObj);
  renderIntent(intent);

  // 3. Explain (Always runs)
  const explanation = explainPattern(ast, flagsStr);
  renderExplanation(explanation);

  // 4. Execution (Preview)
  let matchRecords = [];
  
  if (sampleText.length > 0) {
    const execResult = executeRegex(patternBody, flagsStr, sampleText, DEFAULT_GUARD);
    matchRecords = execResult.matches || [];
    renderMatches(matchRecords, sampleText);
    
    if (matchRecords.length > 0) {
      if (dom.statusMatches) {
        dom.statusMatches.textContent = `Matches ${matchRecords.length}`;
        dom.statusMatches.className = "pill success";
      }
    } else {
      if (dom.statusMatches) {
        dom.statusMatches.textContent = "No matches";
        dom.statusMatches.className = "pill neutral";
      }
    }
  } else {
    // No sample text -> No execution
    if (dom.statusMatches) {
      dom.statusMatches.textContent = "No sample";
      dom.statusMatches.className = "pill hidden";
    }
    if (dom.outputPreview) {
      dom.outputPreview.innerHTML = "<span class='placeholder'>Enter sample text to see matches...</span>";
    }
  }

  // 5. Advanced analysis (offline pro build: enabled)
  if (dom.overlayRisks) dom.overlayRisks.style.display = "none";
  renderAdvancedAnalysis(ast, flagsObj, patternBody, flagsStr, sampleText, matchRecords);
}

// --- Helpers ---

function getFlags() {
  return {
    g: dom.flagG ? dom.flagG.checked : false,
    i: dom.flagI ? dom.flagI.checked : false,
    m: dom.flagM ? dom.flagM.checked : false,
    s: dom.flagS ? dom.flagS.checked : false,
    u: dom.flagU ? dom.flagU.checked : false,
    y: dom.flagY ? dom.flagY.checked : false,
  };
}

function resetOutputs() {
  if (dom.outputExplanation) dom.outputExplanation.innerHTML = "";
  if (dom.outputPreview) dom.outputPreview.innerHTML = "";
  if (dom.outputWarnings) dom.outputWarnings.innerHTML = "";
  if (dom.outputIntent) dom.outputIntent.innerHTML = "";
  if (dom.statusCompiled) {
    dom.statusCompiled.textContent = "Waiting...";
    dom.statusCompiled.className = "pill neutral";
  }
  if (dom.statusMatches) dom.statusMatches.className = "pill hidden";
}

function renderStatus(msg, type) {
  if (!dom.statusCompiled) return;
  dom.statusCompiled.textContent = msg;
  dom.statusCompiled.className = `pill ${type}`;
}

function renderError(err) {
  renderStatus("Error", "error");
  if (dom.outputExplanation) {
    dom.outputExplanation.innerHTML = `<div class="error-msg">Parse Error: ${escapeHtml(err.message)}</div>`;
  }
}

function renderExplanation(exp) {
  if (!dom.outputExplanation) return;
  
  let html = `<div class="exp-section"><strong>Summary:</strong><ul>`;
  exp.summary.forEach(s => html += `<li>${escapeHtml(s)}</li>`);
  html += `</ul></div>`;

  html += `<div class="exp-section"><strong>Components:</strong><ul>`;
  exp.components.forEach(c => html += `<li>${escapeHtml(c)}</li>`);
  html += `</ul></div>`;

  if (exp.constraints.length) {
    html += `<div class="exp-section"><strong>Constraints:</strong><ul>`;
    exp.constraints.forEach(c => html += `<li>${escapeHtml(c)}</li>`);
    html += `</ul></div>`;
  }
  dom.outputExplanation.innerHTML = html;
}

function renderIntent(intent) {
  if (!dom.outputIntent) return;
  if (!intent || !intent.label) return;
  let html = `<h4>${escapeHtml(intent.label)}</h4>`;
  if (intent.rationale && intent.rationale.length) {
    html += `<p>${intent.rationale.map(escapeHtml).join(". ")}</p>`;
  }
  dom.outputIntent.innerHTML = html;
}

function renderMatches(matches, originalText) {
  if (!dom.outputPreview) return;
  
  const renderLimit = 200; 
  const displayMatches = matches.slice(0, renderLimit);
  
  let html = "";
  let lastIdx = 0;

  displayMatches.forEach(m => {
    const start = Math.max(0, m.inputSpan.start);
    const end = Math.min(originalText.length, m.inputSpan.end);
    
    if (start >= lastIdx) {
      html += escapeHtml(originalText.slice(lastIdx, start));
      html += `<span class="highlight">${escapeHtml(originalText.slice(start, end))}</span>`;
      lastIdx = end;
    }
  });
  
  html += escapeHtml(originalText.slice(lastIdx));
  
  if (matches.length > renderLimit) {
    html += `<div class="limit-msg">... ${matches.length - renderLimit} more matches hidden.</div>`;
  }
  
  dom.outputPreview.innerHTML = html;
}

function renderRisksAndFpFn(risks, fpfnItems) {
  if (!dom.outputWarnings) return;
  
  if (risks.length === 0 && fpfnItems.length === 0) {
    dom.outputWarnings.innerHTML = "<div class='safe-msg'>No obvious risks detected.</div>";
    return;
  }

  let html = "";
  
  risks.forEach(r => {
    html += `<div class="warning-card ${r.severity}">
      <strong>${escapeHtml(r.title)}</strong>
      <p>${escapeHtml(r.message)}</p>
    </div>`;
  });

  if (fpfnItems.length > 0) {
    html += `<div class="warning-card info"><strong>Heuristic Edge Cases</strong><ul>`;
    fpfnItems.slice(0, 5).forEach(item => {
      html += `<li>${escapeHtml(item.text)}: ${escapeHtml(item.reason)}</li>`;
    });
    html += `</ul></div>`;
  }

  dom.outputWarnings.innerHTML = html;
}

function renderAdvancedAnalysis(ast, flagsObj, patternBody, flagsStr, sampleText, matchRecords) {
  const risks = FEATURES.securityRisks
    ? detectRisks(ast, flagsObj, sampleText, { pattern: patternBody })
    : [];

  let fpfnItems = [];
  if (FEATURES.falsePositiveNegative && sampleText.length > 0 && matchRecords.length > 0) {
    const fpfn = estimateFalsePosNeg({
      ast,
      pattern: patternBody,
      flagsStr,
      sampleText,
      matches: matchRecords,
    });
    fpfnItems = [
      ...(fpfn.likelyFalsePositives || []).map((x) => ({ text: `Likely false positive: ${x.text}`, reason: x.reason })),
      ...(fpfn.likelyFalseNegatives || []).map((x) => ({ text: `Likely false negative: ${x.text}`, reason: x.reason })),
    ];
  }

  renderRisksAndFpFn(risks, fpfnItems);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
