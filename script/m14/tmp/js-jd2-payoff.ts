// How much would the JD2 strategy actually buy? Measured against a real
// production index rather than a hand-made one. (2026-09-27)
import * as fs from "fs"
import * as path from "path"
import Database from "better-sqlite3"
import {
  buildImportResolutionIndex, planImportResolutions,
  type ImportTargetRow,
} from "../../../src/ast/import-resolution"

const DATA = process.env.BB_DATA_DIR ?? `${process.env.HOME}/.bb`

async function main() {
  const projectsRoot = path.join(DATA, "projects")
  const dirs = fs.readdirSync(projectsRoot).map((d) => path.join(projectsRoot, d))
    .filter((d) => fs.existsSync(path.join(d, "brain.db")))

  // pick the project with the most javascript import edges
  let best: { db: string; n: number; pid: string } | null = null
  for (const d of dirs) {
    let db: Database.Database
    try { db = new Database(path.join(d, "brain.db"), { readonly: true }) } catch { continue }
    try {
      const r = db.prepare(
        `SELECT count(*) c FROM brain_relationship WHERE relationship_type='imports' AND target_external LIKE '%:%'`,
      ).get() as any
      if (r && r.c > 0 && (!best || r.c > best.n)) {
        const p = db.prepare(`SELECT project_id FROM brain_file LIMIT 1`).get() as any
        best = { db: path.join(d, "brain.db"), n: r.c, pid: p?.project_id ?? "" }
      }
    } catch { /* skip */ } finally { db.close() }
  }
  if (!best) { console.log("no project with colon-form import edges found under", DATA); return }

  const db = new Database(best.db, { readonly: true })
  const pid = best.pid
  console.log(`project ${pid}  colon-form import edges: ${best.n}`)

  const files = (db.prepare(`SELECT id AS fileId, relative_path AS relativePath FROM brain_file WHERE project_id=?`).all(pid) as any[])
  const symbols = (db.prepare(`SELECT id AS symbolId, file_id AS fileId, name AS name FROM brain_symbol WHERE project_id=?`).all(pid) as any[])
  const imports = (db.prepare(`SELECT file_id AS fileId, import_path AS importPath FROM brain_import WHERE project_id=?`).all(pid) as any[])
  const rows = (db.prepare(
    `SELECT id, target_external AS target_external, source_external AS source_external
     FROM brain_relationship WHERE project_id=? AND relationship_type='imports' AND target_symbol_id IS NULL`,
  ).all(pid) as ImportTargetRow[])

  console.log(`files=${files.length} symbols=${symbols.length} brain_import=${imports.length} unresolvedImportEdges=${rows.length}`)

  // Build the export surface exactly as resolveImportTargets does, so the
  // measurement reflects the shipped gate rather than a permissive one.
  const exportRows = db.prepare(
    `SELECT source_external AS src, target_external AS tgt, target_symbol_id AS sym
       FROM brain_relationship WHERE project_id=? AND relationship_type='exports' AND target_external IS NOT NULL`,
  ).all(pid) as any[]
  const byBase = new Map<string, string[]>()
  for (const f of files as any[]) {
    const tail = String(f.relativePath).split("/").pop() ?? f.relativePath
    const stem = tail.includes(".") ? tail.slice(0, tail.lastIndexOf(".")) : tail
    const arr = byBase.get(stem) ?? []
    arr.push(f.fileId)
    byBase.set(stem, arr)
  }
  const symFile = new Map<string, string>()
  for (const sy of symbols as any[]) symFile.set(sy.symbolId, sy.fileId)
  const exports: Array<{ fileId: string; name: string }> = []
  for (const er of exportRows) {
    if (!er.sym) continue
    const fileId = symFile.get(er.sym)
    if (!fileId) continue
    const cands = byBase.get(er.src ?? "") ?? []
    if (cands.length === 1 && cands[0] === fileId) exports.push({ fileId, name: er.tgt })
  }
  console.log(`export rows=${exportRows.length} usable surface entries=${exports.length}`)
  const index = buildImportResolutionIndex(files as any[], symbols as any[], imports as any[], exports)
  const t0 = Date.now()
  const plan = planImportResolutions(rows, index)
  const ms = Date.now() - t0

  const byVia = new Map<string, number>()
  for (const p of plan) byVia.set(p.via, (byVia.get(p.via) ?? 0) + 1)

  const unresolved = rows.length
  console.log(`\nplan: ${plan.length} of ${unresolved} unresolved import edges become resolvable (${((plan.length / Math.max(1, unresolved)) * 100).toFixed(1)}%)  in ${ms}ms`)
  for (const [k, v] of byVia) console.log(`   ${String(v).padStart(6)}  via ${k}`)

  // what stays unresolved, and why
  const planned = new Set(plan.map((p) => p.id))
  const reasons = new Map<string, number>()
  for (const r of rows) {
    if (planned.has(r.id)) continue
    const t = r.target_external ?? ""
    const i = t.lastIndexOf(":")
    const item = i > 0 ? t.slice(i + 1) : "(no colon)"
    let why: string
    if (item === "*") why = "namespace/star — no single target symbol"
    else if (i <= 0) why = "no colon in target"
    else {
      const p = t.slice(0, i)
      const tg = index.pathTargets.get(p)
      if (!tg || tg.size === 0) why = `specifier not internal here (${p.slice(0, 40)})`
      else if (tg.size > 1) why = `ambiguous — names ${tg.size} files`
      else {
        const ex = index.exportsByFile.get([...tg][0])
        why = !ex ? "no export surface recorded for the target file"
          : ex.has(item) ? `no symbol "${item.slice(0, 30)}" in the named file`
          : `"${item.slice(0, 30)}" is not exported by the target (local-binding name)`
      }
    }
    reasons.set(why.split("(")[0].trim(), (reasons.get(why.split("(")[0].trim()) ?? 0) + 1)
  }
  console.log(`\nstill unresolved, by reason:`)
  for (const [k, v] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`   ${String(v).padStart(6)}  ${k}`)
  }
  db.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
