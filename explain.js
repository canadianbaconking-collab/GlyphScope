/**
 * explain.js
 * 
 * Pure function module to convert a regexpp AST and flags into a human-readable explanation.
 * Fully compatible with regexpp node types and kinds.
 * 
 * Output: 
 *   - Object { summary: string[], components: string[], constraints: string[] }
 */

export function explainPattern(ast, flags = "") {
  const explanation = {
    summary: [],
    components: [],
    constraints: []
  };

  if (!ast) return explanation;

  // 1. Analyze Constraints
  explanation.constraints = analyzeConstraints(ast, flags);

  // 2. Analyze Components
  const rootAlternatives = ast.type === "Pattern" ? ast.alternatives : [ast];
  explanation.components = analyzeAlternatives(rootAlternatives);

  // 3. Generate Summary
  explanation.summary = generateSummary(rootAlternatives, explanation.constraints, flags);

  return explanation;
}

// --- Section 1: Constraints ---

function analyzeConstraints(ast, flags) {
  const c = [];
  const f = typeof flags === "string" ? flags : "";

  // Flags
  if (f.includes("g")) c.push("Global: matches all occurrences, not just the first.");
  if (f.includes("i")) c.push("Case-insensitive: ignores case differences.");
  if (f.includes("m")) c.push("Multi-line: ^ and $ match start/end of lines.");
  if (f.includes("s")) c.push("Dot-all: . matches newlines.");
  if (f.includes("u")) c.push("Unicode: treats pattern as a sequence of code points.");
  if (f.includes("y")) c.push("Sticky: matches only from the last index.");

  // Structural Anchoring
  const firstAlt = ast.type === "Pattern" && ast.alternatives.length > 0 ? ast.alternatives[0] : null;
  
  if (firstAlt && firstAlt.elements && firstAlt.elements.length > 0) {
    const elements = firstAlt.elements;
    const first = elements[0];
    const last = elements[elements.length - 1];

    const isStart = first.type === "Assertion" && first.kind === "start";
    const isEnd = last.type === "Assertion" && last.kind === "end";

    if (isStart && isEnd) {
      c.push("Anchored: needs a full string (or line) match.");
    } else if (isStart) {
      c.push("Start-anchored: must match from the start.");
    } else if (isEnd) {
      c.push("End-anchored: must match at the end.");
    }
  }

  return c;
}

// --- Section 2: Components ---

function analyzeAlternatives(alts) {
  if (!Array.isArray(alts) || alts.length === 0) return ["Empty pattern"];

  // Single alternative
  if (alts.length === 1) {
    return describeElements(alts[0].elements);
  }

  // Multiple alternatives
  const lines = [];
  lines.push(`Matches one of ${alts.length} alternatives:`);
  alts.forEach((alt, idx) => {
    const desc = describeElements(alt.elements);
    const text = Array.isArray(desc) ? desc.join(", ") : desc;
    lines.push(`  ${idx + 1}. ${text || "Empty string"}`);
  });
  return lines;
}

function describeElements(elements) {
  if (!elements || elements.length === 0) return [];
  const descriptions = [];
  
  elements.forEach(node => {
    const d = describeNode(node);
    if (d) descriptions.push(d);
  });
  
  return descriptions;
}

function describeNode(node) {
  if (!node) return "";

  switch (node.type) {
    case "Assertion":
      return describeAssertion(node);
    
    case "Quantifier":
      return describeQuantifier(node);

    case "Character":
      return `Literal "${formatChar(node.value)}"`;
    
    case "CharacterSet":
      return describeCharacterSet(node);

    case "CharacterClass":
      return describeCharacterClass(node);

    case "Group":
    case "CapturingGroup":
      return describeGroup(node);

    case "Backreference":
      return describeBackreference(node);

    default:
      return `Unknown component (${node.type})`;
  }
}

function describeAssertion(node) {
  // regexpp kinds: start, end, word, non-word, lookahead, lookbehind, etc.
  switch (node.kind) {
    case "start": return "Start of string/line anchor";
    case "end": return "End of string/line anchor";
    
    case "word": return "Word boundary";
    case "non-word": return "Non-word boundary";
    
    case "lookahead": 
      return `Positive lookahead (needs ${summarizeGroup(node)} to follow)`;
    
    case "lookbehind": 
      return `Positive lookbehind (needs ${summarizeGroup(node)} to precede)`;
    
    case "negative-lookahead": 
      return `Negative lookahead (ensures ${summarizeGroup(node)} does NOT follow)`;
    
    case "negative-lookbehind": 
      return `Negative lookbehind (ensures ${summarizeGroup(node)} does NOT precede)`;
    
    default: return `Assertion (${node.kind})`;
  }
}

function describeCharacterSet(node) {
  if (node.negate) {
    if (node.kind === "digit") return "Any non-digit";
    if (node.kind === "word") return "Any non-word character";
    if (node.kind === "space") return "Any non-whitespace";
    if (node.kind === "property") return `Any character NOT in Unicode property ${node.value || node.key}`;
    return "Inverted character set";
  }
  
  if (node.kind === "digit") return "Any digit (0-9)";
  if (node.kind === "word") return "Any word character (a-z, A-Z, 0-9, _)";
  if (node.kind === "space") return "Any whitespace (space, tab, newline)";
  if (node.kind === "any" || node.kind === "dot") return "Any character (except newline unless 's' flag)";
  if (node.kind === "property") return `Character with Unicode property ${node.value || node.key}`;
  
  return "Character set";
}

function describeCharacterClass(node) {
  const parts = [];
  if (node.elements) {
    node.elements.forEach(el => {
      if (el.type === "Character") parts.push(formatChar(el.value));
      else if (el.type === "CharacterClassRange") parts.push(`${formatChar(el.min.value)}-${formatChar(el.max.value)}`);
      else if (el.type === "CharacterSet") parts.push(describeCharacterSet(el));
    });
  }
  const content = parts.join(", ");
  return node.negate 
    ? `Any character EXCEPT: [${content}]` 
    : `One of the characters: [${content}]`;
}

function describeGroup(node) {
  const isCapturing = node.capturing || node.type === "CapturingGroup";
  const content = analyzeAlternatives(node.alternatives);
  
  // Format content list (truncate if too long)
  let contentStr;
  if (Array.isArray(content) && content.length > 0) {
    if (content.length > 3) {
      contentStr = content.slice(0, 3).join(", ") + ", ...";
    } else {
      contentStr = content.join(", ");
    }
  } else {
    contentStr = "empty";
  }
  
  if (isCapturing) {
    const id = node.name ? `'${node.name}'` : `#${node.number || '?'}`;
    return `Capturing Group ${id}: matches ${contentStr}`;
  }
  return `Non-capturing group: matches ${contentStr}`;
}

function describeQuantifier(node) {
  const target = describeNode(node.element);
  const { min, max, greedy } = node;
  const greedyLabel = greedy === false ? " (lazy)" : ""; 
  
  // regexpp: max is null for Infinity
  const isUnlimited = max === null || max === Infinity;

  let range = "";
  if (min === 0 && max === 1) range = "optionally (0 or 1 time)";
  else if (min === 0 && isUnlimited) range = "zero or more times";
  else if (min === 1 && isUnlimited) range = "one or more times";
  else if (min === max) range = `exactly ${min} time${min === 1 ? "" : "s"}`;
  else range = `between ${min} and ${isUnlimited ? "unlimited" : max} times`;

  return `${target} \u2014 matches ${range}${greedyLabel}`;
}

function describeBackreference(node) {
  const ref = node.ref || node.reference;
  // If named (string), use quotes. If numeric, use #.
  const refLabel = typeof ref === "string" ? `'${ref}'` : `#${ref || "?"}`;
  return `Backreference: matches the same text as Capturing Group ${refLabel}`;
}

// --- Section 3: Summary Helpers ---

function generateSummary(alts, constraints, flags) {
  const s = [];
  
  if (alts.length > 1) {
    s.push(`Matches any one of ${alts.length} alternative patterns.`);
  } else {
    s.push("Matches a specific sequence of characters.");
  }

  if (flags.includes("i")) s.push("The match is case-insensitive.");
  if (flags.includes("g")) s.push("Finds all matches in the text (Global).");

  return s;
}

function summarizeGroup(node) {
  // Defensive shallow summary for lookarounds
  if (!node.alternatives || node.alternatives.length === 0) return "nothing";
  
  const alt = node.alternatives[0];
  if (alt && alt.elements && alt.elements.length > 0) {
    if (alt.elements.length > 1) return "sequence";
    const type = alt.elements[0].type;
    if (type === "Character") return "literal";
    if (type === "CharacterSet") return "character set";
    if (type === "Group") return "group";
  }
  return "pattern";
}

function formatChar(val) {
  if (val === undefined || val === null) return "";
  try {
    const s = String.fromCodePoint(val);
    const escapes = {
      "\n": "\\n", "\r": "\\r", "\t": "\\t", "\f": "\\f", "\v": "\\v", "\0": "\\0"
    };
    return escapes[s] || s;
  } catch (e) {
    return `(0x${val.toString(16)})`;
  }
}
