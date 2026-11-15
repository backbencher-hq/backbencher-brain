// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_security: what an answer
// contains (the M72 stored-lead contract), which requests are refused, and the
// interpretation limits.
// WHICH TOOL IT SERVES — bb_security (rendered into docs/tools/bb_security.md and
//   docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_security.md, docs/data/public-tools.json,
//   docs/BB_SECURITY.md, src/intelligence/security/rebuild/{store,registry}.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_security/descriptor.ts,
//   src/mcp/tools/bb_security/handler.ts, script/verify-tool-docs.ts (the generator).
// CONTRACTS IT MUST NOT BREAK — the lead-instead-of-finding claim, pagination with
//   its pre-page total, the declared uninitialized state, the read/write boundary,
//   and the no-regex policy.
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: [
      "A default (live) answer read from the M72 store (`brain_security_flow`), whose first line is the demoted-claim banner `⚠️  LEXICAL TOKEN CO-OCCURRENCE — NOT DATA FLOW; NOT A VULNERABILITY FINDING`, followed by the registry tier declaration (counts printed from `src/intelligence/security/rebuild/registry.ts`), and a per-project declaration naming unsupported languages present (`not scanned by bb_security (no executable source model): …`) plus `leads tier: N language(s) present; lexical output only`",
      "A stored-lead headline and page: `security leads: N stored lead(s)` — with `(none stored for this project — declared empty, not a clean result)` when the store holds none — followed by one line per lead, `[exec|high|medium|low|unknown] lead: <vulnerability> @ <file>:<sinkLine> <- source:<sourceLine>; rule=<ruleId>; symbol=<symbol>`, plus ` [reach: a -> b]` when the engine recorded an assignment chain and `[stale]` when the file changed after indexing; a page holds at most `limit` leads (default 50, clamped to 200) starting at `offset`",
      "A pagination census line: `[leads: showing N of T; offset O; page size L; tier=leads; more available — pass offset to page]`, so a page is never read as the whole store; `no stored leads on this page` when the requested page is empty",
      "A declared uninitialized answer when the project has no M72 store yet: `security leads: engine not initialized — security engine not initialized; run bb index --post`. This is a declaration, not a clean result",
      "A `recordRun` answer: the same banner and declarations, `recorded run: <id>` with `new=`/`repeated=`/`resolved=` counts, `<N> leads recorded`, a preview of up to 20 persisted leads (`… <- source:<sourceLine>; rule=<ruleId>`), and `[recordRun: <N> lead(s) persisted; preview shows <M>]`. The persisted census (up to 50,000 leads) is what the history tables receive, never the preview",
      "A `history: true` answer: a JSON page with the persisted `runs` (bounded by `limit`, default 20), the persisted `findings` capped at 200 with `findingsTotal`/`findingsShown`/`findingsTruncated`, the state `summary` over the whole persisted set, and a `census` object",
      "A staleness footer only when a lead's file changed after indexing: `N stale, M missing of K referenced file(s)` plus the manual repair command; silence when everything is fresh",
    ],
    errors: [
      "Unavailable index — every door (MCP, CLI, library) refuses by name; a read never creates an index",
      "`limit` that is not a positive integer (it is the live page size, or the history run limit when `history: true`)",
      "`offset` that is not a non-negative integer",
      "`offset` together with `history: true` (refused: the history page has its own bounded shape)",
      "`history` together with `recordRun` (refused: they are different answers; pass one)",
      "Unknown option (rejected with the accepted set named)",
    ],
    limitations: [
      "Leads are lexical rule matches: a spec source token reaching a sink argument inside one symbol. That is not a data-flow proof, not an exploit, and not a risk verdict — validate each lead by hand",
      "The default engine is intra-symbol only: no interprocedural flow, no cross-symbol stitching and no cross-language proof. The retired token cross-product's `brain_taint_flow` table is not read by the default path; legacy analysis is reachable only with `BB_SECURITY_LEGACY=1` for one release",
      "Test files are excluded before persistence (`test_file` skip), and a language without a loaded spec stores nothing (`no_spec`); the tier declaration still names unsupported languages and says they are not scanned",
      "Constant sink arguments, comment/string text, self-token pairs and spec sanitizer/parameterized forms are excluded by the engine; a rule can still be wrong for an idiom it does not model",
      "Severity is a rule-defined lexical grade (printed as `exec`/`high`/`medium`/`low`/`unknown`); `exec` requires a command/code-execution sink with dynamic input and no sanitizer, and it is still not a risk verdict",
      "History stores leads, not a status: a persisted run's rows use the stored lead id as their fingerprint, so re-running is a repeat rather than a new record and a line move does not create one",
      "Not detected: hardcoded secrets (that rule belongs to `bb_patterns`), genuine cross-language taint, and standalone weak-crypto use (a sink with no co-located source is not a lead)",
    ],
    performance: "A live answer reads the M72 store with `limit` (default 50, clamped to 200) and `offset`, and reports the pre-page total so a capped page is declared. `recordRun` reads the store's census (up to 50,000 leads) and persists that set, so history cannot auto-resolve a lead it never looked at. A history answer bounds runs by `limit` (default 20) and caps its persisted-lead page (the `findings` array, at most 200 rows) with the true total declared. Reads open the index read-only and never reindex a file.",
    safety: "Reads are read-only: the index is opened with the driver's read-only mode, so a read runs no migrations and moves no WAL. `recordRun` is the one write — it stores analysis-history rows — and, because it opens the database for writing, it may also run the additive open-path migrations every write path runs. No source file is ever modified.",
    evidence: "Each persisted lead carries the rule id, vulnerability and severity, and an evidence object with the source and sink token matches (byte offsets relative to the symbol body and symbol-relative lines), the reaching-assignment `reachPath` when one was found, and the spec sanitizer decision. The store adds the absolute source/sink lines, the stored symbol id, language, tier and file path. The row id `sec:<projectId>:<fileId>:<ruleId>:<byteStart>:<byteEnd>` is line-number-free, so moving a function does not change a lead's identity.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For general code-quality patterns use `bb_patterns`; this tool produces lexical security leads from the spec engine's stored rows — never dataflow findings."
