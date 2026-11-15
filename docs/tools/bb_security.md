<!--
Author: Muhammad Ishaq Khan

WHAT THIS DOCUMENT IS — the generated reference for bb_security: contract, input schema, returns, examples, errors, limitations, performance, safety and evidence semantics.
WHO IT IS FOR — callers of bb_security through any MCP host, the CLI (`bb tool bb_security`), or a library.
EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_security/descriptor.ts, src/mcp/tools/bb_security/handler.ts, script/tool-docs/curation/bb_security.ts; regenerate with `npx tsx script/verify-tool-docs.ts --only bb_security --write`.
-->
# `bb_security`

Lexical security lead generator over the indexed source-to-sink token pairs: SQL injection, XSS, command injection, path traversal, insecure deserialization, SSRF, open redirect and code execution. A lead is stored when a source expression reaches a dynamic sink argument in the same symbol, with the rule id, source/sink lines and the assignment reach path; parameterized/constant/comment-only/test-file cases are excluded. Reads are read-only against the index; an unindexed project is refused by name. Leads whose underlying file changed after indexing carry a staleness marker. This tool does NOT perform data-flow analysis or prove exploitability; leads require manual validation. Unsupported languages are reported as not scanned, never as a clean zero.

## Contract

- Category: `analysis`
- Mutability: `read`
- Requires index: `true`
- Modes: `findings`
- Planned modes (roadmap, not executable): `flow`, `summary`, `hotspots`
- Defaults: `{"history":false,"recordRun":false,"limit":50}`

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "history": {
      "type": "boolean",
      "description": "return persisted security history"
    },
    "recordRun": {
      "type": "boolean",
      "description": "persist this scan as an analysis run"
    },
    "limit": {
      "type": "number",
      "description": "live lead page size (default 50, max 200), or history run limit when history=true"
    },
    "offset": {
      "type": "number",
      "description": "live lead page offset (default 0); omit with history=true"
    }
  }
}
```

## Returns

- A default (live) answer read from the M72 store (`brain_security_flow`), whose first line is the demoted-claim banner `⚠️  LEXICAL TOKEN CO-OCCURRENCE — NOT DATA FLOW; NOT A VULNERABILITY FINDING`, followed by the registry tier declaration (counts printed from `src/intelligence/security/rebuild/registry.ts`), and a per-project declaration naming unsupported languages present (`not scanned by bb_security (no executable source model): …`) plus `leads tier: N language(s) present; lexical output only`
- A stored-lead headline and page: `security leads: N stored lead(s)` — with `(none stored for this project — declared empty, not a clean result)` when the store holds none — followed by one line per lead, `[exec|high|medium|low|unknown] lead: <vulnerability> @ <file>:<sinkLine> <- source:<sourceLine>; rule=<ruleId>; symbol=<symbol>`, plus ` [reach: a -> b]` when the engine recorded an assignment chain and `[stale]` when the file changed after indexing; a page holds at most `limit` leads (default 50, clamped to 200) starting at `offset`
- A pagination census line: `[leads: showing N of T; offset O; page size L; tier=leads; more available — pass offset to page]`, so a page is never read as the whole store; `no stored leads on this page` when the requested page is empty
- A declared uninitialized answer when the project has no M72 store yet: `security leads: engine not initialized — security engine not initialized; run bb index --post`. This is a declaration, not a clean result
- A `recordRun` answer: the same banner and declarations, `recorded run: <id>` with `new=`/`repeated=`/`resolved=` counts, `<N> leads recorded`, a preview of up to 20 persisted leads (`… <- source:<sourceLine>; rule=<ruleId>`), and `[recordRun: <N> lead(s) persisted; preview shows <M>]`. The persisted census (up to 50,000 leads) is what the history tables receive, never the preview
- A `history: true` answer: a JSON page with the persisted `runs` (bounded by `limit`, default 20), the persisted `findings` capped at 200 with `findingsTotal`/`findingsShown`/`findingsTruncated`, the state `summary` over the whole persisted set, and a `census` object
- A staleness footer only when a lead's file changed after indexing: `N stale, M missing of K referenced file(s)` plus the manual repair command; silence when everything is fresh

## Examples

`{}`

`{"recordRun":true}`

`{"history":true}`

## Errors

- Unavailable index — every door (MCP, CLI, library) refuses by name; a read never creates an index
- `limit` that is not a positive integer (it is the live page size, or the history run limit when `history: true`)
- `offset` that is not a non-negative integer
- `offset` together with `history: true` (refused: the history page has its own bounded shape)
- `history` together with `recordRun` (refused: they are different answers; pass one)
- Unknown option (rejected with the accepted set named)

## Limitations

- Leads are lexical rule matches: a spec source token reaching a sink argument inside one symbol. That is not a data-flow proof, not an exploit, and not a risk verdict — validate each lead by hand
- The default engine is intra-symbol only: no interprocedural flow, no cross-symbol stitching and no cross-language proof. The retired token cross-product's `brain_taint_flow` table is not read by the default path; legacy analysis is reachable only with `BB_SECURITY_LEGACY=1` for one release
- Test files are excluded before persistence (`test_file` skip), and a language without a loaded spec stores nothing (`no_spec`); the tier declaration still names unsupported languages and says they are not scanned
- Constant sink arguments, comment/string text, self-token pairs and spec sanitizer/parameterized forms are excluded by the engine; a rule can still be wrong for an idiom it does not model
- Severity is a rule-defined lexical grade (printed as `exec`/`high`/`medium`/`low`/`unknown`); `exec` requires a command/code-execution sink with dynamic input and no sanitizer, and it is still not a risk verdict
- History stores leads, not a status: a persisted run's rows use the stored lead id as their fingerprint, so re-running is a repeat rather than a new record and a line move does not create one
- Not detected: hardcoded secrets (that rule belongs to `bb_patterns`), genuine cross-language taint, and standalone weak-crypto use (a sink with no co-located source is not a lead)

## Performance

A live answer reads the M72 store with `limit` (default 50, clamped to 200) and `offset`, and reports the pre-page total so a capped page is declared. `recordRun` reads the store's census (up to 50,000 leads) and persists that set, so history cannot auto-resolve a lead it never looked at. A history answer bounds runs by `limit` (default 20) and caps its persisted-lead page (the `findings` array, at most 200 rows) with the true total declared. Reads open the index read-only and never reindex a file.

## Safety

Reads are read-only: the index is opened with the driver's read-only mode, so a read runs no migrations and moves no WAL. `recordRun` is the one write — it stores analysis-history rows — and, because it opens the database for writing, it may also run the additive open-path migrations every write path runs. No source file is ever modified.

## Evidence Semantics

Each persisted lead carries the rule id, vulnerability and severity, and an evidence object with the source and sink token matches (byte offsets relative to the symbol body and symbol-relative lines), the reaching-assignment `reachPath` when one was found, and the spec sanitizer decision. The store adds the absolute source/sink lines, the stored symbol id, language, tier and file path. The row id `sec:<projectId>:<fileId>:<ruleId>:<byteStart>:<byteEnd>` is line-number-free, so moving a function does not change a lead's identity.

## Relationship to other tools

For general code-quality patterns use `bb_patterns`; this tool produces lexical security leads from the spec engine's stored rows — never dataflow findings.

## Deep guides

- [Security leads: tiers, evidence, and what is not scanned](../BB_SECURITY.md)

## Staleness

Freshness applies to the tool's read output (no registered per-mode split). Staleness surfaces as: per-lead `[stale]` markers + counts footer naming the remediation; silent when all fresh. This tool does not auto-refresh and has no `refresh` option: a touched lead file is marked `[stale]` and the footer names the MANUAL repair — run: `bb index --changed` (or the `bb_index` tool with the project path — incremental, changed files only). Nothing is stale → silence (no remediation text). Detection uses a mtime+size fast path with a content-hash fallback: an edit that leaves both size and mtime unchanged is reported fresh without hashing (same trade-off as git's index stat-cache; accepted, documented in `src/brain/freshness.ts`).

This page is generated from the executable registry and curated documentation. Run `npm run docs:generate` to update it, or `npx tsx script/verify-tool-docs.ts --only <tool> --write` for a single page.
