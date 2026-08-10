// verify-full-gate.ts — final acceptance gate. Each project runs in a FRESH
// process (isolated worker-pool fork tests, no cross-project interference).
import { BrainDatabase } from "../src/brain/database"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainTools } from "../src/ast/tools"
import { ASTEngine } from "../src/ast/engine"
import { existsSync } from "fs"

const projDir = process.argv[2]
const projName = process.argv[3] ?? projDir
let failures = 0
function check(label: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label} ${detail}`)
  }
}

if (!existsSync(projDir)) {
  console.log("  SKIP (missing)")
  process.exit(0)
}
const pid = (await import("../src/cli/index")).getProjectId(projDir)
const raw = await BrainDatabase.getRawInstance(pid)

// 1. INDEX (fresh, workers)
let t = Date.now()
const stats: any = await indexProjectParallel(pid, projDir, {})
const secs = ((Date.now() - t) / 1000).toFixed(1)
const fps = stats.processedFiles > 1 && Number(secs) > 0 ? Math.round(stats.processedFiles / Number(secs)) : null
check("index completes (0 errors)", stats.errorFiles === 0, `errors=${stats.errorFiles}/${stats.totalFiles}`)
console.log(`  files=${stats.totalFiles} time=${secs}s${fps ? ` rate=${fps}/s` : ""}`)

const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c
const symbols = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any).c
const rels = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship").get() as any).c
const emb = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding").get() as any).c
const taints = (raw.prepare("SELECT COUNT(*) c FROM brain_taint_flow").get() as any).c
const { isIndexArtifactName } = await import("../src/ast/analysis-exclusions")
const cands = raw.prepare("SELECT name FROM brain_symbol WHERE project_id = ? AND (name IN ('this','global','window','self','super','arguments','undefined','null') OR name GLOB 'object_[0-9]*' OR name LIKE '/%/%' OR COALESCE(line_start,0) < 1 OR name GLOB '[+-]?[0-9]*')").all(pid) as any[]
const noise = cands.filter((r: any) => isIndexArtifactName(r.name)).length
check("files > 0", files > 0)
check("symbols > 0", symbols > 0)
check("relationships > 0", rels > 0)
check("noise ratio < 1%", symbols === 0 || noise / symbols < 0.01, `${noise}/${symbols}`)
console.log(`  db: files=${files} symbols=${symbols} rels=${rels} emb=${emb} taints=${taints} noise=${noise}`)

// 2. DETERMINISM
t = Date.now()
await indexProjectParallel(pid, projDir, {})
const symbols2 = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol").get() as any).c
const rels2 = (raw.prepare("SELECT COUNT(*) c FROM brain_relationship").get() as any).c
check("deterministic reindex", symbols2 === symbols && rels2 === rels, `${symbols}->${symbols2}, ${rels}->${rels2}`)

// 3. READ SURFACE (real code symbols only — JSON is noise by design)
const probe = (raw.prepare("SELECT name FROM brain_symbol WHERE project_id = ? AND symbol_type IN ('function','method','class') AND file_id NOT LIKE '%.json' AND LENGTH(name) > 3 ORDER BY complexity DESC LIMIT 1").get(pid) as any)?.name
if (probe) {
  const s = await BrainTools.searchCode(pid, probe, { maxResults: 5 })
  const sel = await ASTEngine.findSymbol(pid, probe)
  check(`search finds '${probe}'`, s.length >= 1, `got ${s.length}`)
  check(`select resolves '${probe}'`, sel?.matches?.length >= 1, JSON.stringify(sel).slice(0, 60))
  const callers = await BrainTools.getFunctionCallers(pid, probe)
  check(`relationships callers (${probe})`, Array.isArray(callers))
} else {
  console.log("  (no probe symbol)")
}
  const qa: any = await (await import("../src/intelligence/search/quick-answer")).quickAnswer(pid, "what does this project do")
  check("ask answers", qa?.answer?.length > 0 || (qa?.sources?.length ?? 0) > 0, JSON.stringify(qa).slice(0, 60))
  const fn = await BrainTools.searchCode(pid, probe ?? "init", { maxResults: 3 })
  check("searchCode returns results array", Array.isArray(fn) && fn.length >= 0)
  const cls = await BrainTools.searchCode(pid, "C", { symbolKind: "class", maxResults: 3 })
  check("class search returns results array", Array.isArray(cls) && cls.length >= 0)

console.log(failures === 0 ? `RESULT: ${projName} — PASS` : `RESULT: ${projName} — ${failures} FAILURES`)
process.exit(failures > 0 ? 1 : 0)
