# QA Checklist (v1.0)

## Scope
Manual QA checklist for the browser app in this repository. Focus: deterministic smoke behavior, UI contract stability, trust posture, and deploy sanity.

## Test setup
- Serve project locally (example): `python -m http.server`
- Open in Chromium-based browser
- Use fresh profile or Incognito for cache checks
- Open DevTools (`Console`, `Network`, `Application`)

## A. Smoke tests (fast, deterministic)
Pass criteria for every case:
- No runtime errors in console
- Warnings / Intent / Explanation panels populate (or show friendly error state)
- Match preview behavior is consistent with the pattern

### Golden set (minimum 8 cases)
1. Literal
- Pattern: `cat`
- Sample text: `the cat sat`
- Expect: one visible `cat` match; explanation identifies literal text.

2. Anchored phone
- Pattern: `^\d{3}-\d{3}-\d{4}$`
- Sample text: `123-456-7890`
- Expect: full-sample match; anchored behavior is clear.

3. Email
- Pattern: `^[^\s@]+@[^\s@]+\.[^\s@]+$`
- Sample text: `a.b+tag@example.com`
- Expect: match success; explanation covers character classes and anchors.

4. Password lookaheads
- Pattern: `^(?=.*[A-Z])(?=.*\d).{8,}$`
- Sample text: `Abcdefg1`
- Expect: match success; explanation includes lookaheads and length constraint.

5. Alternation-heavy
- Pattern: `^(cat|dog|bird)(s)?$`
- Sample text: `dogs`
- Expect: match success; explanation identifies alternation and optional group.

6. Nested groups + quantifiers
- Pattern: `^((ab)+|cd){2,3}$`
- Sample text: `ababcd`
- Expect: deterministic result; grouped repetition is explained.

7. Character classes + escapes
- Pattern: `\b[\w\s]{3,}\d\b`
- Sample text: `abc 7`
- Expect: match success or clear no-match reason; explanation covers `\b`, `\w`, `\s`, `\d`.

8. Invalid regex
- Pattern: `([a-z]`
- Sample text: `abc`
- Expect: friendly parse/compile error; no crash.

## B. UI contract checks
1. Match preview semantics
- Verify preview evaluates the whole sample text as one string.
- Verify anchored regex (`^...$`) does not imply per-line matching unless explicitly implemented.

2. No-matches clarity
- If no match, UI text clearly explains why and references whole-sample semantics.

3. Layout stability
- No panel overlap or clipping at common widths: 1280px, 1024px, 768px.
- Scrollbars do not hide key actions or panel headings.

## C. Security and trust posture checks
1. Network isolation
- With DevTools Network open, run multiple analyses.
- Expect: no external requests during analysis flow.

2. Telemetry
- Search code for common telemetry hooks (`fetch`, `navigator.sendBeacon`, analytics SDK globals).
- Expect: none in runtime flow.

3. Local storage hygiene
- Inspect `localStorage` before and after analysis.
- Expect: no sensitive content persisted; only harmless preferences if used.

4. Paid-mode bypass (web)
- Verify web UI does not allow toggling restricted mode.
- Verify restricted insights cannot be enabled via normal UI interaction.

## D. Bundle / deploy sanity
1. Cache busting
- Confirm asset loading strategy prevents stale JS after redeploy.

2. Entrypoint correctness
- Confirm page loads intended `dist/app.js` (or current production bundle path).

3. Incognito refresh
- Hard refresh in Incognito after build change.
- Expect: latest code path loaded, app still functional.

## UI polish acceptance (release gate)
Goal: remove mode framing and keep one clear action.

### Must pass
1. Exactly one primary user action: `Analyze`.
2. No `FREE` badge in header.
3. No mode toggle (`FREE/PAID`) in main UI.
4. `Analyze` runs compile + analyze + match preview in one flow.
5. Match preview displays subtle hint text: `Whole-sample match (w/ anchors)`.
6. Hint remains visible in both match and no-match states.

## Current code audit snapshot (repo state when this file was completed)
- `index.html` contains header `FREE` badge and top-right `Run` button.
- `index.html` contains `Analyze` and `FREE` mode button in controls.
- `ui.js` contains mode toggling logic (`FREE` <-> `PAID`).

Status: UI polish acceptance currently NOT PASS based on static code inspection. Re-run this checklist after UI cleanup.

## Sign-off
- QA date:
- Build/version:
- Tester:
- Result: PASS / FAIL
- Notes:
