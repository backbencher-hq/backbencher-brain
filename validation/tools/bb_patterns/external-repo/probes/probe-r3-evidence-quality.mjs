// bb_tests/bb_patterns/probes/probe-r3-evidence-quality.mjs
// R3 — is "this edge is evidence of an external consumer" decidable from the row?
//
// R2 found the concrete defect: two `overrides` edges on rake point a symbol at
// ITSELF, with metadata
//
//   reasonCode: "first-parent-guess", evidenceClass: "inferred", confidence: 0.5
//
// i.e. the indexer guessed "this method overrides its own name in the parent
// class" and bb_patterns was treating that guess as proof of a consumer. This
// probe asks the general question: across every relationship type, how much of
// what the engine would read as "used" is actually
//
//   (a) a SELF-LOOP   — source_symbol_id == target_symbol_id, so the symbol is
//                       the one doing the using, not the one being used; or
//   (b) an INFERENCE  — evidenceClass "inferred", i.e. derived by a heuristic
//                       tier rather than observed; and
//   (c) LOW-CONFIDENCE — a confidence below the level the edge is published at.
//
// If a meaningful share of the usage evidence is any of those, the engine's
// "resolved target" test is not sufficient on its own, and the fix belongs in
// the evidence test rather than in a per-type exception list. The output is a
// table, and the decision is stated per type.

import path from "node:path"
import { createRequire } from "node:module"

const REPO = process.env.BB_REPO
const repoRequire = createRequire(path.join(REPO, "package.json"))
const Database = repoRequire("better-sqlite3")
const [pidArg, label] = process.argv.slice(2)
// split on "=" rather than taking argv[2] verbatim: `probe ... <pid>=rake`
// arrives as ONE argument, so destructuring argv directly made pid the whole
// "pid=rake" string and every run died looking for a project directory that
// does not exist.
const pid = pidArg.split("=")[0]
const db = new Database(path.join(process.env.BB_DATA_DIR, "projects", pid, "brain.db"), { readonly: true, fileMustExist: true })

const rows = db.prepare(
  `SELECT relationship_type rt, target_symbol_id tgt, source_symbol_id src, confidence conf, metadata md
     FROM brain_relationship
    WHERE project_id = ? AND target_symbol_id IS NOT NULL AND source_symbol_id IS NOT NULL`
).all(pid)

const byType = new Map()
for (const r of rows) {
  let ev = null, reason = null
  if (r.md) { try { const m = JSON.parse(r.md); ev = m.evidenceClass ?? null; reason = m.reasonCode ?? null } catch {} }
  const self = r.src === r.tgt
  const inferred = ev === "inferred"
  const lowConf = typeof r.conf === "number" && r.conf < 0.7
  const e = byType.get(r.rt) ?? { n: 0, self: 0, inferred: 0, lowConf: 0, clean: 0 }
  e.n++
  if (self) e.self++
  if (inferred) e.inferred++
  if (lowConf) e.lowConf++
  if (!self && !inferred && !lowConf) e.clean++
  byType.set(r.rt, e)
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + "%" : "  -")
console.log(`${label}   ${rows.length} resolved edges\n`)
console.log("type          edges   selfLoop   inferred   conf<0.7   allClean   verdict")
const order = [...byType].sort((a, b) => b[1].n - a[1].n)
for (const [rt, e] of order) {
  const cleanPct = e.n ? (e.clean / e.n) * 100 : 0
  const verdict = e.n === 0 ? "" : cleanPct >= 95 ? "trustworthy as usage" : cleanPct >= 60 ? "usable, with a stated exclusion" : "NOT trustworthy as sole usage evidence"
  console.log(
    `${rt.padEnd(12)} ${String(e.n).padStart(6)} ${String(pct(e.self, e.n)).padStart(10)} ${String(pct(e.inferred, e.n)).padStart(10)} ${String(pct(e.lowConf, e.n)).padStart(10)} ${String(pct(e.clean, e.n)).padStart(10)}   ${verdict}`
  )
}
console.log(`
Reading the columns: "selfLoop" is source==target, so the edge asserts that a
symbol is a consumer of itself. "inferred" is metadata.evidenceClass=="inferred",
the heuristic tier the upstream review (60eb13ef) says is 65.2% wrong for
overrides and has no oracle. "conf<0.7" is a published confidence below the
level the rest of the index treats as resolved. "allClean" is the share that is
none of the three.`)

// The decision, stated once, from the table above rather than per type.
const usageLike = ["calls", "instantiates", "extends", "implements", "uses", "references", "imports", "overrides"]
let tot = 0, dirty = 0
for (const [rt, e] of byType) {
  if (!usageLike.includes(rt)) continue
  tot += e.n; dirty += e.n - e.clean
}
console.log(`\nAcross the USAGE types: ${tot} edges, ${dirty} of them (${((dirty / Math.max(1, tot)) * 100).toFixed(1)}%) are a self-loop, an inference, or below 0.7 confidence.`)
console.log(dirty / Math.max(1, tot) > 0.02
  ? "DECISION: the engine must exclude those edges from usage evidence, or it will suppress real orphans on rows the index itself marks as guessed."
  : "DECISION: the volume is small enough that an exclusion is not required for correctness, but the exposure should still be stated in the finding's limitations.")
db.close()
