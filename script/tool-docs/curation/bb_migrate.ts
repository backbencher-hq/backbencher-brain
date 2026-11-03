// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_migrate (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_migrate (rendered into docs/tools/bb_migrate.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_migrate.md, docs/data/public-tools.json,
//   validation/tools/bb_migrate/{GATES,LATENCY,REAL-CORPUS}.json.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_migrate/descriptor.ts,
//   src/mcp/tools/bb_migrate/handler.ts, src/intelligence/migration/**, and
//   script/m20/verify-migration-dictionary.ts (the dictionary census quoted below).
// CONTRACTS IT MUST NOT BREAK — declared bounds and truncation identities, declared
//   absence, freshness flags, byte-read-only index access, and the no-regex policy.
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: [
        "Dependency-ordered migration plans, grouped into parallel-workable waves, one plan per component named by the request",
        "Scope completeness: how much of the cited integration surface the request actually covers",
        "Cohort rollup by source file and by wave, plus the zero-indexed `cohort.wavePlan` keyed by symbol id",
        "Effort methodology with its rates published as data, library mappings by provenance, and measured risks",
        "Explicit unsupported entries with typed reasons (missing-symbol, ambiguous-symbol with candidate ids, same-language, unsupported-source, unsupported-target)",
        "Truncation split into `deduplicated` (entries that resolved to an already-planned component) and `capped` (entries the 100-entry cap dropped, named in `cappedNames`)",
        "Freshness of every plan's source file: per-plan `stale` flags, an up-front stale-plan notice in text, and the `freshness` envelope in JSON",
    ],
    errors: [
        "Missing targetLanguage",
        "A blank targetLanguage (refused: the tool will not resolve an empty language name)",
        "No symbolName, symbolNames, symbolIds or paths",
        "A blank entry in symbolNames, symbolIds or paths (refused by name: a blank entry would silently narrow the request)",
        "A path that matches no indexed file (the tool says so rather than returning an empty plan set)",
        "A symbol id that no indexed symbol carries (the tool names the id, because an id is the only unambiguous selector)",
        "No index for the project (the tool is read-only and refuses with the `bb index` remediation rather than creating one)",
        "Unknown option (the door names the accepted options)",
    ],
    limitations: [
        "Plans are estimates, not translated source; the tool does not generate, replace or compile target-language code",
        "Library mappings are advisory and unsupported routes remain explicit; an unmapped third-party library is named at confidence 0 and charged 6h of research, never claimed as supported",
        "A library with an observed import but no registered target is reported with `target: null` and `confidence: 0` — declared absence, never an invented equivalence",
        "Dependency ordering and mapping depend on the analyzer-extracted symbol and relationship graph; reflection, dynamic dispatch, or relations the grammar does not model limit the completeness of the resulting plan",
        "A request names a bounded set of components, and the cited integration surface is usually much larger: measured 98.6-99.8% out of scope on the cobra corpus for requests of 1-16 symbols. The `scope` block reports this on every result",
        "The dictionary carries 486 rows across 30 source languages and 21 target languages, covering 126 of the 630 possible source-to-target pairs (20%). Two keys (`flutter/material`, `shadcn/ui` — 4 of 486 rows, 0.8%) cannot be produced by import canonicalization at all; the audit enforces that class in both directions. A further 31 rows carry knowledge an import lookup can only reach through a specifier real source code does not write (API idioms such as `pool.query`, a framework name, 16 Flutter widget or type names, and display names with spaces) — they are kept, and this is their stated limit. Audited by script/m20/verify-migration-dictionary.ts",
    ],
    performance: "Work is bounded by the request, not by repository size. A request is capped at 100 entries, and each entry resolves to at most one component before any relationship is read, so a common name cannot expand the load: on the 6,452-file / 310,423-symbol reference index a 12-name batch loaded 844 symbols and 46,753 relationships before this rule and stays inside the 5 s read-tool budget after it. `cohort.work` reports what a call actually read, and `truncation.cappedNames` names every dropped entry.",
    safety: "Read-only, including the index open: plans are computed from a byte-read-only connection, no migrations run on a read, and the tool never creates an index. It does not generate, replace, or compile target-language source.",
    evidence: "Dependency ordering comes from indexed relationships; effort and library mappings are labelled methodology-driven estimates, with the rates published as data. Relationship line, confidence, cross-language flag, bridge mechanism and both external endpoint names are read from the index; none is synthesized.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For dependency structure use `bb_graph`; this tool produces migration plans with declared limitations."
