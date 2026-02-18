import { normalizePatternInput } from "./contracts.js";
import { parsePattern } from "./parse.js";
import { explainPattern } from "./explain.js";
import { inferIntent } from "./intentmap.js";
import { executeRegex, DEFAULT_GUARD } from "./execute.js";
import { detectRisks } from "./risks.js";

const cases = [
  { name: "literal_cat", pattern: "cat", sample: "the cat sat", flags: "", expect: "match" },
  { name: "anchored_phone", pattern: "^\\d{3}-\\d{3}-\\d{4}$", sample: "123-456-7890", flags: "", expect: "match" },
  { name: "email", pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", sample: "a.b+tag@example.com", flags: "", expect: "match" },
  { name: "password_lookaheads", pattern: "^(?=.*[A-Z])(?=.*\\d).{8,}$", sample: "Abcdefg1", flags: "", expect: "match" },
  { name: "alternation_heavy", pattern: "^(cat|dog|bird)(s)?$", sample: "dogs", flags: "", expect: "match" },
  { name: "nested_groups_quantifiers", pattern: "^((ab)+|cd){2,3}$", sample: "ababcd", flags: "", expect: "match" },
  { name: "classes_escapes", pattern: "\\b[\\w\\s]{3,}\\d\\b", sample: "abc 7", flags: "", expect: "match" },
  { name: "url_with_slashes", pattern: "^https?:\\/\\/(?:www\\.)?[a-z0-9.-]+\\.[a-z]{2,}(?:\\/[^\\s]*)?$", sample: "HTTPS://www.example.com/path?q=1", flags: "i", expect: "match" },
  { name: "invalid_regex", pattern: "([a-z]", sample: "abc", flags: "", expect: "parse_error" }
];

let failures = 0;

for (const c of cases) {
  try {
    const body = normalizePatternInput(c.pattern);
    const parsed = parsePattern(body, c.flags);

    if (c.expect === "parse_error") {
      const ok = !parsed.ok;
      if (!ok) failures++;
      console.log(`${ok ? "PASS" : "FAIL"} ${c.name} :: expected parse error`);
      continue;
    }

    if (!parsed.ok) {
      failures++;
      console.log(`FAIL ${c.name} :: parse failed: ${parsed.error?.message || "unknown parse error"}`);
      continue;
    }

    const ast = parsed.ast;
    const explanation = explainPattern(ast, c.flags);
    const intent = inferIntent(ast, {
      g: c.flags.includes("g"),
      i: c.flags.includes("i"),
      m: c.flags.includes("m"),
      s: c.flags.includes("s"),
      u: c.flags.includes("u"),
      y: c.flags.includes("y")
    });
    const exec = executeRegex(body, c.flags, c.sample, DEFAULT_GUARD);
    const matchCount = (exec.matches || []).length;

    const ok =
      Array.isArray(explanation?.summary) &&
      explanation.summary.length > 0 &&
      Array.isArray(explanation?.components) &&
      explanation.components.length > 0 &&
      !!intent?.label &&
      matchCount > 0;

    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.name} :: matches=${matchCount}, summary=${explanation?.summary?.length || 0}, components=${explanation?.components?.length || 0}, intent=${intent?.label || "none"}`
    );
  } catch (err) {
    failures++;
    console.log(`FAIL ${c.name} :: runtime error: ${err?.message || String(err)}`);
  }
}

try {
  const pattern = "(a+)+$";
  const sample = "aaaaaaaaaaaaaaaaaaaaaaaaX";
  const parsed = parsePattern(pattern, "");
  if (!parsed.ok) {
    failures++;
    console.log("FAIL security_risks :: parse failed");
  } else {
    const warnings = detectRisks(parsed.ast, { g: false, i: false, m: false, s: false, u: false, y: false }, sample, { pattern });
    const ok = warnings.length > 0;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"} security_risks :: warnings=${warnings.length}`);
  }
} catch (err) {
  failures++;
  console.log(`FAIL security_risks :: runtime error: ${err?.message || String(err)}`);
}

console.log(`RESULT ${cases.length + 1 - failures}/${cases.length + 1} passed`);
process.exitCode = failures ? 1 : 0;
