// intentmap.js
// Regex Explainer — Intent Map (v1.0 LOCKED)
// Goal: infer a single conservative "what this regex is probably for" label.
// Inputs: regexpp AST + flags
// Outputs: { label, confidence, rationale[] }
// Rules:
// - Deterministic heuristics only (no AI-ish language).
// - Confidence is conservative; never 1.0.
// - If best confidence < THRESHOLD => "General pattern".

export const INTENT_CONFIDENCE_THRESHOLD = 0.6;

// ---------------------------
// Intent labels (v1.0)
// ---------------------------
// Keep the set small to avoid false certainty.

export const INTENT_LABELS = {
  GENERAL: "General pattern",
  EMAIL_LIKE: "Email-like identifier",
  URL_LIKE: "URL-like string",
  UUID: "UUID / GUID",
  IPV4: "IPv4 address",
  IPV6: "IPv6 address",
  ISO_DATE: "ISO 8601 date",
  TIME_24H: "24-hour time",
  TIMESTAMP: "Timestamp (date + time)",
  SEMVER: "Semantic version (SemVer-like)",
  HEX: "Hex string",
  ALPHANUM_ID: "Alphanumeric identifier",
  LOG_LEVEL: "Log level token (INFO/WARN/ERROR...)",
  FILE_PATH: "File path (basic)",
  PHONE_LIKE: "Phone-like number (basic)",
};

// ---------------------------
// Feature extraction
// ---------------------------

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

function extractFeatures(ast, flags) {
  const f = {
    hasStartAnchor: false,
    hasEndAnchor: false,
    hasWordBoundary: false,
    hasAlternation: false,
    groupCount: 0,
    namedGroupCount: 0,
    hasLookaround: false,

    usesAtSign: false,
    usesColon: false,
    usesSlash: false,
    usesDotLiteral: false,
    usesHyphenLiteral: false,
    usesUnderscoreLiteral: false,
    usesPlusLiteral: false,
    usesQuestionLiteral: false,

    usesDigitClass: false,
    usesHexClass: false,
    usesBraceQuantifier: false,
    containsExactCounts: [],

    containsUUIDHyphenPattern: false,
    containsSemverDots: false,
    containsIPv4DotStructure: false,
    containsIPv6ColonStructure: false,

    usesUnicodeProps: false,
  };

  // Lightweight raw-based hints when available
  const rawPattern = ast?.raw;

  walk(ast, (n) => {
    // Anchors & boundaries
    if (n?.type === "Assertion" && n?.kind === "start") f.hasStartAnchor = true;
    if (n?.type === "Assertion" && n?.kind === "end") f.hasEndAnchor = true;
    if (n?.type === "Assertion" && n?.kind === "wordBoundary") f.hasWordBoundary = true;
    if (n?.type === "Assertion" && (n?.kind === "lookahead" || n?.kind === "lookbehind")) {
      f.hasLookaround = true;
    }

    // Alternation
    if (n?.type === "Alternative" && n?.parent?.type === "AlternationExpression") f.hasAlternation = true;
    if (n?.type === "AlternationExpression") f.hasAlternation = true;

    // Groups (capturing)
    if (n?.type === "CapturingGroup") {
      f.groupCount += 1;
      if (typeof n?.name === "string" && n.name.length) f.namedGroupCount += 1;
    }

    // Literals and punctuation (best-effort via raw)
    const raw = n?.raw;
    if (raw) {
      if (raw.includes("@")) f.usesAtSign = true;
      if (raw.includes(":")) f.usesColon = true;
      if (raw.includes("/")) f.usesSlash = true;
      // dot literal: escaped dot \. or raw '.' as literal inside class is ambiguous; prefer \.
      if (raw.includes("\\.")) f.usesDotLiteral = true;
      if (raw.includes("-")) f.usesHyphenLiteral = true;
      if (raw.includes("_")) f.usesUnderscoreLiteral = true;
      if (raw.includes("+")) f.usesPlusLiteral = true;
      if (raw.includes("?")) f.usesQuestionLiteral = true;
      if (raw.includes("\\p{") || raw.includes("\\P{")) f.usesUnicodeProps = true;
    }

    // Digits
    if (raw === "\\d" || raw?.includes("\\d")) f.usesDigitClass = true;
    if (raw?.includes("[0-9]")) f.usesDigitClass = true;

    // Hex
    if (raw?.match(/\[0-9a-fA-F\]/)) f.usesHexClass = true;
    if (raw?.includes("\\p{Hex_Digit}")) f.usesHexClass = true;

    // Quantifiers
    const q = n?.quantifier ?? (n?.type === "Quantifier" ? n : null);
    if (q) {
      f.usesBraceQuantifier = f.usesBraceQuantifier || (q.min != null && (q.max != null || q.max == null));
      if (typeof q.min === "number" && typeof q.max === "number" && q.min === q.max) {
        f.containsExactCounts.push(q.min);
      }
    }
  });

  // Structure hints from raw (safe-ish)
  if (rawPattern) {
    // UUID: 8-4-4-4-12 hex chunks with hyphens
    if (rawPattern.match(/[0-9a-fA-F]{8}(-|\\-)[0-9a-fA-F]{4}(-|\\-)[0-9a-fA-F]{4}(-|\\-)[0-9a-fA-F]{4}(-|\\-)[0-9a-fA-F]{12}/)) {
      f.containsUUIDHyphenPattern = true;
    }
    // SemVer-like: digits.digits.digits with optional suffixes
    if (rawPattern.match(/\d+\\?\.\d+\\?\.\d+/)) f.containsSemverDots = true;

    // IPv4 structure: (?:\d{1,3}\.){3}\d{1,3} (approx)
    if (rawPattern.includes("\\.") && rawPattern.match(/\d\{1,3\}.*\\\..*\\\..*\\\./)) {
      f.containsIPv4DotStructure = true;
    }

    // IPv6 structure: many colons
    const colonCount = (rawPattern.match(/:/g) || []).length;
    if (colonCount >= 2) f.containsIPv6ColonStructure = true;
  }

  return f;
}

// ---------------------------
// Scoring rules
// ---------------------------

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function toConfidence(bestScore) {
  // Conservative mapping:
  //  - 40 => 0.55
  //  - 60 => 0.70
  //  - 80 => 0.82
  //  - 95 => 0.90
  const c = 0.35 + (bestScore / 100) * 0.6;
  return clamp01(Math.min(c, 0.9));
}

function scoreCandidates(f, flags) {
  const cands = [];

  // Email-like
  {
    let score = 0;
    const r = [];
    if (f.usesAtSign) { score += 45; r.push("Contains '@'"); }
    if (f.usesDotLiteral) { score += 15; r.push("Uses '.' (likely domain separator)"); }
    if (f.hasStartAnchor && f.hasEndAnchor) { score += 10; r.push("Anchored to whole string"); }
    if (f.usesWordBoundary) { score += 5; r.push("Uses word boundary"); }
    if (f.hasAlternation) { score -= 5; r.push("Alternation reduces certainty"); }
    cands.push({ label: INTENT_LABELS.EMAIL_LIKE, score, rationale: r });
  }

  // URL-like
  {
    let score = 0;
    const r = [];
    if (f.usesSlash) { score += 25; r.push("Contains '/'"); }
    if (f.usesColon) { score += 25; r.push("Contains ':' (likely scheme/port)"); }
    if (f.usesDotLiteral) { score += 10; r.push("Uses '.' (likely host/domain)"); }
    if (f.hasStartAnchor) { score += 5; r.push("Has start anchor"); }
    if (flags.i) { score += 3; r.push("Case-insensitive flag often used for URLs"); }
    cands.push({ label: INTENT_LABELS.URL_LIKE, score, rationale: r });
  }

  // UUID
  {
    let score = 0;
    const r = [];
    if (f.containsUUIDHyphenPattern) { score += 70; r.push("Matches UUID hyphen chunk structure"); }
    if (f.usesHexClass) { score += 20; r.push("Uses hex character class"); }
    if (f.containsExactCounts.includes(8) && f.containsExactCounts.includes(12)) { score += 10; r.push("Has exact chunk lengths common to UUIDs"); }
    cands.push({ label: INTENT_LABELS.UUID, score, rationale: r });
  }

  // IPv4
  {
    let score = 0;
    const r = [];
    if (f.containsIPv4DotStructure) { score += 60; r.push("Has repeated dot-separated numeric structure"); }
    if (f.usesDigitClass) { score += 10; r.push("Uses digit class"); }
    if (f.usesBraceQuantifier) { score += 5; r.push("Uses numeric length quantifiers"); }
    cands.push({ label: INTENT_LABELS.IPV4, score, rationale: r });
  }

  // IPv6
  {
    let score = 0;
    const r = [];
    if (f.containsIPv6ColonStructure) { score += 55; r.push("Contains multiple ':' separators"); }
    if (f.usesHexClass) { score += 15; r.push("Uses hex character class"); }
    cands.push({ label: INTENT_LABELS.IPV6, score, rationale: r });
  }

  // ISO date (YYYY-MM-DD)
  {
    let score = 0;
    const r = [];
    if (f.usesDigitClass) { score += 15; r.push("Uses digit class"); }
    if (f.usesHyphenLiteral) { score += 20; r.push("Uses '-' separators"); }
    if (f.containsExactCounts.includes(4) && f.containsExactCounts.includes(2)) { score += 25; r.push("Uses 4 and 2 digit chunk lengths"); }
    if (f.hasStartAnchor && f.hasEndAnchor) { score += 5; r.push("Anchored to whole string"); }
    cands.push({ label: INTENT_LABELS.ISO_DATE, score, rationale: r });
  }

  // 24-hour time (HH:MM[:SS])
  {
    let score = 0;
    const r = [];
    if (f.usesColon) { score += 30; r.push("Uses ':' separators"); }
    if (f.containsExactCounts.includes(2)) { score += 20; r.push("Uses 2-digit chunks"); }
    if (f.usesDigitClass) { score += 10; r.push("Uses digit class"); }
    cands.push({ label: INTENT_LABELS.TIME_24H, score, rationale: r });
  }

  // Timestamp (date + time)
  {
    let score = 0;
    const r = [];
    // signals: date + time separators
    if (f.usesHyphenLiteral) { score += 15; r.push("Has '-' separators (date-like)"); }
    if (f.usesColon) { score += 15; r.push("Has ':' separators (time-like)"); }
    if (f.containsExactCounts.includes(4) && f.containsExactCounts.includes(2)) { score += 10; r.push("Has common date/time chunk lengths"); }
    cands.push({ label: INTENT_LABELS.TIMESTAMP, score, rationale: r });
  }

  // SemVer-like
  {
    let score = 0;
    const r = [];
    if (f.containsSemverDots) { score += 65; r.push("Contains digit-dot-digit-dot-digit structure"); }
    if (f.hasStartAnchor && f.hasEndAnchor) { score += 5; r.push("Anchored to whole string"); }
    cands.push({ label: INTENT_LABELS.SEMVER, score, rationale: r });
  }

  // Hex string
  {
    let score = 0;
    const r = [];
    if (f.usesHexClass) { score += 55; r.push("Uses hex character class"); }
    if (f.hasStartAnchor && f.hasEndAnchor) { score += 5; r.push("Anchored to whole string"); }
    if (f.containsExactCounts.includes(32) || f.containsExactCounts.includes(40) || f.containsExactCounts.includes(64)) {
      score += 10; r.push("Uses common hex digest lengths (32/40/64)");
    }
    cands.push({ label: INTENT_LABELS.HEX, score, rationale: r });
  }

  // Alphanumeric identifier
  {
    let score = 0;
    const r = [];
    // signals: word chars, anchors, length bounds
    if (f.hasStartAnchor && f.hasEndAnchor) { score += 15; r.push("Anchored to whole string"); }
    if (f.usesUnderscoreLiteral) { score += 5; r.push("Allows '_'"); }
    if (f.usesBraceQuantifier) { score += 10; r.push("Has explicit length bounds"); }
    if (f.hasWordBoundary) { score += 5; r.push("Uses word boundary"); }
    cands.push({ label: INTENT_LABELS.ALPHANUM_ID, score, rationale: r });
  }

  // Log level token
  {
    let score = 0;
    const r = [];
    // signals: alternation of common tokens
    if (f.hasAlternation) { score += 15; r.push("Uses alternation (token choices)"); }
    // best-effort: common words in raw
    const raw = astRawFallbackFromFeatures(f);
    if (raw && raw.match(/\b(INFO|WARN|WARNING|ERROR|DEBUG|TRACE|FATAL)\b/)) {
      score += 60; r.push("Contains common log level words");
    }
    cands.push({ label: INTENT_LABELS.LOG_LEVEL, score, rationale: r });
  }

  // Phone-like (basic)
  {
    let score = 0;
    const r = [];
    if (f.usesPlusLiteral) { score += 10; r.push("Allows '+' prefix"); }
    if (f.usesDigitClass) { score += 15; r.push("Uses digit class"); }
    if (f.usesHyphenLiteral) { score += 10; r.push("Allows '-' separators"); }
    cands.push({ label: INTENT_LABELS.PHONE_LIKE, score, rationale: r });
  }

  // File path (basic)
  {
    let score = 0;
    const r = [];
    if (f.usesSlash) { score += 25; r.push("Contains '/' separators"); }
    if (f.usesDotLiteral) { score += 5; r.push("Uses '.' (extension-like)"); }
    cands.push({ label: INTENT_LABELS.FILE_PATH, score, rationale: r });
  }

  return cands;
}

// We keep raw out of Features to avoid coupling, but we can store it optionally if you want.
// For now, no-op fallback:
function astRawFallbackFromFeatures(_f) {
  return undefined;
}

// ---------------------------
// Public API
// ---------------------------

export function inferIntent(ast, flags) {
  const f = extractFeatures(ast, flags);
  const cands = scoreCandidates(f, flags)
    .map((c) => ({ ...c, score: Math.max(0, Math.min(100, c.score)) }))
    .sort((a, b) => b.score - a.score);

  const best = cands[0];
  const bestScore = best?.score ?? 0;
  const confidence = toConfidence(bestScore);

  // Conservative fallback
  if (!best || confidence < INTENT_CONFIDENCE_THRESHOLD) {
    return {
      label: INTENT_LABELS.GENERAL,
      confidence: Math.min(0.55, confidence || 0.5),
      rationale: ["No strong intent signals were detected."],
    };
  }

  // Rationale trimming: only keep top 3 signals
  const rationale = (best.rationale || []).slice(0, 3);
  if (rationale.length === 0) rationale.push("Matched common structural signals for this intent.");

  return {
    label: best.label,
    confidence,
    rationale,
  };
}
