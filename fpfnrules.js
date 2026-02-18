// fpfn-rules.js
// Regex Explainer — False Positive / False Negative Estimator (v1.0 LOCKED)
//
// Purpose:
// - Given a regex + sample text + observed matches, generate:
//   1) likely false positives: strings that match but probably shouldn't
//   2) likely false negatives: strings that don't match but probably should
//
// Rules:
// - Deterministic heuristics only.
// - Always label outputs as "likely" (never certain).
// - Must remain lightweight: max ~6 examples per list.
// - Must never freeze UI: caps and early exits.
// - Uses JS RegExp engine; AST is used to guide perturbations.

export const FP_FN_LIMIT = 6;

export function estimateFalsePosNeg({ ast, pattern, flagsStr, sampleText, matches, guard }) {
  // Inputs:
  // - ast: regexpp AST (Pattern)
  // - pattern: string (normalized)
  // - flagsStr: string ("gimsuy")
  // - sampleText: string
  // - matches: MatchRecord[] from execute module
  // - guard: { maxCandidates, maxLineLen, maxTotalWork } (optional)
  //
  // Output:
  // {
  //   likelyFalsePositives: [{ text, reason }],
  //   likelyFalseNegatives: [{ text, reason }],
  //   notes: [string]
  // }

  const limits = {
    maxCandidates: guard?.maxCandidates ?? 250,
    maxLineLen: guard?.maxLineLen ?? 500,
    maxTotalWork: guard?.maxTotalWork ?? 2000, // total regex exec attempts
  };

  const re = safeCompile(pattern, flagsStr.replace("g", "")); // for single-string test runs
  if (!re.ok) {
    return {
      likelyFalsePositives: [],
      likelyFalseNegatives: [],
      notes: ["Cannot estimate false positives/negatives because the regex did not compile."],
    };
  }

  // 1) Build a candidate corpus from sample text
  const lines = sampleText
    .split(/\r?\n/)
    .slice(0, 5000)
    .map((l) => (l.length > limits.maxLineLen ? l.slice(0, limits.maxLineLen) : l));

  // Match-lines: take lines that contain matches
  const matchedLineNums = new Set(matches.map((m) => m.line.number));
  const matchedLines = [];
  const unmatchedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const line = lines[i];
    if (!line) continue;
    if (matchedLineNums.has(lineNo)) matchedLines.push(line);
    else unmatchedLines.push(line);
  }

  // If no sample-based matches exist, we can still generate "likely negatives" by intent-ish perturbation,
  // but v1 keeps it conservative: we need at least 1 match to propose "should match" examples.
  if (matches.length === 0) {
    return {
      likelyFalsePositives: [],
      likelyFalseNegatives: [],
      notes: [
        "No matches were found in the sample text, so the tool cannot infer likely false positives/negatives.",
        "Tip: paste a sample that includes at least one expected match.",
      ],
    };
  }

  // 2) Generate near-miss candidates
  const work = { used: 0 };
  const positives = [];
  const negatives = [];

  // 2A) Likely FALSE NEGATIVES
  // Approach: Take known matching lines/fragments and perturb them slightly in ways that "should still match"
  // if the regex is too strict, then test. If the perturbed string does NOT match, it may be a false negative.
  const negSeeds = sampleSeedsFromMatches(sampleText, matches, limits.maxCandidates);

  for (const seed of negSeeds) {
    if (negatives.length >= FP_FN_LIMIT) break;

    const variants = generateShouldStillMatchVariants(seed, ast);
    for (const v of variants) {
      if (negatives.length >= FP_FN_LIMIT) break;
      if (work.used >= limits.maxTotalWork) break;

      const m = testMatch(re.value, v);
      work.used++;

      if (!m) {
        negatives.push({
          text: v,
          reason: "Small variation of a known match did not match (may be too strict).",
        });
      }
    }
    if (work.used >= limits.maxTotalWork) break;
  }

  // 2B) Likely FALSE POSITIVES
  // Approach: Take known matching strings and make them "more obviously wrong" while still matching.
  // If the wrong-looking variant still matches, pattern may be too broad.
  for (const seed of negSeeds) {
    if (positives.length >= FP_FN_LIMIT) break;

    const variants = generateShouldNotMatchButMightVariants(seed, ast);
    for (const v of variants) {
      if (positives.length >= FP_FN_LIMIT) break;
      if (work.used >= limits.maxTotalWork) break;

      const m = testMatch(re.value, v);
      work.used++;

      if (m) {
        positives.push({
          text: v,
          reason: "A suspicious-looking variation still matched (may be too broad).",
        });
      }
    }
    if (work.used >= limits.maxTotalWork) break;
  }

  // De-dupe while preserving order
  const dedupe = (arr) => {
    const seen = new Set();
    return arr.filter((x) => {
      const key = x.text;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  return {
    likelyFalsePositives: dedupe(positives).slice(0, FP_FN_LIMIT),
    likelyFalseNegatives: dedupe(negatives).slice(0, FP_FN_LIMIT),
    notes: [
      "These are heuristic examples based on your sample text. Treat them as likely cases, not proof.",
      work.used >= limits.maxTotalWork ? "Estimation was capped to avoid slowdowns." : "",
    ].filter(Boolean),
  };
}

// ----------------------------
// Helper: compile safely
// ----------------------------
function safeCompile(pattern, flagsStr) {
  try {
    return { ok: true, value: new RegExp(pattern, flagsStr) };
  } catch (e) {
    return { ok: false, error: { message: String(e?.message || e) } };
  }
}

// Test match for a whole string OR substring?
// v1 rule: use "search" semantics (like /.../.test(str)) not full-string unless anchored.
function testMatch(re, str) {
  try {
    return re.test(str);
  } catch {
    return false;
  }
}

// ----------------------------
// Seed selection: extract "representative match strings"
// ----------------------------
function sampleSeedsFromMatches(sampleText, matches, maxCandidates) {
  // Goal: pick a small set of strings that represent the regex’s success cases.
  // Prefer:
  // - full matchText (from MatchRecord)
  // - capture group values if present (because they show important sub-structure)
  //
  // We cap seeds to keep work small.

  const seeds = [];
  const push = (s) => {
    if (!s) return;
    if (s.length > 300) s = s.slice(0, 300);
    seeds.push(s);
  };

  for (const m of matches) {
    if (seeds.length >= maxCandidates) break;
    push(m.matchText);

    if (m.groups && m.groups.length) {
      for (const g of m.groups) {
        if (seeds.length >= maxCandidates) break;
        // only take group values that are non-trivial
        if (g.value && g.value.length >= 2) push(g.value);
      }
    }
  }

  // Prefer unique seeds
  const seen = new Set();
  return seeds.filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  }).slice(0, Math.min(40, maxCandidates)); // hard cap; we don't need more
}

// ----------------------------
// Variant generation rules (deterministic)
// ----------------------------
//
// We use AST only to decide which knobs exist: digits, dots, hyphens, whitespace, word chars.
// In v1 we intentionally DO NOT attempt to generate "semantically correct" strings,
// only controlled perturbations of known matches.

function generateShouldStillMatchVariants(seed, ast) {
  const v = [];
  const F = extractFpfnFeatures(ast);

  // Rule A: allow minor whitespace variation (common strictness issue)
  // - Add a leading/trailing space
  // - Replace single space with multiple spaces
  if (F.allowsWhitespace) {
    v.push(" " + seed);
    v.push(seed + " ");
    v.push(seed.replace(/ /g, "  "));
  }

  // Rule B: case variation (if pattern isn't case-insensitive but might need to be)
  // Only if seed has letters
  if (/[A-Za-z]/.test(seed)) {
    v.push(seed.toUpperCase());
    v.push(seed.toLowerCase());
    v.push(toggleCase(seed));
  }

  // Rule C: optional separator variation
  // Replace '-' with '_' or space, replace '.' with '-', etc.
  if (F.hasHyphenLike) v.push(seed.replace(/-/g, "_"));
  if (F.hasDotLike) v.push(seed.replace(/\./g, "-"));
  if (F.hasColonLike) v.push(seed.replace(/:/g, "-"));

  // Rule D: minor length variation (if quantifiers likely allow ranges)
  // Duplicate last char, remove last char
  if (seed.length >= 3) {
    v.push(seed.slice(0, -1));
    v.push(seed + seed.slice(-1));
  }

  return uniqueLimited(v, 8);
}

function generateShouldNotMatchButMightVariants(seed, ast) {
  const v = [];
  const F = extractFpfnFeatures(ast);

  // Rule E: inject "obviously wrong" characters that broad patterns often allow
  // - Add spaces / tabs
  // - Add emoji / unicode symbol
  v.push(seed + " ");
  v.push(seed + "\t");
  v.push(seed + "✅");

  // Rule F: for digit-ish patterns, insert letters into numeric regions
  if (F.usesDigits) {
    v.push(seed.replace(/\d/, "A")); // replace first digit
    v.push(seed + "A");
  }

  // Rule G: for word-ish patterns, insert punctuation
  if (F.usesWordChars) {
    v.push(seed + "!");
    v.push(seed.replace(/[A-Za-z]/, "!"));
  }

  // Rule H: for separator-heavy patterns, break separators
  if (F.hasDotLike) v.push(seed.replace(/\./g, ".."));
  if (F.hasHyphenLike) v.push(seed.replace(/-/g, "--"));
  if (F.hasColonLike) v.push(seed.replace(/:/g, "::"));

  // Rule I: if pattern looks unanchored, wrap in junk prefix/suffix
  // This helps identify unintended substring matches.
  if (!F.isAnchored) {
    v.push("xxx" + seed + "yyy");
    v.push("{" + seed + "}");
  }

  return uniqueLimited(v, 10);
}

function uniqueLimited(arr, limit) {
  const out = [];
  const seen = new Set();
  for (const s of arr) {
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

function toggleCase(s) {
  let out = "";
  for (const ch of s) {
    const up = ch.toUpperCase();
    const lo = ch.toLowerCase();
    out += ch === up ? lo : up;
  }
  return out;
}

// ----------------------------
// AST feature extraction for fp/fn (small set)
// ----------------------------
function extractFpfnFeatures(ast) {
  // conservative feature set
  const F = {
    usesDigits: false,
    usesWordChars: false,
    allowsWhitespace: false,
    hasDotLike: false,
    hasHyphenLike: false,
    hasColonLike: false,
    isAnchored: false,
  };

  let hasStart = false;
  let hasEnd = false;

  walk(ast, (n) => {
    const raw = n?.raw || "";

    if (n?.type === "Assertion" && n?.kind === "start") hasStart = true;
    if (n?.type === "Assertion" && n?.kind === "end") hasEnd = true;

    if (raw.includes("\\d") || raw.includes("[0-9]")) F.usesDigits = true;
    if (raw.includes("\\w")) F.usesWordChars = true;
    if (raw.includes("\\s") || raw.includes("[ \\t]")) F.allowsWhitespace = true;

    if (raw.includes("\\.")) F.hasDotLike = true;
    if (raw.includes("-")) F.hasHyphenLike = true;
    if (raw.includes(":")) F.hasColonLike = true;
  });

  F.isAnchored = hasStart && hasEnd;
  return F;
}

function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn));
    else if (v && typeof v === "object") walk(v, fn);
  }
}
