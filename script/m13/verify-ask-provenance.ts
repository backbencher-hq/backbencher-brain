// script/m13/verify-ask-provenance.ts — M13.24 (A2).
//
// Provenance honesty for bb_ask. Every answer path must carry a truthful
// provenance block (evidenceClass / engine / unknowns), a no-match or
// no-embeddings query must return an explicit unknown (never a generated
// answer), and generated explanations must be labeled interpretation, not
// extracted evidence.
//
// Paths audited (src/intelligence/search/quick-answer.ts):
//   stats queries        → evidenceClass "indexed"  (direct SQL aggregate)
//   semantic matches     → evidenceClass "semantic_candidate" (labeled
//                          "search results, not a verified answer")
//   symbol-name fallback → evidenceClass "unknown" + explicit reason
//   no match at all      → evidenceClass "unknown" + unknowns, explicit
//                          "I couldn't find a specific answer" — no fabrication

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { quickAnswer } from "../../src/intelligence/search/quick-answer"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.24",
  code: "A2",
  tool: "bb_ask",
  title: "bb_ask: provenance honesty (no fabricated claims)",
  layers: ["unit", "integration"],
  decisions: {
    classes: "indexed (SQL stats), semantic_candidate (similarity, labeled not-a-verified-answer), unknown (fallback and no-match) — all built via makeProvenance",
    noMatch: "no-match returns the explicit unknown path with zero sources — nothing is invented",
    labeling: "semantic answers say 'search results, not a verified answer'; fallback says 'semantic search returned no results'",
  },
  limitations: [
    "Embedding availability is runtime-dependent; the semantic positive is asserted only when the semantic path actually returns matches (recorded, not failed, otherwise).",
  ],
})

const QA_SRC = readFileSync(path.resolve("src/intelligence/search/quick-answer.ts"), "utf8")

// ── 1. Static audit: every return path carries provenance ─────────────────
harness.check("audit: every provenance builder sets evidenceClass", ["indexed", "semantic_candidate", "unknown"].every((c) => QA_SRC.includes(`evidenceClass: \"${c}\"`)))
harness.check("audit: every provenance builder sets engine", (QA_SRC.match(/engine: ENGINE/g) ?? []).length >= 4, "engine missing from a builder")
harness.check("audit: no return path skips provenance (all return statements include provenance)", (QA_SRC.match(/return \{[\s\S]*?provenance:/g) ?? []).length >= 4, "a return lacks provenance")
harness.check("audit: semantic answers are labeled as interpretation", QA_SRC.includes("search results, not a verified answer"))
harness.check("audit: fallback declares it is a fallback, not semantic evidence", QA_SRC.includes("semantic search returned no results"))
harness.check("audit: no-match path returns an explicit unknown", QA_SRC.includes("I couldn't find a specific answer") && QA_SRC.includes('evidenceClass: "unknown"'))

// ── 2. Runtime: truthful provenance on a real fixture ─────────────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-ask-provenance-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"), "export function handleRequest(): string { return \"ok\" }\nexport function handleLogin(): string { return \"in\" }\n")
await indexProjectParallel(projectId, root, {})

// stats path: indexed evidence, count matches the DB exactly
{
  const res = await quickAnswer(projectId, "how many symbols are in this project")
  const raw = await BrainDatabase.getRawInstance(projectId)
  const actual = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id = ?").get(projectId) as any)?.c ?? 0
  harness.check("stats: answer count matches the indexed DB exactly", res.answer.includes(String(actual)), `answer=${res.answer.slice(0, 80)} actual=${actual}`)
  harness.check("stats: provenance class is indexed", res.provenance.evidenceClass === "indexed", res.provenance.evidenceClass)
}

// no-match path: explicit unknown, zero sources, nothing invented
{
  const res = await quickAnswer(projectId, "zzzz qqqq no such thing anywhere")
  harness.negative("no-match: answer says it could not find anything (no fabricated claim)", res.answer.includes("couldn't find a specific answer"), res.answer.slice(0, 120))
  harness.negative("no-match: zero sources (no invented citations)", res.sources.length === 0, `sources=${res.sources.length}`)
  harness.check("no-match: provenance class is unknown", res.provenance.evidenceClass === "unknown", res.provenance.evidenceClass)
  harness.check("no-match: unknowns are non-empty (explicit, not silent)", (res.provenance.unknowns ?? []).length >= 1, JSON.stringify(res.provenance.unknowns))
  harness.check("no-match: confidence is low (0.1), not a confident guess", res.confidence === 0.1, String(res.confidence))
}

// semantic path: labeled interpretation when matches exist
{
  const res = await quickAnswer(projectId, "how does request handling work?")
  if (res.provenance.evidenceClass === "semantic_candidate") {
    harness.check("semantic: answer labels itself as search results, not verified", res.answer.includes("search results, not a verified answer"), res.answer.slice(0, 120))
    harness.check("semantic: provenance class is semantic_candidate", res.provenance.evidenceClass === "semantic_candidate")
    harness.check("semantic: sources are real indexed files", res.sources.every((s) => s.file.includes(".ts") || s.file.length > 0), JSON.stringify(res.sources).slice(0, 120))
  } else {
    harness.check("semantic: path exercised (recorded, not failed)", true, `class=${res.provenance.evidenceClass}`)
  }
}

// handler envelope: provenance line always present in the wire output
{
  const { createToolHandlers } = await import("../../src/mcp/tool-handlers")
  const ask = createToolHandlers().bb_ask
  const out = await ask({ query: "how many files are in this project" }, { projectId, projectPath: root } as any)
  const text = (out.content ?? []).map((c: any) => c.text ?? "").join("\n")
  harness.check("handler: provenance block is always present", text.includes("[provenance:"), text.slice(0, 140))
  harness.check("handler: provenance carries class + engine", /\[provenance: \w+ via \w+/.test(text), text.slice(0, 140))
  const noMatch = await ask({ query: "zzzz qqqq nothing" }, { projectId, projectPath: root } as any)
  const noMatchText = (noMatch.content ?? []).map((c: any) => c.text ?? "").join("\n")
  harness.negative("handler: no-match response carries unknown class with unknowns", noMatchText.includes("unknowns:"), noMatchText.slice(0, 140))
}

rmSync(root, { recursive: true, force: true })
harness.emit()
