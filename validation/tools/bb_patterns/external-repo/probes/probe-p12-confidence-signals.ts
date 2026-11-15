// bb_tests/bb_patterns/probes/probe-p12-confidence-signals.ts
// P12 — which evidence terms actually predict a false positive?
//
// The confidence score added in this revision contains three claims about how
// much the index can prove. Two of them were asserted, not measured:
//
//   +0.10  the name is unique in the reporting scope      (name channel decisive)
//   -0.10  the name is ambiguous
//   +0.05  the symbol's FILE has no incoming cross-file reference
//   -0.05  the symbol's file IS referenced cross-file
//
// The last one is the one that matters. The top finding on backbencher,
// src/ast/project-health.ts:13 computeAndStoreProjectHealth, is a false
// positive: the file is statically imported at src/ast/parallel-indexer.ts:22
// and called via `await import("./project-health")` at :4208 and :4611, and the
// index holds one relationship for the symbol — its own `exports` edge.
//
// P11 already rejected the `exports` signal (on the one corpus that can answer
// it, exported candidates are LESS likely to be false positives: 1.0% vs 7.7%),
// so that avenue is closed. This file measures the two file-reachability
// signals that remain, per corpus, and reports the direction of each. A term
// that does not separate the classes is removed from the score rather than kept
// because it reads plausibly.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const { detectOrphans } = await import(path.join(REPO, "src/intelligence/patterns/orphans.ts"))

const REPOS = [
  ["backbencher", "818db37d8f54173ad1357ab24627373da2e9418c"],
  ["rake", "46899d917deda24dd6a87aa99272878828b5cc94"],
  ["rebar3", "f213db69a303c1cc62a974e69eaeb81d6f2da47d"],
  ["ripgrep", "98957b6e63fb89df308a2d264c8e4d86a0eebf9a"],
  ["lodash", "d039ac4f840b536081414d0fc287a1e3fd7e80ee"],
  ["clojure", "78cdd571a4cbfa21b686996fbb9167230d68fea0"],
  ["clyde", "833a9b16d03d794e6d3c93c6faace310b2fab523"],
  ["luarocks", "59a0901a13fcda04595a0813f3770598b4b9f633"],
  ["mojo", "ca5208e8e9ec7e310da7a799655bf5dcdfb1a3d4"],
]
const NON_USAGE = new Set(["contains", "exports"])

const totals = {
  fileRef: { yes: [0, 0], no: [0, 0] },   // [FP, total]
  fileImported: { yes: [0, 0], no: [0, 0] },
  nameUnique: { yes: [0, 0], no: [0, 0] },
}

console.log("repo           | file referenced by an edge | file named by an import | name unique in scope")
console.log("               |   n   FP%                  |   n   FP%                |   n   FP%")
for (const [label, pid] of REPOS) {
  const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })
  const fileOfSym = new Map(db.prepare("SELECT id, file_id f FROM brain_symbol WHERE project_id=?").all(pid).map((r) => [r.id, r.f]))
  const files = db.prepare("SELECT id, relative_path p FROM brain_file WHERE project_id=?").all(pid)
  const fileIdByPath = new Map(files.map((r) => [r.p, r.id]))
  const stemOf = (p) => { const b = p.slice(p.lastIndexOf("/") + 1); const d = b.lastIndexOf("."); return d > 0 ? b.slice(0, d) : b }

  // files reachable by a resolved cross-file usage edge
  const refFiles = new Set()
  for (const r of db.prepare("SELECT source_symbol_id s, target_symbol_id t, relationship_type rt FROM brain_relationship WHERE project_id=? AND source_symbol_id IS NOT NULL AND target_symbol_id IS NOT NULL").all(pid)) {
    if (NON_USAGE.has(r.rt)) continue
    const tf = fileOfSym.get(r.t), sf = fileOfSym.get(r.s)
    if (tf && sf && tf !== sf) refFiles.add(tf)
  }
  // files named by an import specifier
  const importStems = new Set()
  for (const r of db.prepare("SELECT target_external e FROM brain_relationship WHERE project_id=? AND relationship_type='imports' AND target_external IS NOT NULL").all(pid)) {
    const spec = r.e.includes(":") ? r.e.slice(0, r.e.indexOf(":")) : r.e
    const b = spec.slice(spec.lastIndexOf("/") + 1)
    const d = b.lastIndexOf(".")
    importStems.add(d > 0 ? b.slice(0, d) : b)
  }

  const usedIds = new Set()
  for (const r of db.prepare("SELECT target_symbol_id t, relationship_type rt FROM brain_relationship WHERE project_id=? AND target_symbol_id IS NOT NULL").all(pid)) if (!NON_USAGE.has(r.rt)) usedIds.add(r.t)
  const usedNames = new Set()
  for (const r of db.prepare("SELECT target_external e FROM brain_relationship WHERE project_id=? AND target_external IS NOT NULL AND relationship_type NOT IN ('contains','exports')").all(pid)) {
    const a = r.e.includes(":") ? r.e.slice(r.e.lastIndexOf(":") + 1) : r.e
    const d = a.lastIndexOf(".")
    usedNames.add(d > 0 ? a.slice(d + 1) : a)
  }
  const dupProject = new Set(db.prepare("SELECT name FROM brain_symbol WHERE project_id=? GROUP BY name HAVING COUNT(*)>1").all(pid).map((r) => r.name))
  // ambiguity as the ENGINE now computes it: the reporting scope only
  const REPORTED = ["function","method","class","interface","struct","enum"]
  const dupScope = new Set(db.prepare(`SELECT name FROM brain_symbol WHERE project_id=? AND symbol_type IN (${REPORTED.map(()=>"?").join(",")}) GROUP BY name HAVING COUNT(*)>1`).all(pid, ...REPORTED).map((r) => r.name))
  const symByKey = new Map()
  for (const r of db.prepare("SELECT id, name, file_id f FROM brain_symbol WHERE project_id=?").all(pid)) {
    const k = `${r.name} ${r.f}`
    if (!symByKey.has(k)) symByKey.set(k, r.id)
  }

  const res = await detectOrphans(pid, { minConfidence: 0, maxResults: 1000000 })
  const reported = res.findings.filter((f) => f.rule !== "orphaned_file")
  const cells = { fileRef: { yes: [0, 0], no: [0, 0] }, fileImported: { yes: [0, 0], no: [0, 0] }, nameUnique: { yes: [0, 0], no: [0, 0] } }
  for (const f of reported) {
    const fid = fileIdByPath.get(f.location.file)
    const id = symByKey.get(`${f.location.symbol} ${fid ?? ""}`)
    const isFP = (id !== undefined && usedIds.has(id)) || (usedNames.has(f.location.symbol) && !dupProject.has(f.location.symbol))
    cells.fileRef[refFiles.has(fid) ? "yes" : "no"][0] += isFP ? 1 : 0
    cells.fileRef[refFiles.has(fid) ? "yes" : "no"][1]++
    const imported = importStems.has(stemOf(f.location.file))
    cells.fileImported[imported ? "yes" : "no"][0] += isFP ? 1 : 0
    cells.fileImported[imported ? "yes" : "no"][1]++
    const uniq = !dupScope.has(f.location.symbol)
    cells.nameUnique[uniq ? "yes" : "no"][0] += isFP ? 1 : 0
    cells.nameUnique[uniq ? "yes" : "no"][1]++
  }
  for (const k of Object.keys(cells)) for (const side of ["yes", "no"]) { totals[k][side][0] += cells[k][side][0]; totals[k][side][1] += cells[k][side][1] }
  const fmt = (c) => `${String(c[1]).padStart(5)} ${c[1] ? ((c[0] / c[1]) * 100).toFixed(1).padStart(5) : "    -"}%`
  console.log(`${label.padEnd(13)} | ${fmt(cells.fileRef.yes)} / ${fmt(cells.fileRef.no)} | ${fmt(cells.fileImported.yes)} / ${fmt(cells.fileImported.no)} | ${fmt(cells.nameUnique.yes)} / ${fmt(cells.nameUnique.no)}`)
  db.close()
}

console.log("\n=== pooled over all 9 repositories (FP% is what the term must move) ===")
const fmt = (c) => `${String(c[1]).padStart(6)} ${c[1] ? ((c[0] / c[1]) * 100).toFixed(1).padStart(5) : "    -"}%`
for (const k of Object.keys(totals)) {
  const yes = totals[k].yes, no = totals[k].no
  const yp = yes[1] ? (yes[0] / yes[1]) * 100 : NaN
  const np = no[1] ? (no[0] / no[1]) * 100 : NaN
  const dir = Number.isNaN(yp) || Number.isNaN(np) ? "n/a" : yp > np ? `yes is WORSE (+${(yp - np).toFixed(1)}pp)` : `yes is better (${(yp - np).toFixed(1)}pp)`
  console.log(`  ${k.padEnd(13)} yes ${fmt(yes)}   no ${fmt(no)}   -> ${dir}`)
}
console.log("\nA term earns its place only if the two sides differ materially and consistently.")
db_close_placeholder()
function db_close_placeholder() {}
