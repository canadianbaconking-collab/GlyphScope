# Regex Explainer

A trust-first tool for understanding what a regular expression actually does — without generating or “fixing” it for you.

Regex Explainer breaks down JavaScript regular expressions into plain-English explanations, highlights matches safely, and surfaces subtle behavior that’s easy to miss when reading raw regex.

No servers. No tracking. No AI rewriting your pattern. Just clarity.

---

## What It Does

**Regex Explainer helps you:**

- Understand complex regex patterns at a glance
- See how groups, quantifiers, and assertions interact
- Preview matches against sample text safely
- Learn *why* a regex behaves the way it does — not just whether it matches

This tool is designed for **confidence and correctness**, not generation.

---

## Core Features

### 🧠 Human-Readable Explanation
- Plain-English breakdown of regex components
- Groups, character classes, quantifiers, anchors, and lookarounds explained
- Structured into:
  - Summary
  - Components
  - Constraints (flags & anchoring)

### 🔍 Safe Match Preview
- Run the regex against optional sample text
- Highlights matches inline
- Guards against runaway execution and excessive matches

### ⚙️ Flag Awareness
- Explicit handling of `g i m s u y`
- Explains how flags change regex behavior

### 🧱 Browser-Only by Design
- 100% client-side
- No network calls
- No analytics
- No APIs
- Works offline after download

---

## What It Does *Not* Do (By Design)

- ❌ Does not generate regex
- ❌ Does not “fix” or rewrite your pattern
- ❌ Does not attempt perfect validation or correctness guarantees
- ❌ Does not send your regex anywhere

Regex Explainer is an **insight tool**, not a generator.

---

## Free vs Paid

### Free Version
- Full explanation engine
- Match preview
- Flag analysis
- Safe execution guards

### Paid Version
- Advanced risk analysis
- Additional diagnostics
- Deeper insights for production regex usage

(Exact feature gating is handled in-app.)

---

## Supported Scope

- JavaScript regular expressions
- UTF-8 input
- Common regex constructs (groups, classes, quantifiers, lookarounds, backreferences)

### Known Limitations
- JavaScript regex semantics only
- Extremely exotic edge cases may be summarized conservatively
- Explanations prioritize clarity over exhaustive formalism

---

## Technical Notes

- Uses a real JavaScript regex parser (`regexpp`)
- No mock parsing
- Deterministic, explain-only pipeline
- Built and bundled for browser execution

---

## Installation / Usage

1. Download the ZIP
2. Open `index.html` (served via a local web server)
3. Paste a regex
4. (Optional) Add sample text
5. Read the explanation

Example local server:
```bash
python -m http.server
