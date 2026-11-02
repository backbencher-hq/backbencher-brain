// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_ask door: it validates the page size, calls the answer
//   engine, and renders one text answer whose route, confidence kind, bounds,
//   comparison model and freshness markers are all stated.
// WHICH TOOL IT SERVES — bb_ask (mutability read, requiresIndex true, modes: answer).
// WHY IT IS SHAPED THIS WAY — the answer is the only surface an MCP caller sees, so
//   every qualified number must be qualified HERE:
//   • a page size outside 1..100 is refused with the door's own words (one rule,
//     two doors, same sentence) instead of being clamped into a different answer;
//   • an exact aggregate is not a match set and never gets a "no matches" footer;
//   • a keyword-fallback answer prints no similarity, because none was computed;
//   • a non-discriminative ranking prints no confidence NUMBER — the answer itself
//     says the scores do not separate candidates, so publishing their mean as
//     measured confidence would contradict the sentence beside it;
//   • `[bounds:]` states how many matches exist versus how many are shown, and
//     whether a scan or the page size cut the set;
//   • `[retrieval:]` names the model space the coverage number describes, plus the
//     library-wide coverage, the scan cap and any embedding-provider timeout.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_ask.md, docs/BB_ASK.md,
//   validation/tools/bb_ask/**, gates: npx tsx script/m13/verify-ask-honesty.ts,
//   npx tsx script/m13/verify-ask-contract.ts, npx tsx script/m13/verify-ask-docs.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_ask/descriptor.ts, the
//   answer engine src/intelligence/search/quick-answer.ts, script/tool-docs/curation/bb_ask.ts,
//   docs/tools/bb_ask.md, docs/BB_ASK.md, and those gates.
// CONTRACTS IT MUST NOT BREAK — declared bounds, declared absence, stale vs missing
//   freshness markers, read-only access, and the limit contract (1..100).
// ─────────────────────────────────────────────────────────────────────────────

import type { ToolHandler } from "../shared"
import { textResult } from "../shared"
import { quickAnswer, ASK_LIMIT_DEFAULT, ASK_LIMIT_MAX, ASK_LIMIT_MIN, ASK_LIMIT_REFUSAL, type ConfidenceKind, type QuickAnswerResult } from "../../../intelligence/search/quick-answer"

const CONFIDENCE_LABEL: Record<ConfidenceKind, string> = {
  "exact-aggregate": "exact aggregate over the index",
  "exact-symbol": "exact name lookup, not a similarity claim",
  "similarity-mean": "mean of the returned similarities, bounded 0.2–0.85",
  "non-discriminative": "capped, because the ranking cannot separate its top results",
  "declared-floor": "declared floor; no score was computed on that path",
  heuristic: "name-match heuristic",
  none: "no answer was derived",
}

function renderRetrieval(result: QuickAnswerResult): string | null {
  const facts = result.retrieval
  if (!facts) return null
  const bits: string[] = [`method=${facts.method}`, `queryModel=${facts.queryModel}`, `indexModel=${facts.indexModel}`]
  if (facts.dimension > 0) bits.push(`dimension=${facts.dimension}`)
  const coverage = facts.embeddingCoverage
  if (coverage && (coverage.symbols > 0 || coverage.embedded > 0)) {
    bits.push(
      `embeddingCoverage=${Math.round(coverage.ratio * 100)}% (${coverage.embedded}/${coverage.symbols} symbols embedded in this model space)`,
    )
  }
  const library = facts.libraryCoverage
  if (library && (library.symbols > 0 || library.embedded > 0)) {
    bits.push(`libraryCoverage=${Math.round(library.ratio * 100)}% (${library.embedded}/${library.symbols} across all models)`)
  }
  // A fallback reason belongs to the route that used the fallback; on the
  // exact-name route it describes only the neighbour scan, so it is labelled.
  if (facts.fallbackReason) {
    bits.push(facts.method === "exact-name" ? `neighbourScanReason=${facts.fallbackReason}` : `reason=${facts.fallbackReason}`)
  }
  if (facts.scannedRows != null) {
    const cap = facts.scanCap != null ? `/${facts.scanCap}` : ""
    bits.push(`scanned=${facts.scannedRows}${cap}${facts.scanCapped ? " (cap reached)" : ""}`)
  }
  if (facts.filteredRows != null && facts.filteredRows > 0) bits.push(`filtered=${facts.filteredRows}`)
  if (facts.rankedCandidates != null) bits.push(`candidates=${facts.rankedCandidates}`)
  if (facts.embeddingTimedOut) {
    bits.push(`embeddingTimeout=${facts.embeddingWaitCeilingMs ?? "?"}ms${facts.embeddingFellBackTo ? ` (fell back to ${facts.embeddingFellBackTo})` : " (no local fallback available)"}`)
  }
  if (facts.discriminative === false) {
    bits.push(`ranking=non-discriminative (${facts.nonDiscriminativeCompetitors ?? 0} within the margin of the best)`)
  }
  return `[retrieval: ${bits.join(", ")}]`
}

function renderBounds(result: QuickAnswerResult): string {
  const bounds = result.bounds
  const total = bounds.totalMatches == null ? "unknown" : String(bounds.totalMatches)
  const reason = bounds.truncated && bounds.truncationReason ? `, truncationReason=${bounds.truncationReason}` : ""
  return `[bounds: returned=${bounds.returned}, totalMatches=${total}, truncated=${bounds.truncated}${reason}]`
}

function renderIndexSnapshot(result: QuickAnswerResult): string | null {
  if (result.route !== "aggregate") return null
  const snapshot = result.indexSnapshot
  if (!snapshot || snapshot.updatedAt == null) {
    return "[index: snapshot time unavailable — the age of these counts is unknown]"
  }
  const age = snapshot.ageMs == null ? "age unknown" : `${Math.round(snapshot.ageMs / 1000)} s ago`
  return `[index: snapshot ${new Date(snapshot.updatedAt).toISOString()} (${age}); these counts describe the indexed snapshot, not the working tree]`
}

function renderProvenance(result: QuickAnswerResult): string {
  const prov = result.provenance
  const unknowns = prov.unknowns.length ? `; unknowns: ${prov.unknowns.join("; ")}` : ""
  const truncated = prov.truncated ? "; truncated: the candidate scan was capped" : ""
  return `[provenance: ${prov.evidenceClass} via ${prov.engine} (${result.route})${truncated}${unknowns}]`
}

export const handler: ToolHandler = async (args, { projectId }) => {
  // The page size is a work budget with an advertised range. Refused with the
  // door's own sentence (the shared validator refuses the same values with the
  // same words), never clamped into a different answer.
  const requested = args.limit === undefined ? ASK_LIMIT_DEFAULT : Number(args.limit)
  if (!Number.isInteger(requested) || requested < ASK_LIMIT_MIN || requested > ASK_LIMIT_MAX) {
    return textResult(ASK_LIMIT_REFUSAL, true)
  }
  const limit = requested
  const result = await quickAnswer(projectId, String(args.query), { limit })

  const parts: string[] = []
  if (result.answer) parts.push(`answer: ${result.answer}`)

  // A number the answer calls unreliable is not published as a measurement.
  if (result.confidenceKind === "non-discriminative") {
    parts.push(`confidence: not a measurement (${CONFIDENCE_LABEL["non-discriminative"]})`)
  } else {
    parts.push(`confidence: ${result.confidence} (${CONFIDENCE_LABEL[result.confidenceKind]})`)
  }

  const shown = result.sources.slice(0, limit)
  if (shown.length) {
    parts.push(shown.map((source, index) => `${index + 1}. ${source.file}:${source.line}\n   ${source.context ?? ""}`).join("\n"))
  } else if (result.route === "retrieval" || result.route === "symbol-name") {
    parts.push(`no matches for "${args.query}" in the index`)
  }

  const indexLine = renderIndexSnapshot(result)
  if (indexLine) parts.push(indexLine)
  const retrieval = renderRetrieval(result)
  if (retrieval) parts.push(retrieval)
  parts.push(renderBounds(result))
  parts.push(renderProvenance(result))
  return textResult(parts.join("\n\n"))
}
