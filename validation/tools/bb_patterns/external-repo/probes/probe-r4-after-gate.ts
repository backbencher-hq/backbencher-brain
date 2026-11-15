// bb_tests/bb_patterns/probes/probe-r4-after-gate.ts
// R4 — the engine's real numbers on corpora re-indexed with the current
// analyzers, so every figure in the documentation is measured rather than
// carried over from an index that no longer exists.
//
// Scored the same way as the previous rounds: a reported candidate is a provable
// false positive if something other than contains/exports points at its symbol
// id, or if its name is unambiguously named by a non-bookkeeping reference. The
// oracle is deliberately INDEPENDENT of the engine's evidence gate — it uses the
// raw relationship table, so the gate cannot mark its own homework.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const { detectOrphans } = await import(path.join(REPO, "src/intelligence/patterns/orphans.ts"))
// The tool-handler import is DEFERRED behind a flag. src/mcp/tool-handlers.ts
// pulls in src/intelligence/testing/test-intel.ts, and that file is currently
// mid-edit by another lane with duplicate `DEFAULT_MAX_LINKS` declarations — a
// parse error that fails any import chain reaching it, including this probe and
// `tsup`. The engine measurement below needs none of it.
const withHandler = process.env.R4_WITH_HANDLER === "1"
const PatternBrainTools = withHandler ? await import(path.join(REPO, "src/ast/tools.ts")) : null
const createToolHandlers = withHandler ? (await import(path.join(REPO, "src/mcp/tool-handlers.ts"))).createToolHandlers : null

const NON_USAGE = new Set(["contains", "exports"])
const REPOS = (process.argv[2] ?? "").split(",").filter(Boolean).map((s) => {
  const [pid, label] = s.split("=")
  return { pid, label: label ?? pid.slice(0, 8) }
})

let idCache: Map<string, string> | null = null

function hasId(db: any, pid: string, finding: any): string | undefined {
  if (!idCache) idCache = new Map()
  if (!idCache.size) {
    for (const r of db.prepare("SELECT id, name, file_id f FROM brain_symbol WHERE project_id=?").all(pid)) {
      const k = `${r.name} ${r.f}`
      if (!idCache.has(k)) idCache.set(k, r.id)
    }
  }
  const fileRow = db.prepare("SELECT id FROM brain_file WHERE project_id=? AND relative_path=?").get(pid, finding.location.file)
  return idCache.get(`${finding.location.symbol} ${fileRow?.id ?? ""}`)
}

console.log("repo           symCands  FP  FP%    fileCands  fileFP  fileFP%   confidences                  scannedFiles")
for (const { pid, label } of REPOS) {
  const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })
  // --- oracle, built from the RAW table so the gate cannot influence it ---
  const usedIds = new Set()
  for (const r of db.prepare("SELECT target_symbol_id t, relationship_type rt FROM brain_relationship WHERE project_id=? AND target_symbol_id IS NOT NULL").all(pid)) {
    if (!NON_USAGE.has(r.rt)) usedIds.add(r.t)
  }
  const usedNames = new Set()
  for (const r of db.prepare("SELECT target_external e FROM brain_relationship WHERE project_id=? AND target_external IS NOT NULL AND relationship_type NOT IN ('contains','exports')").all(pid)) {
    const a = r.e.includes(":") ? r.e.slice(r.e.lastIndexOf(":") + 1) : r.e
    const d = a.lastIndexOf(".")
    usedNames.add(d > 0 ? a.slice(d + 1) : a)
  }
  const dupProject = new Set(db.prepare("SELECT name FROM brain_symbol WHERE project_id=? GROUP BY name HAVING COUNT(*)>1").all(pid).map((r) => r.name))
  const fileOfSym = new Map(db.prepare("SELECT id, file_id f FROM brain_symbol WHERE project_id=?").all(pid).map((r) => [r.id, r.f]))
  const usedFiles = new Set()
  for (const r of db.prepare("SELECT source_symbol_id s, target_symbol_id t, relationship_type rt FROM brain_relationship WHERE project_id=? AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL").all(pid)) {
    if (NON_USAGE.has(r.rt)) continue
    const tf = fileOfSym.get(r.t), sf = fileOfSym.get(r.s)
    if (tf && sf && tf !== sf) usedFiles.add(tf)
  }
  const fileIdByPath = new Map(db.prepare("SELECT id, relative_path p FROM brain_file WHERE project_id=?").all(pid).map((r) => [r.p, r.id]))

  idCache = null
  const t0 = process.hrtime.bigint()
  const r = await detectOrphans(pid, { minConfidence: 0, maxResults: 1000000 })
  const ms = Number(process.hrtime.bigint() - t0) / 1e6
  const syms = r.findings.filter((f) => f.rule !== "orphaned_file")
  const files = r.findings.filter((f) => f.rule === "orphaned_file")
  const symFP = syms.filter((f) => {
    const id = hasId(db, pid, f)
    return (id !== undefined && usedIds.has(id)) || (usedNames.has(f.location.symbol) && !dupProject.has(f.location.symbol))
  })
  const fileFP = files.filter((f) => { const id = fileIdByPath.get(f.location.file); return id ? usedFiles.has(id) : false })
  const confs = [...new Set(r.findings.map((f) => Math.round(f.confidence * 100)))].sort((a, b) => a - b)
  const uv: any = (r.summary as any)?.unverifiedUsageEdges
  const ir: any = (r.summary as any)?.importResolution
  console.log(
    `${label.padEnd(13)} ${String(syms.length).padStart(8)} ${String(symFP.length).padStart(4)} ${((symFP.length / Math.max(1, syms.length)) * 100).toFixed(1).padStart(5)}  ${String(files.length).padStart(10)} ${String(fileFP.length).padStart(6)} ${((fileFP.length / Math.max(1, files.length)) * 100).toFixed(1).padStart(7)}   ${JSON.stringify(confs).padEnd(26)} ${r.summary.scannedFiles}   ${ms.toFixed(0)}ms`
  )
  console.log(`              unverified edges: ${uv ? `${uv.total} (selfLoop=${uv.byReason.selfLoop} inferred=${uv.byReason.inferred} lowConf=${uv.byReason.lowConfidence})` : "n/a"}`)
  console.log(`              imports: ${ir ? `${ir.rowsSeen} rows, ${ir.attributedToASourceFile} attributed, ${ir.unattributed} not, ${ir.resolvedToAFile} resolved, ${ir.filesClearedByImport} files cleared` : "n/a"}`)
  db.close()
}

if (!REPOS.length) { console.log("no repos given"); process.exit(0) }
if (!withHandler) { console.log("\n(handler section skipped: set R4_WITH_HANDLER=1 once src/intelligence/testing/test-intel.ts parses again)"); process.exit(0) }
const first = REPOS[0]
console.log(`\n--- what the reader actually sees, ${first.label} ---`)
{
  const h = createToolHandlers()
  for (const args of [{ scope: "orphaned" }, { scope: "all", limit: 10 }]) {
    const t0 = process.hrtime.bigint()
    const res: any = await h.bb_patterns(args, { projectId: first.pid, projectPath: REPO })
    const ms = (Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)
    console.log(`\nargs=${JSON.stringify(args)}  (${ms}ms)`)
    for (const l of (res.content?.[0]?.text ?? "").split("\n").slice(0, 16)) console.log("  " + l)
  }
}
