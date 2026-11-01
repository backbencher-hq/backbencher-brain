// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the curated reference text for bb_patterns (returns, errors, limitations, performance, safety, evidence).
// WHICH TOOL IT SERVES — bb_patterns (rendered into docs/tools/bb_patterns.md and docs/data/public-tools.json).
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_patterns.md, docs/data/public-tools.json, website/src/data/tools.generated.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_patterns/descriptor.ts, src/mcp/tools/bb_patterns/handler.ts, and script/verify-tool-docs.ts (generator).
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, freshness flags,
//   read/write boundary, and the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import type { CuratedToolDocumentation } from "../types"

export const curation: CuratedToolDocumentation = {
    returns: ["Pattern findings with confidence and locations", "Orphan, framework, and anti-pattern classifications", "Optional persisted run history"],
    errors: ["Invalid scope or confidence threshold", "Unavailable index", "Unknown option"],
    // Written from the measured behavior, not from the shape of the feature.
    // The previous three lines were true of every analysis tool and false in the
    // ways that matter to a reader deciding whether to delete something:
    //   * "static incoming-reference evidence, not proof" said the right thing
    //     and hid that the tool had been accepting a SELF-REFERENTIAL
    //     `overrides` row as proof of a consumer;
    //   * "heuristic and confidence-qualified" said nothing about what the
    //     confidence means or how it is derived;
    //   * nothing at all said that a finding can be a coverage gap in the
    //     analyzer rather than dead code, which is the dominant residual class.
    limitations: [
      "A finding is not a deletion instruction. The tool reports what the index does and does not record; where the index is silent, the finding says so on its face rather than presenting absence of evidence as evidence of absence.",
      "Confidence is derived from measured evidence classes, not assigned per rule. It spans 0.30-0.70 for orphans (the published cap) and 0.60-0.90 for anti-patterns. Name-unique symbols measured a 0.0% false-positive rate against a source-text oracle; ambiguous names measured 14.4%.",
      "A symbol with no ANCHORED incoming row, in a file that has one, gets the coverage-gap disclosure. The per-symbol test counts anchored rows only while the per-file test counts any row, and that asymmetry is deliberate: an unanchored row is a name match, and 97% of rake's `references` edges name no consumer, so counting them per symbol would suppress the disclosure across the whole corpus.",
      "A framework-detected finding carries a FIXED confidence of 0.6, not one derived from how much evidence supports it, and there is a consequence worth knowing before you use confidenceThreshold: asking for more than 0.6 removes every framework finding at once. Measured on ten repositories, framework findings are constant at thresholds 0, 0.5 and 0.6, and zero at 0.61, 0.7 and 0.9 — including on a project where the indexer had assigned 40 distinct framework types. The answer is not wrong, since the finding's confidence genuinely is 0.6, but a threshold intended to exclude weak findings cannot discriminate among these at all.",
      "A relationship only counts as usage evidence if it is not a self-loop, its published evidenceClass is not \"inferred\", and its confidence is at least 0.7. Refused rows are counted in `summary.unverifiedUsageEdges` and itemised on the findings they would have cleared.",
      "A finding whose symbol had no recorded incoming reference while its file did carries a COVERAGE GAP INDICATOR. That is the signature of an analyzer that reached the file and not the symbol, and such a finding may be a coverage gap rather than dead code.",
      "Dynamic dispatch, reflection, and string-keyed lookups are invisible. The engine never fabricates a resolved edge for them, so a symbol reached only that way is reported.",
      "False-positive rate is 0.0-27.8% by corpus, measured against a source-text oracle that cannot see reflection or template indirection — so the true rate is higher, and the number is a lower bound.",
      "Test files are excluded from candidates but not from evidence: a production symbol called only from a test is not reported, and a production file imported only by a test is not reported. `includeTests: true` means \"also report test symbols\", not \"ignore tests when looking for users\".",
      "Framework and anti-pattern detection is heuristic and confidence-qualified.",
    ],
    performance: "Cost is index-bound and grows with the SYMBOL count, not the relationship count: every set the scan builds is reduced in SQL, so a 223,880-symbol / 898,806-relationship repository is scanned in 32s and a 56,738-symbol one in 3.9s. Three measurements on real corpora, each with byte-identical output: the anti-pattern rules once took 330s because of a correlated COUNT and now take 0.4s; the relationship pass once shipped 710,671 rows into JS to build sets bounded by symbol count and now ships ~5,700 rows of aggregates; and the whole scan was three statements over the same rows before the coverage indicator re-read what the evidence gate had already read. `limit` bounds the displayed page; the census in the header is the full candidate count, and `raise \\`limit\\`` is named when the page is short.",
    safety: "Source is read-only. recordRun writes only analysis-history records in the brain database, and persists the whole census rather than the displayed page so the auto-resolve pass cannot mark live findings as gone.",
    evidence: "Every finding is confidence-qualified, carries an evidence array naming what was checked, and carries a limitations array. Two channels are kept distinct: an anchored edge from an identified symbol is decisive, while a name match clears a candidate only when the name is unambiguous in the reporting scope. `summary.suppressedByReason` accounts for every candidate the scan discarded, and `summary.importResolution` states how far the import channel could be carried.",
}

/** Cross-reference rendered into the `Relationship to other tools` section. */
export const relation: string = "For security-specific taint findings use `bb_security`; this tool covers orphans, framework patterns, and anti-patterns."
