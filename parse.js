/**
 * parse.js
 * Real parser implementation using regexpp.
 * Assumes 'regexpp' is available via ES module import (bundled).
 */

import { RegExpParser } from "regexpp";

const parser = new RegExpParser();

export function parsePattern(patternBody, flagsStr = "") {
  try {
    // Validate exactly as the JS engine will compile user input.
    // Pattern is always treated as a raw body, never as /.../flags.
    new RegExp(patternBody, flagsStr);
    const ast = parser.parsePattern(patternBody, 0, patternBody.length, flagsStr.includes("u"));

    return {
      ok: true,
      ast,
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
