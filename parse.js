/**
 * parse.js
 * Real parser implementation using regexpp.
 * Assumes 'regexpp' is available via ES module import (bundled).
 */

import { parseRegExpLiteral } from "regexpp";

export function parsePattern(patternBody, flagsStr = "") {
  try {
    // Escape forward slashes to prevent breaking the literal construction
    // e.g. "a/b" -> "/a\/b/g"
    const escaped = patternBody.replace(/\//g, "\\/");
    const literal = `/${escaped}/${flagsStr}`;
    
    // Parse
    const ast = parseRegExpLiteral(literal);

    return {
      ok: true,
      ast: ast.pattern, // Return just the Pattern node
      normalizedFlags: flagsStr
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        message: err.message || "Invalid regular expression",
        index: err.index,
        column: err.column
      }
    };
  }
}