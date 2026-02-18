// risks.js
// Regex Explainer — Conservative risk detection (v1.0 LOCKED, corrected)
// Plain JS ES module. Deterministic. No certainty claims.

import { flagsToString } from "./contracts.js";

/**
 * @typedef {import("./contracts.js").Flags} Flags
 * @typedef {import("./contracts.js").Warning} Warning
 * @typedef {import("./contracts.js").TextSpan} TextSpan
 */

export const RISK = {
  POTENTIAL_BACKTRACKING: "RISK_POTENTIAL_BACKTRACKING",
  NESTED_QUANTIFIERS: "RISK_NESTED_QUANTIFIERS",
  AMBIGUOUS_WILDCARD: "RISK_AMBIGUOUS_WILDCARD",
  UNANCHORED_MISMATCH: "RISK_UNANCHORED_MISMATCH", // corrected: only ^ XOR $
  DOTALL_EXPECTED: "RISK_DOTALL_EXPECTED",
  MULTILINE_ANCHOR_CONFUSION: "RISK_MULTILINE_ANCHOR_CONFUSION",
  EMPTY_ALTERNATION: "RISK_EMPTY_ALTERNATION",
  OVERBROAD_CLASS: "RISK_OVERBROAD_CLASS",
  REDUNDANT_QUANTIFIERS: "RISK_REDUNDANT_QUANTIFIERS",
  LOOKAROUND_COMPLEXITY: "RISK_LOOKAROUND_COMPLEXITY",
  STICKY_WITH_GLOBAL: "RISK_STICKY_WITH_GLOBAL",
  UNICODE_FLAG_MISMATCH: "RISK_UNICODE_FLAG_MISMATCH",
};

const T = {
  potentialBacktrackingTitle: "Potential performance risk",
  potentialBacktrackingMsg:
    "This pattern can take a long time on certain inputs (especially long non-matching strings). Treat this as a potential risk, not a guarantee.",

  nestedQuantifiersTitle: "Nested quantifiers",
  nestedQuantifiersMsg:
    "A quantified group contains another quantifier (example: (a+)+). This is a common cause of catastrophic backtracking.",

  ambiguousWildcardTitle: "Greedy wildcard may be too broad",
  ambiguousWildcardMsg:
    "A greedy wildcard like .* or .+ can swallow more than intended. Consider anchoring or narrowing the match.",

  unanchoredMismatchTitle: "Anchoring looks incomplete",
  unanchoredMismatchMsg:
    "This pattern has only one anchor (^ or $). If you intended a full-string match, you usually want both.",

  dotallExpectedTitle: "Dot does not match newlines",
  dotallExpectedMsg:
    "Your sample contains newlines, but '.' will stop at newline unless the 's' flag is set.",

  multilineAnchorConfusionTitle: "Multiline anchoring can surprise you",
  multilineAnchorConfusionMsg:
    "With the 'm' flag, ^ and $ match line boundaries, not just start/end of the whole text.",

  emptyAltTitle: "Empty alternative",
  emptyAltMsg:
    "An alternation contains an empty branch (example: a|). This may match unexpectedly.",

  overbroadClassTitle: "Over-broad character class",
  overbroadClassMsg:
    "A character class like [\\s\\S] or [\\d\\D] matches almost everything. That can be correct, but it often hides mistakes.",

  redundantQuantTitle: "Redundant quantifier",
  redundantQuantMsg:
    "Quantifiers like {0,} or {1,} are equivalent to * or +. This can reduce readability.",

  lookaroundComplexTitle: "Lookarounds increase complexity",
  lookaroundComplexMsg:
    "Lookaheads/lookbehinds can be correct, but they make the regex harder to reason about. Double-check edge cases.",

  stickyWithGlobalTitle: "Sticky + global flags",
  stickyWithGlobalMsg:
    "Using both 'y' (sticky) and 'g' (global) is unusual. Make sure you intended sticky matching behavior.",

  unicodeFlagMismatchTitle: "Unicode-related behavior",
  unicodeFlagMismatchMsg:
    "Unicode escapes/properties can behave differently depending on the 'u' flag. Verify the flag matches your intent.",
};

// ---------- AST walk helpers (regexpp) ----------
function walk(node, fn, seen = new WeakSet()) {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  fn(node);
  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn, seen));
    else if (v && typeof v === "object") walk(v, fn, seen);
  }
}

function spanOf(node) {
  const start = typeof node?.start === "number" ? node.start : undefined;
  const end = typeof node?.end === "number" ? node.end : undefined;
  if (start == null || end == null) return undefined;
  return { start, end };
}

function isDot(n) {
  return n?.type === "CharacterSet" && n?.kind === "dot";
}

function isGreedyDotQuantified(node) {
  const el = node?.element ?? node;
  const q = node?.quantifier ?? null;
  if (!q) return false;
  if (!isDot(el)) return false;
  const greedy = q.greedy !== false;
  const min = typeof q.min === "number" ? q.min : 1;
  const max = q.max == null ? Infinity : q.max;
  const expands = max === Infinity || max > min;
  return greedy && expands;
}

function detectNestedQuantifiers(ast) {
  const spans = [];
  walk(ast, (n) => {
    const hasQuant = n?.quantifier != null || n?.type === "Quantifier";
    if (!hasQuant) return;
    const target = n?.element ?? n?.target ?? null;
    if (!target) return;

    let innerHasQuant = false;
    walk(target, (inner) => {
      if (inner !== n && (inner?.quantifier != null || inner?.type === "Quantifier")) innerHasQuant = true;
    });

    if (innerHasQuant) {
      const s = spanOf(n) || spanOf(target);
      if (s) spans.push(s);
    }
  });
  return spans.length ? spans : null;
}

function detectObviousBacktrackingShapes(ast) {
  const spans = [];
  walk(ast, (n) => {
    const q = n?.quantifier;
    const target = n?.element ?? null;
    if (!q || !target) return;

    const greedy = q.greedy !== false;
    const maxInf = q.max == null;
    if (!(greedy && maxInf)) return;

    let innerDotQ = false;
    let innerAlt = false;
    let innerQuant = false;

    walk(target, (inner) => {
      if (inner?.type === "AlternationExpression" || inner?.type === "Alternative") innerAlt = true;
      if (isGreedyDotQuantified(inner)) innerDotQ = true;
      if (inner !== n && (inner?.quantifier != null || inner?.type === "Quantifier")) innerQuant = true;
    });

    if (innerDotQ || (innerAlt && innerQuant)) {
      const s = spanOf(n) || spanOf(target);
      if (s) spans.push(s);
    }
  });
  return spans.length ? spans : null;
}

function detectAnchors(ast) {
  let hasStart = false;
  let hasEnd = false;
  walk(ast, (n) => {
    if (n?.type === "Assertion" && n?.kind === "start") hasStart = true;
    if (n?.type === "Assertion" && n?.kind === "end") hasEnd = true;
  });
  return { hasStart, hasEnd };
}

function detectEmptyAlternation(ast) {
  const spans = [];
  walk(ast, (n) => {
    if (n?.type === "Alternative" && Array.isArray(n.elements) && n.elements.length === 0) {
      const s = spanOf(n);
      if (s) spans.push(s);
    }
  });
  return spans.length ? spans : null;
}

function detectOverbroadClass(ast) {
  const spans = [];
  walk(ast, (n) => {
    if (n?.type !== "CharacterClass") return;
    const raw = n?.raw;
    if (raw && (raw.includes("\\s\\S") || raw.includes("\\d\\D") || raw.includes("\\w\\W"))) {
      const s = spanOf(n);
      if (s) spans.push(s);
    }
  });
  return spans.length ? spans : null;
}

function detectRedundantQuantifiers(ast) {
  const spans = [];
  walk(ast, (n) => {
    const q = n?.quantifier ?? (n?.type === "Quantifier" ? n : null);
    if (!q) return;
    const min = q.min;
    const max = q.max;
    if (min === 0 && max == null) spans.push(spanOf(n)).filter(Boolean);
    if (min === 1 && max == null) spans.push(spanOf(n)).filter(Boolean);
    if (min === 0 && max === 1) spans.push(spanOf(n)).filter(Boolean);
  });
  return spans.length ? spans.filter(Boolean) : null;
}

function detectLookarounds(ast) {
  const spans = [];
  walk(ast, (n) => {
    if (n?.type === "Assertion" && (n.kind === "lookahead" || n.kind === "lookbehind")) {
      const s = spanOf(n);
      if (s) spans.push(s);
    }
  });
  return spans.length ? spans : null;
}

function detectMultilineAnchorConfusion(flags, hasAnchors) {
  return !!flags.m && hasAnchors;
}

function detectDotallExpected(ast, flags, sampleText) {
  if (flags.s) return false;
  if (!sampleText || sampleText.indexOf("\n") === -1) return false;
  let usesDot = false;
  walk(ast, (n) => { if (isDot(n)) usesDot = true; });
  return usesDot;
}

function detectStickyWithGlobal(flags) {
  return !!flags.y && !!flags.g;
}

function detectUnicodeFlagMismatch(ast, flags) {
  let hasUnicodeProps = false;
  let hasUnicodeCodepoint = false;
  walk(ast, (n) => {
    const raw = n?.raw;
    if (!raw) return;
    if (raw.includes("\\p{") || raw.includes("\\P{")) hasUnicodeProps = true;
    if (raw.includes("\\u{")) hasUnicodeCodepoint = true;
  });
  return !flags.u && (hasUnicodeProps || hasUnicodeCodepoint);
}

// ---------- Optional dynamic probe (still "potential") ----------
// Only run when static risk has already been flagged, to avoid needless cost.
// This does NOT "prove safety"; it only strengthens the warning if it looks slow.
function dynamicBacktrackingProbe(pattern, flags) {
  // Keep tiny and safe.
  // Use a known adversarial-ish string (long run + non-match tail).
  const test = "a".repeat(28) + "X";
  const start = performance?.now ? performance.now() : Date.now();

  let re;
  try {
    // Remove global for probing
    const f = flags.replace("g", "");
    re = new RegExp(pattern, f);
  } catch {
    return null;
  }

  try {
    re.test(test);
  } catch {
    return null;
  }

  const end = performance?.now ? performance.now() : Date.now();
  const ms = end - start;

  // Conservative thresholds
  if (ms > 40) {
    return { ms, note: `Slow probe: ${Math.round(ms)}ms on a short non-match test.` };
  }
  return null;
}

/**
 * Main risk detector.
 * @param {any} ast regexpp AST
 * @param {Flags} flags
 * @param {string=} sampleText
 * @param {{pattern?:string}=} ctx optional pattern string for dynamic probe
 * @returns {Warning[]}
 */
export function detectRisks(ast, flags, sampleText, ctx) {
  /** @type {Warning[]} */
  const warnings = [];

  const { hasStart, hasEnd } = detectAnchors(ast);
  const isExtractionMode = !!flags.g;

  // 1) Nested quantifiers (high)
  const nested = detectNestedQuantifiers(ast);
  if (nested) {
    warnings.push({
      id: RISK.NESTED_QUANTIFIERS,
      severity: "high",
      title: T.nestedQuantifiersTitle,
      message: T.nestedQuantifiersMsg,
      evidence: { patternSpans: nested },
    });
  }

  // 2) Obvious backtracking shapes (medium/high)
  const backShapes = detectObviousBacktrackingShapes(ast);
  if (backShapes) {
    /** @type {string[]} */
    const examples = [];
    // Optional dynamic probe strengthens message (still "potential")
    if (ctx?.pattern) {
      const probe = dynamicBacktrackingProbe(ctx.pattern, flagsToString(flags));
      if (probe) examples.push(probe.note);
    }
    warnings.push({
      id: RISK.POTENTIAL_BACKTRACKING,
      severity: nested ? "high" : "medium",
      title: T.potentialBacktrackingTitle,
      message: T.potentialBacktrackingMsg,
      evidence: { patternSpans: backShapes, examples: examples.length ? examples : undefined },
    });
  }

  // 3) Greedy dot quantified (broadness)
  const dotSpans = [];
  walk(ast, (n) => {
    if (isGreedyDotQuantified(n)) {
      const s = spanOf(n);
      if (s) dotSpans.push(s);
    }
  });
  if (dotSpans.length) {
    warnings.push({
      id: RISK.AMBIGUOUS_WILDCARD,
      severity: "medium",
      title: T.ambiguousWildcardTitle,
      message: T.ambiguousWildcardMsg,
      evidence: { patternSpans: dotSpans },
    });
  }

  // 4) Anchoring mismatch (corrected)
  // Only warn when exactly one anchor is present, and only when NOT in extraction mode.
  if (!isExtractionMode && (hasStart !== hasEnd)) {
    warnings.push({
      id: RISK.UNANCHORED_MISMATCH,
      severity: "low",
      title: T.unanchoredMismatchTitle,
      message: T.unanchoredMismatchMsg,
      evidence: { patternSpans: spanOf(ast) ? [spanOf(ast)] : undefined },
    });
  }

  // 5) Dotall expected (sample-dependent)
  if (detectDotallExpected(ast, flags, sampleText)) {
    warnings.push({
      id: RISK.DOTALL_EXPECTED,
      severity: "low",
      title: T.dotallExpectedTitle,
      message: T.dotallExpectedMsg,
    });
  }

  // 6) Multiline anchor confusion
  if (detectMultilineAnchorConfusion(flags, hasStart || hasEnd)) {
    warnings.push({
      id: RISK.MULTILINE_ANCHOR_CONFUSION,
      severity: "info",
      title: T.multilineAnchorConfusionTitle,
      message: T.multilineAnchorConfusionMsg,
    });
  }

  // 7) Empty alternation
  const emptyAlt = detectEmptyAlternation(ast);
  if (emptyAlt) {
    warnings.push({
      id: RISK.EMPTY_ALTERNATION,
      severity: "medium",
      title: T.emptyAltTitle,
      message: T.emptyAltMsg,
      evidence: { patternSpans: emptyAlt },
    });
  }

  // 8) Overbroad class
  const overbroad = detectOverbroadClass(ast);
  if (overbroad) {
    warnings.push({
      id: RISK.OVERBROAD_CLASS,
      severity: "info",
      title: T.overbroadClassTitle,
      message: T.overbroadClassMsg,
      evidence: { patternSpans: overbroad },
    });
  }

  // 9) Redundant quantifiers
  const redundant = detectRedundantQuantifiers(ast);
  if (redundant) {
    warnings.push({
      id: RISK.REDUNDANT_QUANTIFIERS,
      severity: "info",
      title: T.redundantQuantTitle,
      message: T.redundantQuantMsg,
      evidence: { patternSpans: redundant },
    });
  }

  // 10) Lookaround complexity notice
  const look = detectLookarounds(ast);
  if (look) {
    warnings.push({
      id: RISK.LOOKAROUND_COMPLEXITY,
      severity: "info",
      title: T.lookaroundComplexTitle,
      message: T.lookaroundComplexMsg,
      evidence: { patternSpans: look },
    });
  }

  // 11) Sticky + global
  if (detectStickyWithGlobal(flags)) {
    warnings.push({
      id: RISK.STICKY_WITH_GLOBAL,
      severity: "info",
      title: T.stickyWithGlobalTitle,
      message: T.stickyWithGlobalMsg,
    });
  }

  // 12) Unicode mismatch
  if (detectUnicodeFlagMismatch(ast, flags)) {
    warnings.push({
      id: RISK.UNICODE_FLAG_MISMATCH,
      severity: "low",
      title: T.unicodeFlagMismatchTitle,
      message: T.unicodeFlagMismatchMsg,
    });
  }

  return warnings;
}
