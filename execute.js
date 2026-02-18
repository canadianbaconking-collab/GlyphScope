/**
 * execute.js - Minimal execution engine
 */

export const DEFAULT_GUARD = { maxMatches: 500 };

export function executeRegex(pattern, flags, text, guard) {
  const results = [];
  if (!text) return { matches: [] };

  try {
    const re = new RegExp(pattern, flags);
    
    // Handle global
    if (flags.includes("g")) {
      let match;
      let safety = 0;
      while ((match = re.exec(text)) !== null) {
        if (safety++ > guard.maxMatches) break;
        results.push(formatMatch(match));
        if (match.index === re.lastIndex) re.lastIndex++; // Avoid zero-width loop
      }
    } else {
      const match = re.exec(text);
      if (match) results.push(formatMatch(match));
    }
  } catch (e) {
    console.error("Exec error", e);
  }

  return { matches: results };
}

function formatMatch(m) {
  return {
    matchIndex: 0, // Placeholder
    inputSpan: { start: m.index, end: m.index + m[0].length },
    matchText: m[0],
    line: { number: 1 }, // Stub line number
    groups: [] // Stub groups
  };
}