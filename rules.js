// rules.js
// Regex Explainer — Risk Rules (v1.0 LOCKED)
// Goal: conservative, deterministic warnings. No perfection claims.
// Input: regexpp AST + flags. Output: Warning[] with evidence spans when possible.

// ---------------------------
// Warning IDs (stable)
// ---------------------------
export const RISK = {
  POTENTIAL_BACKTRACKING: "RISK_POTENTIAL_BACKTRACKING",
  NESTED_QUANTIFIERS: "RISK_NESTED_QUANTIFIERS",
  AMBIGUOUS_WILDCARD: "RISK_AMBIGUOUS_WILDCARD",
  UNANCHORED: "RISK_UNANCHORED",
  DOTALL_EXPECTED: "RISK_DOTALL_EXPECTED",
  MULTILINE_ANCHOR_CONFUSION: "RISK_MULTILINE_ANCHOR_CONFUSION",
  EMPTY_ALTERNATION: "RISK_EMPTY_ALTERNATION",
  OVERBROAD_CLASS: "RISK_OVERBROAD_CLASS",
  CATAPHRASE_REDO: "RISK_REDUNDANT_QUANTIFIERS",
  LOOKAROUND_COMPLEXITY: "RISK_LOOKAROUND_COMPLEXITY",
  STICKY_WITH_GLOBAL: "RISK_STICKY_WITH_GLOBAL",
  UNICODE_FLAG_MISMATCH: "RISK_UNICODE_FLAG_MISMATCH",
};

// ---------------------------
// Severity policy (simple)
// ---------------------------
function sev(s) { return s; }

// ---------------------------
// Message templates (tone locked)
// ---------------------------
// Rules: short, plain, practical. Never claim certainty for performance risks.

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

  unanchoredTitle: "Unanchored pattern",
  unanchoredMsg:
    "This pattern is not anchored. It may match inside longer strings when you intended a full-string match.",

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

// ---------------------------
// AST helpers (regexpp)
// ---------------------------
// Note: regexpp AST shapes differ slightly by version.
// Implement these visitors defensively.

/** Best-effort: get span from node (regexpp typically has `start`/`end` indices) */
function spanOf(node) {
  const start = typeof node?.start === "number" ? node.start : undefined;
  const end = typeof node?.end === "number" ? node.end : undefined;
  if (start == null || end == null) return undefined;
  return { start, end };
}

/** Walk nodes depth-first */
function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn));
    else if (v && typeof v === "object") walk(v, fn);
  }
}

/** Identify if node represents a quantifier */
function isQuantifier(n) {
  // regexpp uses Quantifier nodes or elements with `quantifier`
  return n?.type === "Quantifier" || n?.quantifier != null;
}

/** Identify wildcard "dot" token */
function isDot(n) {
  // Often `Character` with value "." and raw "." or `CharacterSet` with kind="dot"
  return n?.type === "CharacterSet" && n?.kind === "dot";
}

/** Identify greedy wildcard patterns: .* or .+ or .{n,} with dot */
function isGreedyDotQuantified(element) {
  // match Element = dot with a quantifier that is greedy and can expand
  const el = element?.element ?? element;
  const q = element?.quantifier ?? null;
  const dot = isDot(el);
  if (!dot || !q) return false;

  // Quantifier shape (best-effort):
  // q.min, q.max (max null for Infinity), q.greedy boolean
  const greedy = q.greedy !== false;
  const min = typeof q.min === "number" ? q.min : 1;
  const max = q.max == null ? Infinity : q.max;
  const expands = max === Infinity || max > min;
  return greedy && expands && min >= 0;
}

/** Detect nested quantifiers: a quantified group containing a quantified subpattern */
function detectNestedQuantifiers(ast) {
  const spans = [];
  walk(ast, (n) => {
    // Find an element that is quantified AND whose inner contains another quantifier
    const hasQuant = n?.quantifier != null || n?.type === "Quantifier";
    if (!hasQuant) return;

    // Identify the "target" subpattern/group part
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

  return spans.length ? { spans } : null;
}

/** Detect obvious catastrophic-backtracking shapes: (.*)*, (.+)+, (a+)+, (.*)+ etc. */
function detectObviousBacktracking(ast) {
  const spans = [];
  walk(ast, (n) => {
    // Look for quantified group where inside is dot-quantified or alternation-heavy
    const q = n?.quantifier;
    const target = n?.element ?? null;
    if (!q || !target) return;

    const greedy = q.greedy !== false;
    const maxInf = q.max == null;
    if (!(greedy && maxInf)) return; // only warn on greedy + potentially unbounded

    // Inside contains a greedy dot quantifier OR alternation OR another quantifier
    let innerDotQ = false;
    let innerAlt = false;
    let innerQuant = false;

    walk(target, (inner) => {
      if (inner?.type === "Alternative" || inner?.type === "AlternationExpression") innerAlt = true;
      if (isGreedyDotQuantified(inner)) innerDotQ = true;
      if (inner !== n && (inner?.quantifier != null || inner?.type === "Quantifier")) innerQuant = true;
    });

    if (innerDotQ || (innerAlt && innerQuant)) {
      const s = spanOf(n) || spanOf(target);
      if (s) spans.push(s);
    }
  });

  return spans.length ? { spans } : null;
}

/** Detect unanchored patterns: no ^ at start and no $ at end at top-level */
function detectUnanchored(ast, flags) {
  // Conservative: only warn when pattern "looks like" it’s meant to validate full string
  // Signals: uses explicit classes for full token, or has start or end anchor missing but has the other,
  // or has obvious "validation shape" (no alternation across lines, no global extraction cues).
  // For v1, keep it simple:
  // - If pattern contains ^ XOR $ at top-level -> warn
  // - If pattern contains neither and has no "g" and includes word boundary/explicit groups -> warn low
  let hasStart = false;
  let hasEnd = false;

  // regexpp uses Assertion nodes for ^ and $
  walk(ast, (n) => {
    if (n?.type === "Assertion" && n?.kind === "start") hasStart = true;
    if (n?.type === "Assertion" && n?.kind === "end") hasEnd = true;
  });

  const spans = [];
  if (hasStart !== hasEnd) {
    // Evidence span: highlight the whole pattern (top-level)
    const s = spanOf(ast);
    if (s) spans.push(s);
    return { spans };
  }

  if (!hasStart && !hasEnd && !flags.g) {
    // Low-confidence unanchored warning only if regex appears "validation-ish"
    let looksValidationish = false;
    walk(ast, (n) => {
      if (n?.type === "Quantifier" && n?.max != null && n?.max <= 64) looksValidationish = true;
      if (n?.type === "CharacterSet" && n?.kind === "word") looksValidationish = true;
      if (n?.type === "Assertion" && n?.kind === "wordBoundary") looksValidationish = true;
    });
    if (looksValidationish) {
      const s = spanOf(ast);
      if (s) spans.push(s);
      return { spans };
    }
  }
  return null;
}

/** Detect '.' with missing 's' flag when sample has newlines (sample-dependent; optional) */
export function detectDotallExpected(ast, flags, sampleText) {
  if (flags.s) return false;
  if (!sampleText || sampleText.indexOf("\n") === -1) return false;

  let usesDot = false;
  walk(ast, (n) => { if (isDot(n)) usesDot = true; });
  return usesDot;
}

/** Detect m-flag anchor confusion: uses ^/$ with m enabled */
function detectMultilineAnchorConfusion(ast, flags) {
  if (!flags.m) return false;
  let hasAnchors = false;
  walk(ast, (n) => {
    if (n?.type === "Assertion" && (n?.kind === "start" || n?.kind === "end")) hasAnchors = true;
  });
  return hasAnchors;
}

/** Detect empty alternation branches: `a|` or `|a` or `a||b` (best-effort) */
function detectEmptyAlternation(ast) {
  const spans = [];
  walk(ast, (n) => {
    // regexpp has Alternatives arrays; empty alternative appears as Alternative with no elements
    if (n?.type === "Alternative" && Array.isArray(n.elements) && n.elements.length === 0) {
      const s = spanOf(n);
      if (s) spans.push(s);
    }
  });
  return spans.length ? { spans } : null;
}

/** Detect overbroad classes: [\s\S], [\d\D], [\w\W] */
function detectOverbroadClass(ast) {
  const spans = [];
  walk(ast, (n) => {
    if (n?.type !== "CharacterClass") return;
    // best-effort: check raw if available
    const raw = n?.raw;
    if (raw && (raw.includes("\\s\\S") || raw.includes("\\d\\D") || raw.includes("\\w\\W"))) {
      const s = spanOf(n);
      if (s) spans.push(s);
    }
  });
  return spans.length ? { spans } : null;
}

/** Detect redundant quantifiers: {0,} or {1,} or {0,1} */
function detectRedundantQuantifiers(ast) {
  const spans = [];
  walk(ast, (n) => {
    const q = n?.quantifier ?? (n?.type === "Quantifier" ? n : null);
    if (!q) return;
    const min = q.min;
    const max = q.max;
    if (min === 0 && max == null) { // {0,} == *
      const s = spanOf(n);
      if (s) spans.push(s);
    }
    if (min === 1 && max == null) { // {1,} == +
      const s = spanOf(n);
      if (s) spans.push(s);
    }
    if (min === 0 && max === 1) { // {0,1} == ?
      const s = spanOf(n);
      if (s) spans.push(s);
    }
  });
  return spans.length ? { spans } : null;
}

/** Detect lookaround presence (complexity notice, not "risk") */
function detectLookarounds(ast) {
  const spans = [];
  walk(ast, (n) => {
    if (n?.type === "Assertion" && (n.kind === "lookahead" || n.kind === "lookbehind")) {
      const s = spanOf(n);
      if (s) spans.push(s);
    }
  });
  return spans.length ? { spans } : null;
}

/** Detect sticky+global unusual combo */
function detectStickyWithGlobal(flags) {
  return !!flags.y && !!flags.g;
}

/** Detect unicode-related constructs without `u` or with `u` mismatch */
function detectUnicodeFlagMismatch(ast, flags) {
  // Conservative: if pattern contains unicode property escape \p{...} or \u{...}
  // and `u` is false -> warn.
  // If `u` is true but pattern uses surrogate-range hacks -> skip.
  let hasUnicodeProps = false;
  let hasUnicodeCodepoint = false;

  walk(ast, (n) => {
    const raw = n?.raw;
    if (!raw) return;
    if (raw.includes("\\p{") || raw.includes("\\P{")) hasUnicodeProps = true;
    if (raw.includes("\\u{")) hasUnicodeCodepoint = true;
  });

  if (!flags.u && (hasUnicodeProps || hasUnicodeCodepoint)) return true;
  return false;
}

// ---------------------------
// Public rule runner
// ---------------------------
export function detectRisks(ast, flags, sampleText) {
  const warnings = [];

  // 1) Strongest: nested quantifiers
  const nested = detectNestedQuantifiers(ast);
  if (nested) {
    warnings.push({
      id: RISK.NESTED_QUANTIFIERS,
      severity: sev("high"),
      title: T.nestedQuantifiersTitle,
      message: T.nestedQuantifiersMsg,
      evidence: { patternSpans: nested.spans },
    });
  }

  // 2) Obvious backtracking shapes
  const backtrack = detectObviousBacktracking(ast);
  if (backtrack) {
    warnings.push({
      id: RISK.POTENTIAL_BACKTRACKING,
      severity: sev(nested ? "high" : "medium"),
      title: T.potentialBacktrackingTitle,
      message: T.potentialBacktrackingMsg,
      evidence: { patternSpans: backtrack.spans },
    });
  }

  // 3) Greedy dot quantified (broadness risk)
  // Detect at least one occurrence
  let hasGreedyDotQ = false;
  const dotSpans = [];
  walk(ast, (n) => {
    if (isGreedyDotQuantified(n)) {
      hasGreedyDotQ = true;
      const s = spanOf(n);
      if (s) dotSpans.push(s);
    }
  });
  if (hasGreedyDotQ) {
    warnings.push({
      id: RISK.AMBIGUOUS_WILDCARD,
      severity: sev("medium"),
      title: T.ambiguousWildcardTitle,
      message: T.ambiguousWildcardMsg,
      evidence: { patternSpans: dotSpans.length ? dotSpans : undefined },
    });
  }

  // 4) Unanchored pattern (conservative)
  const unanch = detectUnanchored(ast, flags);
  if (unanch) {
    warnings.push({
      id: RISK.UNANCHORED,
      severity: sev("low"),
      title: T.unanchoredTitle,
      message: T.unanchoredMsg,
      evidence: { patternSpans: unanch.spans },
    });
  }

  // 5) Dotall expectation (sample-dependent)
  if (detectDotallExpected(ast, flags, sampleText)) {
    warnings.push({
      id: RISK.DOTALL_EXPECTED,
      severity: sev("low"),
      title: T.dotallExpectedTitle,
      message: T.dotallExpectedMsg,
    });
  }

  // 6) Multiline anchor confusion (flag-dependent)
  if (detectMultilineAnchorConfusion(ast, flags)) {
    warnings.push({
      id: RISK.MULTILINE_ANCHOR_CONFUSION,
      severity: sev("info"),
      title: T.multilineAnchorConfusionTitle,
      message: T.multilineAnchorConfusionMsg,
    });
  }

  // 7) Empty alternation
  const emptyAlt = detectEmptyAlternation(ast);
  if (emptyAlt) {
    warnings.push({
      id: RISK.EMPTY_ALTERNATION,
      severity: sev("medium"),
      title: T.emptyAltTitle,
      message: T.emptyAltMsg,
      evidence: { patternSpans: emptyAlt.spans },
    });
  }

  // 8) Overbroad character class
  const overbroad = detectOverbroadClass(ast);
  if (overbroad) {
    warnings.push({
      id: RISK.OVERBROAD_CLASS,
      severity: sev("info"),
      title: T.overbroadClassTitle,
      message: T.overbroadClassMsg,
      evidence: { patternSpans: overbroad.spans },
    });
  }

  // 9) Redundant quantifiers
  const redundant = detectRedundantQuantifiers(ast);
  if (redundant) {
    warnings.push({
      id: RISK.CATAPHRASE_REDO,
      severity: sev("info"),
      title: T.redundantQuantTitle,
      message: T.redundantQuantMsg,
      evidence: { patternSpans: redundant.spans },
    });
  }

  // 10) Lookaround complexity notice
  const look = detectLookarounds(ast);
  if (look) {
    warnings.push({
      id: RISK.LOOKAROUND_COMPLEXITY,
      severity: sev("info"),
      title: T.lookaroundComplexTitle,
      message: T.lookaroundComplexMsg,
      evidence: { patternSpans: look.spans },
    });
  }

  // 11) Sticky + global
  if (detectStickyWithGlobal(flags)) {
    warnings.push({
      id: RISK.STICKY_WITH_GLOBAL,
      severity: sev("info"),
      title: T.stickyWithGlobalTitle,
      message: T.stickyWithGlobalMsg,
    });
  }

  // 12) Unicode flag mismatch
  if (detectUnicodeFlagMismatch(ast, flags)) {
    warnings.push({
      id: RISK.UNICODE_FLAG_MISMATCH,
      severity: sev("low"),
      title: T.unicodeFlagMismatchTitle,
      message: T.unicodeFlagMismatchMsg,
    });
  }

  // NOTE: We intentionally do NOT attempt deep backtracking proofs.
  // Warnings are conservative and labeled as potential.

  return warnings;
}