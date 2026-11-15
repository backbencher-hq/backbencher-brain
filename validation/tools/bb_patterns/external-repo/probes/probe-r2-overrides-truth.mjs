// bb_tests/bb_patterns/probes/probe-r2-overrides-truth.mjs
// R2 — GROUND TRUTH for the symbols that only an `overrides` edge claims are used.
//
// This is the one decision in the previous round that rested on an unverified
// label, and upstream (60eb13ef) now discloses that overrides is:
//
//   * derived by nothing in Kotlin's case, and
//   * 65.2% wrong on real code in the measured corpus, filed under a
//     "heuristicUnexplained" counter so it never shows up as unexplained, and
//   * adjudicated by NO oracle, because a per-file oracle cannot check a guess
//     that fires precisely when the declaring ancestor is out of file.
//
// Adding `overrides` to bb_patterns' usage set means: if an overrides edge is
// wrong, a genuinely dead symbol is silently suppressed and the tool reports
// nothing. The cost of that error is invisible; the benefit is one fewer false
// positive. So the decision needs evidence that is stronger than "the edge
// exists".
//
// This probe is deliberately tiny and uses the SOURCE TEXT as the oracle, not
// another index query. The index cannot adjudicate its own label; a text search
// for the declaration's name in the whole repository can. If a symbol whose
// only usage evidence is an overrides edge has its name appear in a call, a
// type position, or a definition elsewhere in the tree, the edge was right. If
// the name appears NOWHERE but its own declaration, the edge was wrong and the
// symbol was a real orphan that bb_patterns is currently hiding.

import path from "node:path"
import { createRequire } from "node:module"
import { readFileSync, readdirSync, statSync } from "node:fs"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const [pid, root] = process.argv.slice(2)
const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })
const NON_USAGE = new Set(["contains", "exports"])

// every source file, so the oracle is the tree and not the index
const SRC_EXT = new Set([".rb", ".rs", ".py", ".ts", ".js", ".lua", ".clj", ".go", ".java", ".kt", ".c", ".cpp", ".cs", ".php", ".ex", ".erl", ".pl", ".sh"])
const texts = []
;(function walk(dir) {
  for (const e of readdirSync(dir)) {
    if (e === ".git" || e === "node_modules" || e === "target" || e === "vendor") continue
    const p = path.join(dir, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p)
    else if (SRC_EXT.has(path.extname(e)) && st.size < 2_000_000) {
      try { texts.push(readFileSync(p, "utf8")) } catch {}
    }
  }
})(root)
console.log(`oracle: ${texts.length} source files under ${root}`)

// Which resolved targets have an overrides edge and NO other non-bookkeeping
// usage edge?
const typesByTarget = new Map()
for (const r of db.prepare("SELECT relationship_type rt, target_symbol_id t FROM brain_relationship WHERE project_id=? AND target_symbol_id IS NOT NULL").all(pid)) {
  if (NON_USAGE.has(r.rt)) continue
  if (!typesByTarget.has(r.t)) typesByTarget.set(r.t, new Set())
  typesByTarget.get(r.t).add(r.rt)
}
const overridesOnly = [...typesByTarget].filter(([, t]) => t.has("overrides") && t.size === 1).map(([id]) => id)
console.log(`symbols whose ONLY usage evidence is an overrides edge: ${overridesOnly.length}\n`)

if (!overridesOnly.length) {
  console.log("Nothing to adjudicate on this corpus: every overrides target also has other usage evidence,")
  console.log("so `overrides` in the usage set cannot be the sole reason a candidate is suppressed.")
  process.exit(0)
}

// `?` placeholders, not string interpolation: the first version inlined the ids
// between quotes and passed `pid` as the only bind value, so a query with an
// inlined IN-list has zero placeholders to bind and better-sqlite3 throws
// "Too many parameter values". The project id is bound; the id list is
// parameterised like any other data.
const rows = db.prepare(
  `SELECT s.id, s.name, s.symbol_type st, f.relative_path p FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
    WHERE s.project_id = ? AND s.id IN (${overridesOnly.map(() => "?").join(",")})`
).all(pid, ...overridesOnly)

let corroborated = 0, uncorroborated = 0
for (const r of rows) {
  // The oracle: the declaration's own name, anywhere else in the tree.
  // `declOnly` counts how many files mention it; 1 means only its own file,
  // which for a method means it is invoked (or overridden) from within that
  // file and the cross-file claim is unsupported.
  let files = 0, occurrences = 0
  for (const t of texts) {
    const n = t.split(r.name).length - 1
    if (n > 0) { files++; occurrences += n }
  }
  const verdict = files <= 1 ? "UNSUPPORTED — the name appears only in its own file" : "CORROBORATED — the name appears in other files"
  if (files <= 1) uncorroborated++; else corroborated++
  console.log(`  ${r.st.padEnd(10)} ${r.name.padEnd(34)} ${r.p.padEnd(44)} files=${String(files).padStart(3)} occ=${String(occurrences).padStart(4)}  ${verdict}`)
}
console.log(`\ncorroborated by the source text : ${corroborated}`)
console.log(`unsupported by the source text  : ${uncorroborated}`)
console.log(
  uncorroborated === 0
    ? "\nVERDICT: KEEP overrides in the usage set — every overrides-only target is corroborated by the source."
    : `\nVERDICT: ${uncorroborated} of ${overridesOnly.length} overrides-only targets have no corroboration in the source text. Each is a candidate bb_patterns is currently SUPPRESSING on an edge the upstream review says has no oracle.`
)
db.close()
