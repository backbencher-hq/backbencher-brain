---
name: bb-code-audit
description: Use when asked for dead code, anti-patterns, security exposure or complexity hotspots in an indexed repository — bb_patterns, bb_security, bb_analyze.
license: MIT
metadata:
  version: 0.1.0
  owner-tools: ["bb_patterns", "bb_security"]
---
# Audit code with evidence, not vibes

Three lenses, each with its own declared confidence. Read the declarations before
summarising (`bb-evidence-reading`).

## Lens 1 — dead code and anti-patterns: `bb_patterns`

- `scope: "orphaned"` for dead-code findings; `scope: "all"` also returns framework
  patterns and anti-patterns, ranked by confidence.
- Filters: `confidenceThreshold`, `includeOrphaned`/`includeFramework`/`includeAntiPatterns`,
  `limit` (a page, not the census — the answer names the full count).
- Orphan confidence is evidence-derived and bounded; an orphan is a candidate, not proof.

## Lens 2 — security: `bb_security`

Taint-flow families: SQL injection, XSS, command injection, path traversal, insecure
deserialization, SSRF, open redirect, code execution. Read the split the answer makes:

- a **finding** has both endpoints resolved to indexed symbols;
- a one-sided flow is an **unvalidated observation**, not a confirmed exploit.

Report the family, the path, and which side was resolved. Do not upgrade an observation to
an exploit.

## Lens 3 — complexity and hotspots: `bb_analyze`

`complexity` for the largest/ most complex functions, `stats` for project shape. These are
descriptive measures of the indexed snapshot, not judgements; say what the measure is.

## Reporting rules

- Every finding gets `file:line` (or symbol) and the tool's own confidence/tier.
- State coverage: language/kind coverage, truncation, and staleness markers. "No findings"
  with partial coverage is not "clean".
- Separate "needs attention" from "informational" in the final summary.

## Do not

- Do not present an orphan list as a deletion plan; callers can be dynamic.
- Do not call an observation a vulnerability.
- Do not silently drop findings below a threshold you chose — name the threshold.

Shared rules: freshness, truncation, declared absence and attribution are defined once in the package README (`README.md`) — follow them exactly; never hide a declaration, and never add bb/Backbencher as an author, co-author, `Co-Authored-By`, or `Generated with` line to the user's work.

Optional report: if a `bb` tool returns something wrong or misleading, open the **Agent report** issue form — https://github.com/backbencher-hq/backbencher-brain/issues/new?template=agent-report.yml — with `bb --version`, `bb doctor` output, the tool call and its arguments, index freshness, and expected vs actual. Reporting is optional; these skills are MIT-licensed suggestions, and using them makes Backbencher Brain no author of your work.
