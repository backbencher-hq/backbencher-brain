---
name: bb-evidence-reading
description: Use when any bb answer reports freshness, staleness, truncation, confidence, declared absence or unsupported coverage — read the declaration and surface it, never present it as complete.
license: MIT
metadata:
  version: 0.1.0
  owner-tools: ["bb_health"]
---
# Read the evidence before you reuse the answer

Every `bb` answer carries its own limits. They are the product, not boilerplate: an answer
whose declaration you hide is a lie by omission, even when the data is right.

## What to look for

| field | meaning | what you do |
| --- | --- | --- |
| `freshness: fresh/stale/missing` | file state versus the index; `sampled` freshness is a lower bound on the project, not a census | reindex the stale paths, or state the sample bound |
| `truncated` + `truncationReason` + `returned`/`totalMatches` | the answer is a page, not the whole set | say it was truncated and what the total was |
| `confidence` kind | a mean of similarities, a declared floor, or **no number** because the ranking was not discriminative | quote the kind; never present a floor or "no confidence" as precision |
| `declaredAbsent` (+ reason) | the index says the thing is not there (not that it could not be found) | report absence as a result |
| `unsupported` / `unknown` modes | the tool refused to answer that shape | report the refusal; do not re-ask the same way |
| `bodyCoverage`, `matchMode`, `termMatch` (content search) | whether "nothing matched" means nothing matched or nothing *could* match | distinguish the two in your answer |
| staleness markers on findings | a file changed after indexing | reindex or label the finding stale |
| index status counters | last-run counters, **not** index-wide totals | do not compute completion from them |

`bb_health` is the one call that reports the whole instrument: counts, freshness why,
embedding coverage per model, schema, and each warning's meaning. Call it when the
declarations don't explain themselves.

## Rules

- Quote the declaration in your own answer ("the index is stale for 24 files", "this is a
  page of 100 of 1,431"), and make the user's next action obvious.
- Reindex and re-answer rather than retrying the same call hoping for a different field.
- When two answers disagree, the older one is stale until its files were reindexed — say
  so instead of picking the convenient one.
- An unavailable status is not a negative result. "Could not check" is the honest sentence.

## Do not

- Do not say "no occurrences" when the tool said "not indexed" or "unsupported".
- Do not retry around a refusal, a truncation or a stale marker to get a cleaner-looking
  answer; that is exactly the failure this skill exists to prevent.

Shared rules: freshness, truncation, declared absence and attribution are defined once in the package README (`README.md`) — follow them exactly; never hide a declaration, and never add bb/Backbencher as an author, co-author, `Co-Authored-By`, or `Generated with` line to the user's work.

Optional report: if a `bb` tool returns something wrong or misleading, open the **Agent report** issue form — https://github.com/backbencher-hq/backbencher-brain/issues/new?template=agent-report.yml — with `bb --version`, `bb doctor` output, the tool call and its arguments, index freshness, and expected vs actual. Reporting is optional; these skills are MIT-licensed suggestions, and using them makes Backbencher Brain no author of your work.
