// bb_tests/bb_patterns/probes/probe-r5-source-oracle.mjs
// R5 — score bb_patterns against the SOURCE TEXT, not against the index.
//
// WHY THE INDEX ORACLE IS NOT ENOUGH. R4 reported false-positive rates of 56%
// (mojo), 70% (lodash), 33% (rebar3). Those numbers are not measuring the
// engine. That oracle calls a candidate a false positive when "something other
// than contains/exports points at its symbol id" — and the thing pointing at it
// is frequently an edge this lane has just measured to be worthless:
//
//   mojo     3,626 unverified edges of 3,988 (1,386 self-loops, 2,208 below
//            0.7 confidence, 32 inferred)
//   lodash   5,670 unverified edges, 5,639 of them below 0.7 confidence and
//            published as `{"isFieldAccess":true,"bareRead":true}`, i.e. a bare
//            identifier name-matched to a symbol
//   rebar3   1,507 self-loops
//
// So R4's oracle was grading the engine against a standard the same review had
// already rejected. It cannot tell a wrong decision from a correct decision made
// on bad evidence.
//
// THE ORACLE HERE IS THE TREE. For every symbol bb_patterns reports, ask the
// source text whether some OTHER file uses that name in a consuming position —
// as a call `name(`, as a qualified access `.name` or `name.`, or as a
// declaration reference in a type/annotation position. If no file but its own
// mentions it, the "still used" verdict is the index's, not the code's.
//
// This is a MEASUREMENT INSTRUMENT, not product code. It is the only place in
// this lane that pattern-matches source text, and it is deliberately so: the
// engine cannot adjudicate its own index, and a text search can. Its own
// weakness is stated in the output — a name used only through reflection, a
// string, or a template will be missed, which makes this oracle report FEWER
// used symbols than really exist, i.e. it under-counts false positives. Every
// rate below is therefore a LOWER bound on the engine's false-positive rate, and
// the direction of that bias is fixed and known.

import path from "node:path"
import { createRequire } from "node:module"
import { readFileSync, readdirSync, statSync } from "node:fs"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const { detectOrphans } = await import(path.join(REPO, "src/intelligence/patterns/orphans.ts"))

const REPOS = (process.argv[2] ?? "").split(",").filter(Boolean).map((s) => {
  const [pid, root, label] = s.split("=")
  return { pid, root, label: label ?? path.basename(root) }
})

const SRC_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs", ".lua",
  ".ex", ".exs", ".clj", ".cljs", ".java", ".kt", ".c", ".h", ".cpp", ".cc", ".hpp",
  ".cs", ".php", ".pl", ".pm", ".sh", ".erl", ".jl", ".swift", ".scala", ".ml",
])
const SKIP_DIRS = new Set([".git", "node_modules", "target", "vendor", "dist", "build", "coverage", "__pycache__", ".tox", "vendor"])

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g
// matchAll REQUIRES the /g flag — the first version of this oracle omitted it
// and threw "String.prototype.matchAll called with a non-global RegExp" on the
// first corpus. The `g` is what makes the pattern iterate; without it there is
// nothing to match All.
const CONSUMING = /\.([A-Za-z_][A-Za-z0-9_]*)\s*[(.\[]|([A-Za-z_][A-Za-z0-9_]*)\s*\(/g

function collectSources(root) {
  const out = []
  ;(function walk(dir) {
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".") continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue }
      if (!SRC_EXT.has(path.extname(e.name))) continue
      let st
      try { st = statSync(p) } catch { continue }
      if (st.size > 3_000_000) continue
      try { out.push({ p: path.relative(root, p), text: readFileSync(p, "utf8") }) } catch {}
    }
  })(root)
  return out
}

/** name -> Set of relative paths in which the name appears in a consuming
 *  position. Built once per corpus; the per-candidate query is then O(1). */
function buildConsumptionIndex(sources) {
  const index = new Map()
  const add = (name, file) => {
    let s = index.get(name)
    if (!s) { s = new Set(); index.set(name, s) }
    s.add(file)
  }
  for (const { p, text } of sources) {
    // `foo(`, `a.foo(`, `a.foo.`, `a.foo[`
    for (const m of text.matchAll(CONSUMING)) {
      if (m[1]) add(m[1], p)
      else if (m[2]) add(m[2], p)
    }
  }
  return index
}

console.log("repo       symCands  usedElsewhere  FP%      fileCands  fileUsed  fileFP%    sources")
const summary = []
for (const { pid, root, label } of REPOS) {
  const sources = collectSources(root)
  const consumption = buildConsumptionIndex(sources)
  const report = await detectOrphans(pid, { minConfidence: 0, maxResults: 1_000_000 })
  const syms = report.findings.filter((f) => f.rule !== "orphaned_file")
  const files = report.findings.filter((f) => f.rule === "orphaned_file")

  // A text oracle cannot resolve WHICH declaration a bare `name` refers to, so
  // the first version of this check reported 35-82% false positives by counting
  // name COLLISION as usage: rake's `initialize` appears in a consuming position
  // in 20 of its 98 source files, so every class's `initialize` looked used. The
  // engine has the same ambiguity problem and answers it with a uniqueness
  // rule, so the oracle must too or it is not measuring the same question.
  //
  // A candidate is contradicted ONLY when both hold:
  //   1. its name is declared exactly once in the reporting scope, so a bare
  //      `name(` elsewhere must mean this declaration, and
  //   2. that `name(` occurs in a source file other than the declaring one.
  // Anything weaker is a collision this instrument cannot adjudicate, and
  // counting it would make the oracle worse than the thing it audits.
  const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })
  const dupNames = new Set(db.prepare(
    "SELECT name FROM brain_symbol WHERE project_id=? AND symbol_type IN ('function','method','class','interface','struct','enum') GROUP BY name HAVING COUNT(*)>1"
  ).all(pid).map((r) => r.name))
  const namesByFile = new Map()
  for (const r of db.prepare(
    "SELECT f.relative_path p, s.name n FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=? AND s.symbol_type IN ('function','method','class','interface','struct','enum')"
  ).all(pid)) {
    let set = namesByFile.get(r.p)
    if (!set) { set = new Set(); namesByFile.set(r.p, set) }
    set.add(r.n)
  }

  const usedElsewhere = syms.filter((f) => {
    if (dupNames.has(f.location.symbol)) return false
    const hit = consumption.get(f.location.symbol)
    if (!hit) return false
    for (const p of hit) if (p !== f.location.file) return true
    return false
  })
  const filesUsed = files.filter((f) => {
    const names = namesByFile.get(f.location.file)
    if (!names) return false
    for (const n of names) {
      if (dupNames.has(n)) continue
      const hit = consumption.get(n)
      if (!hit) continue
      for (const p of hit) if (p !== f.location.file) return true
    }
    return false
  })
  db.close()

  const sPct = ((usedElsewhere.length / Math.max(1, syms.length)) * 100).toFixed(1)
  const fPct = ((filesUsed.length / Math.max(1, files.length)) * 100).toFixed(1)
  console.log(
    `${label.padEnd(10)} ${String(syms.length).padStart(8)} ${String(usedElsewhere.length).padStart(14)} ${String(sPct).padStart(6)} ${String(files.length).padStart(11)} ${String(filesUsed.length).padStart(8)} ${String(fPct).padStart(8)}    ${sources.length}`
  )
  summary.push({ label, syms: syms.length, symFP: usedElsewhere.length, sPct, files: files.length, fFP: filesUsed.length, fPct, sources: sources.length })
  if (usedElsewhere.length && usedElsewhere.length <= 12) {
    console.log("            " + usedElsewhere.map((f) => `${f.location.symbol}@${f.location.file}`).join(", "))
  }
}
console.log(`
Reading: "usedElsewhere" counts reported symbols whose name appears in a
CONSUMING position (call, qualified access, subscript) in a source file other
than the one that declares them. Those are the candidates the source text
contradicts. Because this oracle cannot see reflection, string lookup, or
template indirection, it UNDER-counts real usage and therefore UNDER-counts
false positives: every rate above is a lower bound.`)
console.log("worst symbol FP rate across corpora: " + Math.max(...summary.map((s) => Number(s.sPct))).toFixed(1) + "%")
console.log("worst file   FP rate across corpora: " + Math.max(...summary.map((s) => Number(s.fPct))).toFixed(1) + "%")
