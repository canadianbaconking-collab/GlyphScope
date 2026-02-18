// contracts.js
// Regex Explainer — shared JSDoc typedefs + small helpers (runnable JS)

/**
 * @typedef {Object} Flags
 * @property {boolean} g
 * @property {boolean} i
 * @property {boolean} m
 * @property {boolean} s
 * @property {boolean} u
 * @property {boolean} y
 */

/** @typedef {"info"|"low"|"medium"|"high"} Severity */

/**
 * @typedef {Object} TextSpan
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {Object} ParseOk
 * @property {true} ok
 * @property {any} ast
 * @property {string} normalizedFlags
 */

/**
 * @typedef {Object} ParseErr
 * @property {false} ok
 * @property {{message:string,index?:number,line?:number,column?:number}} error
 */

/** @typedef {ParseOk|ParseErr} ParseResult */

/**
 * @typedef {Object} CaptureGroup
 * @property {number} index
 * @property {string=} name
 * @property {string} value
 * @property {TextSpan=} span
 */

/**
 * @typedef {Object} MatchRecord
 * @property {number} matchIndex
 * @property {TextSpan} inputSpan
 * @property {string} matchText
 * @property {{number:number,start:number,end:number,columnStart:number,columnEnd:number}} line
 * @property {CaptureGroup[]} groups
 */

/**
 * @typedef {Object} Warning
 * @property {string} id
 * @property {Severity} severity
 * @property {string} title
 * @property {string} message
 * @property {{patternSpans?:TextSpan[],examples?:string[]}=} evidence
 */

/**
 * @typedef {Object} Intent
 * @property {string} label
 * @property {number} confidence
 * @property {string[]} rationale
 */

/**
 * @typedef {Object} ExplanationSection
 * @property {string} title
 * @property {string[]} bullets
 * @property {{patternSpans?:TextSpan[]}=} evidence
 */

/**
 * @typedef {Object} LineMapRow
 * @property {number} lineNumber
 * @property {number} matchCount
 * @property {TextSpan=} firstMatchSpan
 */

/**
 * @typedef {Object} ExampleCase
 * @property {string} text
 * @property {string} reason
 */

/**
 * @typedef {Object} FalsePosNegReport
 * @property {ExampleCase[]} likelyFalsePositives
 * @property {ExampleCase[]} likelyFalseNegatives
 * @property {string[]=} notes
 */

/**
 * @typedef {Object} ExecGuard
 * @property {number} maxSampleChars
 * @property {number} maxMatches
 * @property {boolean} requireGlobalForMany
 */

/** @type {ExecGuard} */
export const DEFAULT_GUARD = {
  maxSampleChars: 50_000,
  maxMatches: 500,
  requireGlobalForMany: true,
};

export const BUILD_TARGET = "offline_pro";
const IS_OFFLINE_PRO = BUILD_TARGET === "offline_pro";

export const FEATURES = Object.freeze({
  securityRisks: IS_OFFLINE_PRO,
  falsePositiveNegative: IS_OFFLINE_PRO,
});

export function assertOfflineProBuild() {
  if (!IS_OFFLINE_PRO) {
    throw new Error(`Invalid BUILD_TARGET: ${BUILD_TARGET}`);
  }
}

export function flagsToString(flags) {
  return ["g","i","m","s","u","y"].filter(k => !!flags[k]).join("");
}

export function normalizePatternInput(patternRaw) {
  return String(patternRaw ?? "");
}
