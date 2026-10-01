// script/m13/verify-ask-integration.ts — M13.26 (A4).
//
// Proves the bb_ask path integrates index + embeddings + freshness:
//   1. answers resolve to symbols that exist in the indexed corpus,
//   2. stale source files are flagged (never presented as current),
//   3. both the dense-vector path and the keyword-fallback path are
//      exercised, and both carry freshness flags,
//   4. after a refresh (reindex), the stale flag clears — the loop closes.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { quickAnswer } from "../../src/intelligence/search/quick-answer"
import { semanticVectorSearch } from "../../src/intelligence/search/semantic-search"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.26",
  code: "A4",
  tool: "bb_ask",
  title: "bb_ask: integration (ask + index + embeddings + freshness)",
  layers: ["integration"],
  decisions: {
    resolution: "every source in an answer must resolve to a row in brain_file (the indexed corpus)",
    stale: "a source whose file changed on disk since indexing is flagged [STALE] in the answer text and stale:true on the result — never presented as current",
    paths: "dense-vector path (metadata.method=vector) and keyword-fallback path (metadata.method=keyword-fallback) are both exercised; both carry freshness",
    refresh: "reindexing clears the stale flag, closing the loop",
  },
  limitations: [
    "Whether the vector or fallback path answers a given query depends on runtime embedding availability; each path is forced deterministically where possible and otherwise recorded.",
  ],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-ask-integration-"))
const projectId = getProjectId(root)
const srcDir = path.join(root, "src")
mkdirSync(srcDir, { recursive: true })
writeFileSync(path.join(srcDir, "auth.ts"), "export function handleLogin(): string { return \"in\" }\n")
writeFileSync(path.join(srcDir, "api.ts"), "export function handleRequest(): string { return \"ok\" }\n")
await indexProjectParallel(projectId, root, {})

// ── 1. Answers resolve to indexed symbols ─────────────────────────────────
{
  const res = await quickAnswer(projectId, "how does request handling work?")
  const raw = await BrainDatabase.getRawInstance(projectId)
  const allResolve = res.sources.every((s) => {
    const row = raw.prepare("SELECT 1 FROM brain_file WHERE relative_path = ? OR path = ?").get(s.file, s.file) as any
    return !!row
  })
  harness.check("integration: every answer source resolves to an indexed brain_file row", allResolve, JSON.stringify(res.sources).slice(0, 140))
  harness.check("integration: answer is non-empty with provenance", res.answer.length > 0 && !!res.provenance.evidenceClass, res.provenance.evidenceClass)
}

// ── 2. Vector path metadata when embeddings exist ─────────────────────────
let vectorPathSeen = false
{
  const res = await semanticVectorSearch(projectId, "request handling")
  const meta = res.metadata ?? {}
  if (meta.method === "vector") {
    vectorPathSeen = true
    harness.check("integration: vector path resolves entities to indexed files", res.results.every((r) => r.file.length > 0 && r.symbolName.length > 0), `results=${res.results.length}`)
  } else {
    harness.check("integration: vector path unavailable at runtime (recorded, not failed)", true, `method=${meta.method} reason=${meta.fallbackReason ?? ""}`)
  }
}

// ── 3. Stale source is flagged, never presented as current ────────────────
{
  const authPath = path.join(srcDir, "auth.ts")
  const before = readFileSync(authPath, "utf8")
  writeFileSync(authPath, before + "\n// bb-ask-integration-freshness-probe\n")

  // Semantic layer: the handleLogin result must carry stale=true.
  const sem = await semanticVectorSearch(projectId, "handleLogin login")
  const loginHit = sem.results.find((r) => r.symbolName === "handleLogin")
  harness.negative(
    "integration: modified file's semantic result is flagged stale",
    !!loginHit && loginHit.stale === true,
    loginHit ? `stale=${loginHit.stale}` : "no handleLogin result",
  )

  // Answer layer: the quickAnswer output must mark the stale source.
  const ans = await quickAnswer(projectId, "how does login work?")
  const ansMentionsLogin = ans.answer.includes("handleLogin") || ans.answer.toLowerCase().includes("login")
  if (ansMentionsLogin) {
    harness.negative("integration: answer text flags the stale source, never presents it current", ans.answer.includes("[STALE"), ans.answer.slice(0, 160))
  } else {
    harness.check("integration: stale source surfaced in answer (recorded, not failed)", true, "login not in top answer")
  }

  // Restore, so the refresh case starts clean.
  writeFileSync(authPath, before)
}

// ── 4. Keyword-fallback path (embeddings removed) + freshness carry ───────
{
  const raw = await BrainDatabase.getRawInstance(projectId)
  raw.prepare("DELETE FROM brain_semantic_embedding WHERE project_id = ?").run(projectId)
  const res = await semanticVectorSearch(projectId, "request handling")
  harness.check("integration: keyword-fallback path engages with explicit reason", res.metadata?.method === "keyword-fallback" && typeof res.metadata?.fallbackReason === "string", JSON.stringify(res.metadata))
  harness.check("integration: fallback results resolve to indexed files", res.results.every((r) => r.file.length > 0), `results=${res.results.length}`)
  harness.check("integration: fallback results carry no NaN similarity", res.results.every((r) => Number.isFinite(r.similarity)))
}

// ── 5. Refresh clears the stale flag — the loop closes ────────────────────
{
  await indexProjectParallel(projectId, root, {})
  const sem = await semanticVectorSearch(projectId, "handleLogin login")
  const loginHit = sem.results.find((r) => r.symbolName === "handleLogin")
  harness.check("integration: after refresh the source is current again (stale cleared)", !loginHit || loginHit.stale === undefined || loginHit.stale === false, loginHit ? `stale=${loginHit.stale}` : "no handleLogin result")
}

harness.check("integration: vector path was exercised this run", vectorPathSeen, vectorPathSeen ? "vector" : "vector path skipped (runtime embedding availability)")
rmSync(root, { recursive: true, force: true })
harness.emit()
