<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the reference page for bb_search's retrieval contract: what each
  mode searches, what every answer declares, and which gates prove it.
WHO IT IS FOR — callers who need the exact behavioural contract rather than a tutorial, and
  the owner maintaining the search engines.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_search/{descriptor,handler}.ts,
  src/intelligence/search/{symbol,content,regex}-search.ts, docs/BB_SEARCH.md,
  docs/tools/bb_search.md (generated), and the gates in the verification section.
-->

# `bb_search` — retrieval contract

Status: **verified within the declared retrieval contract** by the gates listed below.
The page does not claim analyzer completeness: search can only be as complete as the
indexed AST facts it receives, and an omitted symbol is an omission in the index, not
something search silently repairs.

## Modes

- `symbols` — indexed symbol-name retrieval with exact, prefix and substring phases;
  optional case folding, exact-name restriction, language/symbolKind filters, snippets,
  paging, and `regex: true` for a bounded caller-pattern name scan.
- `content` — indexed symbol-corpus retrieval: name, qualified name, docstring and the
  stored bounded symbol body; phrase route first, terms route when the phrase matched
  nothing; declares `matchMode`, `termMatch`, `bodyCoverage` and a freshness block.
- `symbol` — exact indexed symbol lookup through the AST/database identity path; returns
  the complete record set with byte bounds and per-match freshness, paged when `limit`
  is given.
- `file` — current source retrieval for one indexed project-relative file, bounded to
  100,000 characters, with `contentLength`/`truncated` and a file-scoped freshness block.

`regex: true` is the only regex surface, and the caller's pattern is data matched against
indexed names — never a parser for source text.

## Declared bounds

Every answer names its match set: `totalMatches` (whole set) and `returned` (page) with
`truncated`/`truncationReason`; `symbols` mode carries the same facts on its final
machine-readable match-set line. Candidate scans, content phases, regex scans (20,000
names) and regex matching (2,000 ms, worker-enforced) are bounded, and a bounded answer is
declared bounded rather than presented as complete.

`limit` is 0–2000: 0 returns no rows, above 2000 is refused rather than clamped. Options a
mode cannot honour are refused with the accepted set named; `exact` + `regex` is refused;
an invalid pattern is a named `InvalidRegexError`; unknown `language`/`symbolKind` values
are errors naming the indexed vocabulary.

## Freshness

Stale/missing files are flagged per row and in the freshness block, never dropped.
`symbols`/`content`/`symbol` auto-refresh the stale files they touch within a bounded
budget and declare it in `autoRefresh`; `refresh: false` or `BB_NO_AUTO_REFRESH=1` opts
out. `file` mode never auto-refreshes and says so; its remediation names the manual
reindex command.

A content read does not create schema in the index database: the durable trigram search
index is built by maintenance, and a query's ranking table lives in the connection's temp
schema.

## Verification evidence

Evidence documents are produced by the shared M13 harness:

- `validation/m13/results/s1.json` — `script/verify-search-modes.ts`
- `validation/m13/results/s2.json` — `script/m13/verify-search-e2e.ts`
- `validation/m13/results/s3.json` — `script/m13/verify-search-corpus.ts`
- `validation/m13/results/s4.json` — `script/m13/verify-search-honesty.ts`

Behavioural m15 gate: `script/m15/verify-search-complete.ts` (exits non-zero on any failed
check; `BB_M15_PLANT_FAILURE=1` exercises that path deliberately).

Regex allowlist edge cases: `validation/tools/bb_search/work/regex-edge-tests.ts`
(`npx tsx validation/tools/bb_search/work/regex-edge-tests.ts`).

The focused mode gate and the transport checks:

```bash
bun script/verify-search-modes.ts
bun script/verify-cli-surface.ts
bun script/verify-mcp.ts
```

## Explicit limitations

- Search does not prove an analyzer found every valid symbol or relationship.
- Content mode covers the indexed symbol corpus, not arbitrary raw-file text; `bodyCoverage`
  states how much of the corpus carries a searchable body.
- Regex mode is a bounded symbol-name scan, not a file-content search.
- File mode requires the file to be indexed; it reports stale source rather than pretending
  the index is current.
