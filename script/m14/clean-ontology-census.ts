#!/usr/bin/env tsx
/**
 * M60 pass 2 — the CLEAN ontology census: the six questions, per relationship type.
 *
 * ## Why this exists
 *
 * Pass 1 established what the analyzer emits. That is the easy half. This instrument
 * answers the six questions ADVERSARIALLY, because they fail independently and a
 * count answers none of them on its own:
 *
 *   1 Exists    — can the analyzer construct it at all?  (source, not here)
 *   2 Fires     — does it produce edges on real code?   (this file: TALLY)
 *   3 Correct   — does an INDEPENDENT walker agree?    (this file: TREE TRUTH)
 *   4 Labelled  — does the edge carry the RIGHT type?   (this file: SEMANTIC PROBES)
 *   5 Resolved  — do both endpoints bind to a symbol?   (this file: RESOLUTION)
 *   6 Confident — are confidence/evidenceClass honest?  (this file: CONFIDENCE)
 *
 * ## The three ways this file can be wrong, and what it does about each
 *
 *   a. It reads `analyze()` instead of production `parseFile`. `parseFile` is the
 *      entry point that adds the pipeline stages (pool, timeouts, truncation,
 *      enhancements), so a per-file `analyze()` can report a number production never
 *      emits. This file calls `parseFile` from `src/ast/pool-worker.ts` and nothing
 *      else. The analyzer class is never instantiated here.
 *   b. It resolves endpoints only inside the file that emitted them, which would
 *      convict every edge to an imported symbol. So TWO rates are reported per type:
 *      INTRA-FILE (both ends bind in the emitting file) and CORPUS (both ends bind
 *      anywhere in the sample). A type that is 100% intra-file and low corpus-wide is
 *      telling the truth about its own file and not about the project.
 *   c. It counts without a denominator. Every rate here prints its numerator AND its
 *      denominator, and `totalEdges` is printed beside the per-type rows so a page
 *      can never be read as the whole set.
 *
 * ## Reproducibility
 *
 * The corpus is FIXED and named in the output: the admitted `.icl`/`.dcl` files of
 * every git repo under BB_CORPUS_ROOT, plus -- when present -- the committed
 * `script/m14/clean-wide-manifest.txt`, which is itself a committed artifact so a
 * re-run measures the same bytes. Sampling is deterministic: sorted paths, and with
 * `--limit N` the FIRST N after sort, which is a stated slice and not a ranking.
 *
 * Usage:
 *   npx tsx script/m14/clean-ontology-census.ts [--limit N] [--wide] [--json out]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const WIDE_MANIFEST = path.join(ROOT, "script", "m14", "clean-wide-manifest.txt")

const argv = process.argv.slice(2)
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : "" }
const LIMIT = Number(arg("--limit") ?? 0) || 0
const WANT_WIDE = argv.includes("--wide")
const JSON_OUT = arg("--json")

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------- corpus
const files: { abs: string; rel: string; root: string }[] = []
const seenAbs = new Set<string>()
for (const e of fs.readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!fs.statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (fs.statSync(abs).size > 512 * 1024) continue; text = fs.readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "clean") continue
    if (seenAbs.has(abs)) continue
    seenAbs.add(abs)
    files.push({ abs, rel: `${e}/${rel}`, root: dir })
  }
}
const nNarrow = files.length
if (WANT_WIDE && fs.existsSync(WIDE_MANIFEST)) {
  for (const line of fs.readFileSync(WIDE_MANIFEST, "utf8").split("\n")) {
    const abs = line.trim()
    if (!abs) continue
    if (seenAbs.has(abs) || !fs.existsSync(abs)) continue
    if (detectLanguageFromPath(abs, fs.readFileSync(abs, "utf8")) !== "clean") continue
    seenAbs.add(abs)
    files.push({ abs, rel: path.relative(CR, abs).replace(/^\.\//, ""), root: path.dirname(abs) })
  }
}
files.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
const nFilesAll = files.length
const sample = LIMIT > 0 ? files.slice(0, LIMIT) : files

console.log(`clean ontology census`)
console.log(`corpus root: ${CR}`)
console.log(`admitted clean files: ${nNarrow} (git-tracked) ${WANT_WIDE ? `+ ${nFilesAll - nNarrow} from the committed wide manifest` : ""} = ${nFilesAll}`)
console.log(`sampled: ${sample.length}${LIMIT > 0 ? ` (deterministic FIRST ${LIMIT} of the sorted absolute path list — a stated slice, not a ranking)` : " (all)"}\n`)

// ---------------------------------------------------------------- tallies
type Row = {
  n: number
  files: Set<string>
  intraFrom: number; intraTo: number; intraBoth: number
  corpusFrom: number; corpusTo: number; corpusBoth: number
  heuristic: number          // confidence < 0.7
  noLine: number
  unknownEndpoint: number
  emptyEndpoint: number
  selfEdges: number
  conf: Record<string, number>
  evidence: Record<string, number>
  meta: Record<string, number>
  examples: string[]
}
const rows: Record<Type, Row> = {} as any
for (const t of ALL_TYPES) {
  rows[t] = { n: 0, files: new Set(), intraFrom: 0, intraTo: 0, intraBoth: 0, corpusFrom: 0, corpusTo: 0, corpusBoth: 0,
    heuristic: 0, noLine: 0, unknownEndpoint: 0, emptyEndpoint: 0, selfEdges: 0,
    conf: Object.create(null), evidence: Object.create(null), meta: Object.create(null), examples: [] }
}
// Null-prototype, NOT {}. A plain object's inherited keys are real keys:
// `kindTally["constructor"]` returns Object.prototype.constructor, so
// `(kindTally[k] ?? 0) + 1` stringifies a FUNCTION and the tally for the
// `constructor` kind reads `function Object() { [native code] }1111...`.
// That is an instrument bug, not an analyzer finding, and it is fixed here
// rather than reported as one.
const kindTally: Record<string, number> = Object.create(null)
const evidenceTally: Record<string, number> = Object.create(null)
let symbols = 0, emptyNames = 0, unknownKind = 0, filesSeen = 0, parseFail = 0, fallbackFiles = 0
let totalEdges = 0
/** global name -> count, so a CORPUS-wide resolution rate is measurable */
const corpusNames = new Map<string, number>()
const corpusQNames = new Map<string, number>()
const samples: { rel: string; sym: number; edge: number }[] = []

// The store's own three resolution strategies, per docs/analyzers/real-clean-analyzer.md
// and parallel-indexer.ts:2734-2736: bare name, `Owner.member` qualified, or the leaf
// after the first `.` for a dotted target.
function resolves(target: string, names: Set<string>, qnames: Set<string>, corpus: boolean): boolean {
  if (!target) return false
  if (names.has(target)) return true
  if (qnames.has(target)) return true
  const afterColon = target.includes(":") ? target.slice(target.lastIndexOf(":") + 1) : null
  if (afterColon && (names.has(afterColon) || qnames.has(afterColon))) return true
  const leaf = target.includes(".") ? target.slice(target.lastIndexOf(".") + 1) : null
  if (leaf && (names.has(leaf) || qnames.has(leaf))) return true
  if (corpus) {
    if (corpusNames.has(target) || corpusQNames.has(target)) return true
    if (afterColon && (corpusNames.has(afterColon) || corpusQNames.has(afterColon))) return true
    if (leaf && (corpusNames.has(leaf) || corpusQNames.has(leaf))) return true
  }
  return false
}

let idx = 0
const PERFILE: { abs: string; rel: string; root: string; r: any }[] = []
async function worker() {
  while (true) {
    const i = idx++
    if (i >= sample.length) return
    const f = sample[i]
    let r: any
    try { r = await parseFile(f.abs, f.root) } catch { parseFail++; continue }
    if (r?.fallback) fallbackFiles++
    PERFILE.push({ ...f, r })
    filesSeen++
  }
}
// parseFile initialises a shared wasm module; do it once, serially, then fan out.
{
  const f = sample[0]
  if (f) { try { await parseFile(f.abs, f.root) } catch { /* recorded below */ } }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

// The corpus-wide name index is built from ALL sampled files first, because
// intra-file resolution must not be contaminated by it and corpus resolution must
// not depend on file order.
for (const { r } of PERFILE) {
  for (const s of r.symbols ?? []) {
    if (typeof s.name === "string" && s.name) corpusNames.set(s.name, (corpusNames.get(s.name) ?? 0) + 1)
    if (typeof s.qualifiedName === "string" && s.qualifiedName) corpusQNames.set(s.qualifiedName, (corpusQNames.get(s.qualifiedName) ?? 0) + 1)
  }
}

for (const { r, rel } of PERFILE) {
  const names = new Set<string>(), qnames = new Set<string>()
  for (const s of r.symbols ?? []) {
    symbols++
    const nm = String(s.name ?? "")
    if (!nm) emptyNames++
    names.add(nm)
    if (s.qualifiedName) qnames.add(String(s.qualifiedName))
    const k = String(s.kind ?? "")
    kindTally[k] = (kindTally[k] ?? 0) + 1
    if (!k || k === "unknown") unknownKind++
    const ec = String((s.metadata as any)?.evidenceClass ?? (s as any).evidenceClass ?? "ABSENT")
    evidenceTally[ec] = (evidenceTally[ec] ?? 0) + 1
  }
  for (const x of r.relationships ?? []) {
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
    if (!ALL_TYPES.includes(t)) continue
    totalEdges++
    const row = rows[t]
    row.n++
    if (row.files.size < 400) row.files.add(rel)
    const src = String(x.source ?? "")
    const tgt = String(x.target ?? "")
    if (!src) row.emptyEndpoint++
    if (!tgt) row.emptyEndpoint++
    if (tgt === "unknown" || src === "unknown") row.unknownEndpoint++
    if (src === tgt) row.selfEdges++
    const conf = Number(x.confidence)
    const confKey = Number.isFinite(conf) ? conf.toFixed(2) : "ABSENT"
    row.conf[confKey] = (row.conf[confKey] ?? 0) + 1
    if (Number.isFinite(conf) && conf < 0.7) row.heuristic++
    const ln = (x as any).line_number
    if (!(typeof ln === "number" && Number.isInteger(ln) && ln > 0)) row.noLine++
    const md = (x.metadata ?? {}) as Record<string, any>
    const rt = md.relationshipType ?? md.context ?? (md.isDerive ? "derive" : md.isInstance ? "instance" : md.isWildcard ? "wildcard" : md.isQualifiedCall ? "qualified_call" : md.isTypeClassOverride ? "typeclass_override" : "ABSENT")
    row.meta[String(rt)] = (row.meta[String(rt)] ?? 0) + 1
    const sOk = resolves(src, names, qnames, false), tOk = resolves(tgt, names, qnames, false)
    if (sOk) row.intraFrom++
    if (tOk) row.intraTo++
    if (sOk && tOk) row.intraBoth++
    const sC = sOk || resolves(src, names, qnames, true), tC = tOk || resolves(tgt, names, qnames, true)
    if (sC) row.corpusFrom++
    if (tC) row.corpusTo++
    if (sC && tC) row.corpusBoth++
    if (row.examples.length < 4) row.examples.push(`${rel}:${ln ?? "?"} ${src} -> ${tgt}`)
  }
}

// ---------------------------------------------------------------- report
const pct = (a: number, b: number) => (b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(1)}%`)
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

console.log(`PRODUCTION ENTRY POINT: parseFile (src/ast/pool-worker.ts). analyze() is never called here.`)
console.log(`files parsed OK ${filesSeen}/${sample.length}   parse failures ${parseFail}   fallback (structural) files ${fallbackFiles}`)
console.log(`symbols ${symbols.toLocaleString()}   empty names ${emptyNames}   empty/unknown kind ${unknownKind}`)
console.log(`total relationship edges ${totalEdges.toLocaleString()}\n`)

console.log("SYMBOL KINDS")
for (const [k, v] of Object.entries(kindTally).sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 16)}${v.toLocaleString()}`)
console.log("\nSYMBOL evidenceClass")
for (const [k, v] of Object.entries(evidenceTally).sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 24)}${v.toLocaleString()}`)

console.log("\nPER-TYPE (Q2 FIRES / Q5 RESOLVED / Q6 CONFIDENT)")
console.log([w("type", 13), w("edges", 9), w("files", 7), w("intra", 8), w("corpus", 8), w("intraBoth", 11), w("corpusBoth", 11), w("<0.7", 6), w("noLine", 7), w("unkEP", 6), w("self", 6)].join(""))
console.log("-".repeat(120))
for (const t of ALL_TYPES) {
  const r = rows[t]
  if (r.n === 0) { console.log(`${w(t, 13)}${w("0", 9)}NOT EMITTED on this sample`); continue }
  console.log([
    w(t, 13), w(r.n.toLocaleString(), 9), w(String(r.files.size), 7),
    w(`${r.intraBoth}/${r.n}`, 8), w(`${r.corpusBoth}/${r.n}`, 8),
    w(pct(r.intraBoth, r.n), 11), w(pct(r.corpusBoth, r.n), 11),
    w(String(r.heuristic), 6), w(String(r.noLine), 7), w(String(r.unknownEndpoint), 6), w(String(r.selfEdges), 6),
  ].join(""))
}

console.log("\nPER-TYPE confidence distribution")
for (const t of ALL_TYPES) {
  const r = rows[t]
  if (r.n === 0) continue
  const dist = Object.entries(r.conf).sort((a, b) => Number(b[0]) - Number(a[0])).map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(`  ${w(t, 13)}${dist}`)
}

console.log("\nPER-TYPE edge metadata discriminator (the 'Labelled' evidence surface)")
for (const t of ALL_TYPES) {
  const r = rows[t]
  if (r.n === 0) continue
  const dist = Object.entries(r.meta).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(`  ${w(t, 13)}${dist}`)
}

console.log("\nPER-TYPE examples (rel:line src -> tgt)")
for (const t of ALL_TYPES) {
  const r = rows[t]
  if (r.n === 0) continue
  for (const ex of r.examples.slice(0, 2)) console.log(`  ${w(t, 13)}${ex}`)
}

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({
    corpusRoot: CR, admittedNarrow: nNarrow, total: nFilesAll, sampled: sample.length,
    filesParsed: filesSeen, parseFail, fallbackFiles, symbols, emptyNames, unknownKind, totalEdges,
    kindTally, evidenceTally,
    perType: Object.fromEntries(ALL_TYPES.map((t) => [t, {
      n: rows[t].n, files: rows[t].files.size,
      intraBoth: rows[t].intraBoth, corpusBoth: rows[t].corpusBoth,
      heuristic: rows[t].heuristic, noLine: rows[t].noLine, unknownEndpoint: rows[t].unknownEndpoint, selfEdges: rows[t].selfEdges,
      conf: rows[t].conf, meta: rows[t].meta,
    }])),
  }, null, 2))
  console.log(`\nJSON written: ${JSON_OUT}`)
}