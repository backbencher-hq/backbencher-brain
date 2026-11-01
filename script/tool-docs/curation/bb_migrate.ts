// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_migrate (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_migrate (rendered into docs/tools/bb_migrate.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_migrate.md, docs/data/public-tools.json, website/src/data/tools.generated.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_migrate/descriptor.ts, src/mcp/tools/bb_migrate/handler.ts, and script/verify-tool-docs.ts (generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: ["Dependency-ordered migration plans, grouped into parallel-workable waves", "Scope completeness: how much of the cited integration surface the request actually covers", "Cohort rollup by source file and by wave", "Effort methodology, library mappings, and risks", "Explicit unsupported and truncation results, naming the symbols the cap dropped"],
    errors: ["Missing targetLanguage", "No symbolName, symbolNames or paths", "A path that matches no indexed file (the tool says so rather than returning an empty plan set)", "Unknown option"],
    limitations: ["Plans are estimates, not translated source", "Library mappings are advisory and unsupported routes remain explicit", "Dependency ordering and mapping depend on the analyzer-extracted symbol and relationship graph; edge cases that the analyzers cannot resolve (reflection, dynamic dispatch, or cross-file relations the grammar does not model) limit the completeness of the resulting plan", "Library dependencies are read from the index's per-file import rows and split into standard library, third-party, local and unclassified; a third-party library with no registered mapping is named at confidence 0 and charged 6h of research, never claimed as supported", "A request names a bounded set of symbols, and the cited integration surface is usually much larger: measured 98.6-99.8% out of scope on cobra for requests of 1-16 symbols. The `scope` block reports this on every result", "56 of 486 dictionary rows (11.5%) are not import specifiers — API idioms, a framework, Flutter widget class names, display names with a space, and a mis-keyed dart->typescript block — so they cannot be reached by an import lookup. Audited by script/m20/verify-migration-dictionary.ts"],
    performance: "Work is bounded by the requested symbols' own fan-in and fan-out, not by repository size. A request is capped at 100 symbols; the dropped names are reported in `truncation.cappedNames`.",
    safety: "Read-only. It does not generate, replace, or compile target-language source.",
    evidence: "Dependency ordering comes from indexed relationships; effort and mappings are labeled methodology-driven estimates. Relationship line, confidence, cross-language flag and bridge mechanism are read from the index; none is synthesized.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For dependency structure use `bb_graph`; this tool produces migration plans with declared limitations."
