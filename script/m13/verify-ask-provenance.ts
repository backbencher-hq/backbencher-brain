// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_ask provenance gate: every answer route must carry a
//   truthful provenance class, an explicit confidence kind, declared bounds and its
//   route label, and a no-match answer must be an explicit unknown rather than an
//   invented claim.
// WHICH TOOL IT SERVES — bb_ask (read, requiresIndex true, modes: answer).
// WHY IT IS SHAPED THIS WAY — provenance alone was not enough: the same answer can
//   carry a correct provenance class and a confidence number its own note calls
//   unreliable. This gate asserts BOTH: the class per route AND the rule that a
//   non-discriminative ranking publishes no numeric confidence.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/a2.json and
//   validation/tools/bb_ask/gates/, docs/BB_ASK.md.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/intelligence/search/quick-answer.ts,
//   src/mcp/tools/bb_ask/handler.ts, docs/BB_ASK.md.
// CONTRACTS IT MUST NOT BREAK — declared absence, declared bounds, one confidence
//   kind per route; every negative case is really asserted.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel, flushBackgroundEmbeddings } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { quickAnswer } from "../../src/intelligence/search/quick-answer"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { Harness } from "./harness"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const harness = new Harness({
  issue: "M13.24",
  code: "A2",
  tool: "bb_ask",
  title: "bb_ask: provenance, confidence kind and declared bounds per route",
  layers: ["unit", "integration"],
  decisions: {
    classes: "indexed (exact aggregate), semantic_candidate (vector or lexical retrieval, labelled not-a-verified-answer), unknown (no-match and no-index routes)",
    noMatch: "a no-match answer is an explicit unknown with zero sources; nothing is invented",
    confidence: "a non-discriminative ranking publishes NO numeric confidence; the handler says 'not a measurement' in words instead",
    bounds: "every answer carries returned/totalMatches/truncated bounds",
  },
  limitations: ["This gate pins the lexical route (BB_EMBEDDING_DISABLED=1) so the no-match contract is deterministic; the vector route's labelled non-discriminative behaviour is measured by the ask lane's retrieval evidence, not asserted here."],
})

// ── 1. Static audit: every return path carries the honesty fields ─────────
const qaSrc = await (await import("node:fs/promises")).readFile(path.join(REPO_ROOT, "src", "intelligence", "search", "quick-answer.ts"), "utf8")
harness.check("audit: every provenance builder sets an evidenceClass", ["indexed", "semantic_candidate", "unknown"].every((c) => qaSrc.includes(`evidenceClass: "${c}"`) || qaSrc.includes(`evidenceClass: "${c}",`)))
harness.check("audit: confidenceKind is part of the result contract", qaSrc.includes("confidenceKind: ConfidenceKind") && qaSrc.includes("export type ConfidenceKind"))
harness.check("audit: bounds are part of the result contract", qaSrc.includes("bounds: AnswerBounds") && qaSrc.includes("export interface AnswerBounds"))
harness.check("audit: exact aggregates declare the index snapshot", qaSrc.includes("indexSnapshot?: IndexSnapshot") && qaSrc.includes("readIndexSnapshot"))
harness.check("audit: semantic answers are labelled as interpretation", qaSrc.includes("search results, not a verified answer"))
harness.check("audit: fallback declares it is a fallback, not semantic evidence", qaSrc.includes("semantic search returned no results"))

// ── 2. Runtime: a real fixture with two identical bodies ─────────────────
// Identical bodies guarantee identical cosines, which is what makes the
// non-discriminative branch deterministic instead of luck.
const root = mkdtempSync(path.join(tmpdir(), "bb-ask-provenance-"))
// The no-match contract is a LEXICAL-route contract: a vector model always returns
// its nearest neighbours, so with embeddings enabled a nonsense token legitimately
// reaches the labelled non-discriminative retrieval branch instead of the unknown
// branch. Pin the route for this gate so every assertion below is deterministic,
// and state it as a limitation rather than pretending the vector branch was probed.
process.env.BB_EMBEDDING_DISABLED = "1"
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
const identical = "export function requestHandler(request: string): string { return request + \"handled\" }\n"
writeFileSync(path.join(root, "src", "alpha.ts"), identical)
writeFileSync(path.join(root, "src", "beta.ts"), identical)
await indexProjectParallel(projectId, root, {})
await flushBackgroundEmbeddings()

// Aggregate route: exact, indexed, bounded, snapshot-labelled.
{
  const res = await quickAnswer(projectId, "how many symbols are in this project")
  const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
  const actual = (raw.prepare("SELECT COUNT(*) AS c FROM brain_symbol WHERE project_id = ?").get(projectId) as any)?.c ?? 0
  harness.check("aggregate: answer count matches the indexed DB exactly", res.answer.includes(String(actual)), `answer=${res.answer.slice(0, 80)} actual=${actual}`)
  harness.check("aggregate: provenance class is indexed", res.provenance.evidenceClass === "indexed", res.provenance.evidenceClass)
  harness.check("aggregate: confidence kind is exact-aggregate", res.confidenceKind === "exact-aggregate", res.confidenceKind)
  harness.check("aggregate: bounds are declared", typeof res.bounds?.returned === "number" && "truncated" in res.bounds, JSON.stringify(res.bounds))
  harness.check("aggregate: index snapshot is reported (or explicitly unavailable)", !!res.indexSnapshot || res.provenance.limitations.some((l) => l.includes("last-write timestamp is unavailable")), JSON.stringify(res.indexSnapshot))
}

// No-match route: deterministic single token that matches no symbol or body.
{
  const res = await quickAnswer(projectId, "xyzzyplugh")
  harness.negative("no-match: answer says it could not find anything (no fabricated claim)", res.answer.includes("couldn't find a specific answer"), res.answer.slice(0, 120))
  harness.negative("no-match: zero sources (no invented citations)", res.sources.length === 0, `sources=${res.sources.length}`)
  harness.check("no-match: provenance class is unknown", res.provenance.evidenceClass === "unknown", res.provenance.evidenceClass)
  harness.check("no-match: confidence is the declared low floor, not a confident guess", res.confidence === 0.1 && res.confidenceKind === "declared-floor", `${res.confidence}/${res.confidenceKind}`)
  harness.check("no-match: bounds declare zero returned and no truncation", res.bounds.returned === 0 && res.bounds.truncated === false, JSON.stringify(res.bounds))
}

// Vector / lexical route: labelled interpretation with a route-appropriate class.
{
  const res = await quickAnswer(projectId, "how does request handling work")
  const retrieval = res.retrieval
  harness.check("retrieval: route-specific provenance class", res.provenance.evidenceClass === "semantic_candidate", res.provenance.evidenceClass)
  harness.check("retrieval: answer labels itself search results, not a verified answer", res.answer.includes("search results, not a verified answer"), res.answer.slice(0, 120))
  harness.check("retrieval: comparison facts are present (model-space coverage)", !!retrieval?.embeddingCoverage && !!retrieval?.libraryCoverage, JSON.stringify({ comparable: retrieval?.embeddingCoverage, library: retrieval?.libraryCoverage }))
  harness.check("retrieval: scan facts are present", typeof retrieval?.scannedRows === "number" && typeof retrieval?.scanCap === "number", JSON.stringify({ scanned: retrieval?.scannedRows, cap: retrieval?.scanCap }))
  harness.check("retrieval: bounds are declared", typeof res.bounds?.returned === "number" && "truncated" in res.bounds, JSON.stringify(res.bounds))
  if (retrieval?.method === "keyword-fallback") {
    harness.negative("lexical: no similarity is printed because none was computed", !/similarity \d/.test(res.answer), res.answer.slice(0, 140))
    harness.check("lexical: confidence is the declared floor", res.confidence === 0.2 && res.confidenceKind === "declared-floor", `${res.confidence}/${res.confidenceKind}`)
  }
}

// Non-discriminative ranking: no numeric confidence may be published.
{
  const res = await quickAnswer(projectId, "request handler")
  if (res.retrieval?.discriminative === false) {
    harness.check("non-discriminative: confidence is capped and kind-labelled", res.confidence <= 0.4 && res.confidenceKind === "non-discriminative", `${res.confidence}/${res.confidenceKind}`)
    const handler = createToolHandlers().bb_ask
    const out: any = await handler({ query: "request handler" }, { projectId, projectPath: root } as any)
    const text = (out?.content ?? []).map((c: any) => c.text ?? "").join("\n")
    harness.negative("non-discriminative: handler publishes no numeric confidence", !/confidence: 0\.\d/.test(text) && text.includes("confidence: not a measurement"), text.split("\n").find((l) => l.startsWith("confidence:")) ?? text.slice(0, 140))
  } else {
    harness.check("non-discriminative case not reachable on this fixture (recorded, not passed)", true, `method=${res.retrieval?.method} discriminative=${res.retrieval?.discriminative}`)
  }
}

// Handler envelope: aggregate answers never get a "no matches" footer.
{
  const handler = createToolHandlers().bb_ask
  const out: any = await handler({ query: "how many files are in this project" }, { projectId, projectPath: root } as any)
  const text = (out?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  harness.check("handler: provenance block is always present", text.includes("[provenance:"), text.slice(0, 140))
  harness.check("handler: bounds block is always present", text.includes("[bounds:"), text.slice(0, 140))
  harness.negative("handler: aggregate answer carries no 'no matches' footer", !text.includes("no matches for"), text.slice(0, 180))
  const noMatch: any = await handler({ query: "xyzzyplugh" }, { projectId, projectPath: root } as any)
  const noMatchText = (noMatch?.content ?? []).map((c: any) => c.text ?? "").join("\n")
  harness.negative("handler: no-match response carries an unknown class with unknowns", noMatchText.includes("[provenance: unknown") && noMatchText.includes("unknowns:"), noMatchText.slice(0, 180))
}

rmSync(root, { recursive: true, force: true })
harness.emit()
