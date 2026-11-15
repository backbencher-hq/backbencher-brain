// bb_tests/bb_patterns/probes/probe-p11-exports-signal.ts
// P11 — is `exports` usable as a confidence discount?
//
// bb_patterns now reports src/ast/project-health.ts:13
// computeAndStoreProjectHealth as the single highest-confidence orphan on the
// repository. It is NOT an orphan: it is statically imported at
// src/ast/parallel-indexer.ts:22 and called through a dynamic
// `await import("./project-health")` at :4208 and :4611. The index holds ONE
// relationship for it — the module's own `exports` edge — and no usage edge at
// all. That is an indexer coverage gap, not a property of the code.
//
// A cross-check of the other top findings:
//   src/ast/patterns.ts:88  detectOrphanedCode    — no reference anywhere in src
//   src/ast/patterns.ts:150 detectFrameworkPatterns — no reference anywhere
//   src/ast/patterns.ts:201 detectArchitecturalViolations — no reference
// So the residue is not uniform, and a tool must not present a dynamic-import
// miss with the same confidence as a genuinely dead helper.
//
// `exports` is NOT usage — docs/BB_PATTERNS.md:31-32 excludes it for good
// reason, and it is still excluded. The question here is narrower: among the
// symbols bb_patterns reports, is "the module exports it" a signal that
// distinguishes the index misses from the real orphans? If yes it belongs in
// the confidence score; if not, it must not be used at all.

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

console.log("repo           reported  exported  FP%_exported  notExported  FP%_notExported  verdict")
for (const [label, pid] of REPOS) {
  const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })

  const exportedIds = new Set(db.prepare(
    "SELECT target_symbol_id t FROM brain_relationship WHERE project_id=? AND relationship_type='exports' AND target_symbol_id IS NOT NULL").all(pid).map((r) => r.t))
  // Oracle: anything other than contains/exports points at it.
  const usedIds = new Set()
  for (const r of db.prepare("SELECT target_symbol_id t, relationship_type rt FROM brain_relationship WHERE project_id=? AND target_symbol_id IS NOT NULL").all(pid)) {
    if (!NON_USAGE.has(r.rt)) usedIds.add(r.t)
  }
  const usedNames = new Set()
  for (const r of db.prepare("SELECT target_external e, relationship_type rt FROM brain_relationship WHERE project_id=? AND target_external IS NOT NULL AND relationship_type NOT IN ('contains','exports')").all(pid)) {
    const a = r.e.includes(":") ? r.e.slice(r.e.lastIndexOf(":") + 1) : r.e
    const d = a.lastIndexOf(".")
    usedNames.add(d > 0 ? a.slice(d + 1) : a)
  }
  const dup = new Set(db.prepare("SELECT name FROM brain_symbol WHERE project_id=? GROUP BY name HAVING COUNT(*)>1").all(pid).map((r) => r.name))
  const syms = new Map()
  for (const r of db.prepare("SELECT id, name, file_id f FROM brain_symbol WHERE project_id=?").all(pid)) {
    const k = `${r.name} ${r.f}`
    if (!syms.has(k)) syms.set(k, r.id)
  }
  const fileIds = new Map(db.prepare("SELECT id, relative_path p FROM brain_file WHERE project_id=?").all(pid).map((r) => [r.p, r.id]))

  const r = await detectOrphans(pid, { minConfidence: 0, maxResults: 1000000 })
  const reported = r.findings.filter((f) => f.rule !== "orphaned_file")
  const isFP = (f) => {
    const id = syms.get(`${f.location.symbol} ${fileIds.get(f.location.file) ?? ""}`)
    if (id !== undefined && usedIds.has(id)) return true
    return usedNames.has(f.location.symbol) && !dup.has(f.location.symbol)
  }
  const exp = reported.filter((f) => {
    const id = syms.get(`${f.location.symbol} ${fileIds.get(f.location.file) ?? ""}`)
    return id !== undefined && exportedIds.has(id)
  })
  const notExp = reported.filter((f) => !exp.includes(f))
  const fpExp = exp.filter(isFP).length
  const fpNot = notExp.filter(isFP).length
  const pctE = exp.length ? ((fpExp / exp.length) * 100).toFixed(1) : "  -"
  const pctN = notExp.length ? ((fpNot / notExp.length) * 100).toFixed(1) : "  -"
  // A discount is only justified if exported candidates are strictly worse.
  const verdict = !exp.length || !notExp.length ? "n/a" : (fpExp / exp.length > (fpNot / notExp.length) ? "exports -> discount" : "no signal, do not use")
  console.log(`${label.padEnd(13)} ${String(reported.length).padStart(8)} ${String(exp.length).padStart(9)} ${String(pctE).padStart(12)} ${String(notExp.length).padStart(12)} ${String(pctN).padStart(17)}  ${verdict}`)
  db.close()
}
