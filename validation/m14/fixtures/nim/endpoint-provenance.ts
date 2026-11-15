/**
 * NIM ENDPOINT PROVENANCE — the answer to "external or never indexed?"
 *
 * ## Why this exists
 *
 * Two instruments walk this corpus through the same production `parseFile` and
 * agree on every edge COUNT to the digit — `census.ts` and the supervisor's
 * `script/m14/firing-check.ts` both read 267,297 — yet they DISAGREE on the
 * resolution rate of five of the ten types:
 *
 *   type          census `both`   firing-check `bothEndsResolve`
 *   calls              38.9%                  33.2%
 *   uses               99.8%                  85.8%
 *   imports            37.1%                   0.0%
 *   exports             3.7%                   0.0%
 *   instantiates      100.0%                  64.1%
 *
 * and agree exactly on the other five (`references` 45.6%, `extends` 71.0%,
 * `implements` 91.5%, `overrides` 100%, `contains` 99.96%).
 *
 * A disagreement between two instruments over one walk is a finding, and the
 * workstream's rule for it is explicit: "If a target is an external package or a
 * path, say that. If it is a declaration in your own corpus that you failed to
 * publish, that is a defect and you own it. These look identical in a count and
 * are opposite findings." A bare rate cannot tell them apart, so this measures.
 *
 * ## What it measures
 *
 * Per relationship type, per ENDPOINT POSITION (source and target separately,
 * because they are not the same question), every endpoint is placed in exactly
 * one bucket:
 *
 *   inFileSymbol     binds to a name / `owner.name` this file published
 *   synthetic        one of the four declared sentinels: (global), (file),
 *                    (declared-type), (module). NOT a symbol, and the graph
 *                    cannot walk out of one by name
 *   moduleStem       an `imports` target naming a module that exists on disk in
 *                    the same repository
 *   declaredInRepo   a bare name this file did not publish, but SOME file in the
 *                    same repository did — a real declaration, just not local
 *   nowhere          declared in NO file of the corpus. For Nim this is the
 *                    interesting bucket: system procs, another package's export,
 *                    a macro-generated name, or a genuine miss
 *   unknown / empty  the placeholder literals, counted apart from `nowhere`
 *
 * `declaredInRepo` is the bucket that separates the two opposite findings the
 * workstream names. A name in `nowhere` is NOT automatically a defect: Nim's
 * system module is not in this corpus, so `add`, `doAssert` and `len` are
 * correct edges to declarations that exist and were never indexed. The rate that
 * matters for the analyzer's own honesty is the share of `nowhere` that a human
 * would call a miss, and the top-name table is what makes that judgement
 * possible instead of assumed.
 *
 * ## Method
 *
 * ONE walk, `parseFile` (production, not `analyze()`), the arbiter's own file
 * set. Endpoints are buffered during the walk and classified AFTER it, because
 * `declaredInRepo` needs the corpus-wide symbol index and the index is only
 * complete at the end. 267k edges in memory is the cost of that ordering.
 *
 * READ-ONLY. Writes nothing outside its own stdout and an optional JSON path
 * passed as argv[2] (which must end in `.json`).
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

/** See `census.ts`: every count here is a function of the worker count, because
 *  the production path is non-deterministic under concurrency (doc Limitations
 *  8 / 11). 1 worker is the clean-walk setting. */
const WORKERS = Math.max(1, Number(process.env.BB_NIM_WORKERS ?? 1) || 1)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "nim"
const OUT = process.argv[2] && process.argv[2].endsWith(".json") ? process.argv[2] : null

/** The four declared sentinels, copied from `census.ts` so the two instruments
 *  cannot drift apart on what counts as synthetic. */
const SYNTHETIC_SOURCES = new Set(["(global)", "(file)", "(declared-type)", "(module)"])

/** Nim's reserved words, copied from `KEYWORD_LIKE` in the analyzer.
 *
 *  A keyword spelling can never be a declaration: Nim reserves these, and it is
 *  case- and underscore-sensitive, so `Type` and `Static` are legal distinct
 *  identifiers while `type` and `static` are not nameable at all. An edge whose
 *  endpoint is one of these is therefore a FABRICATION — a graph edge asserting a
 *  declaration that the language cannot express.
 *
 *  This list is a copy rather than an import because at the time it was written
 *  the analyzer did not export it. `fixture-nim-keyword-not-a-declaration.ts`
 *  asserts this list and the analyzer's `KEYWORD_LIKE` are the same set, so the
 *  copy cannot drift silently; the analyzer now exports `NIM_KEYWORDS` and the
 *  assertion is what keeps the two honest. */
const NIM_KEYWORDS = new Set([
  "addr", "and", "as", "bind", "block", "break", "case", "concept", "const",
  "continue", "converter", "defer", "discard", "distinct", "div", "do", "elif",
  "else", "end", "enum", "except", "export", "finally", "for", "from", "func",
  "if", "import", "in", "include", "interface", "is", "isnot", "iterator", "let",
  "macro", "method", "mixin", "mod", "nil", "not", "notin", "object", "of", "or",
  "out", "proc", "ptr", "raise", "ref", "return", "shl", "shr", "static",
  "template", "try", "tuple", "type", "using", "var", "when", "while", "xor",
  "yield",
])

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
]

// ───────────────────────────────────────────────────────────── corpus walk
const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, dir, rel, abs })
  }
}

const moduleStemsByRepo = new Map<string, Set<string>>()
for (const f of files) {
  const set = moduleStemsByRepo.get(f.repo) ?? new Set<string>()
  set.add(path.basename(f.rel).replace(/\.(nim|nims|nimble)$/i, ""))
  for (const seg of f.rel.replace(/\.(nim|nims|nimble)$/i, "").split("/")) if (seg) set.add(seg)
  moduleStemsByRepo.set(f.repo, set)
}

// ───────────────────────────────────────────────────────────── the buffers
type Endpoint = { t: string; src: string; tgt: string; repo: string; rel: string }
const buffered: Endpoint[] = []
/** names published per repo, and corpus-wide, for the `declaredInRepo` test */
const namesByRepo = new Map<string, Set<string>>()
const namesGlobal = new Set<string>()
/** per-file published names, so `inFileSymbol` needs no second pass */
const inFile = new Map<string, Set<string>>()

let symbolsTotal = 0
let keywordNamedSymbols = 0
const keywordSymbolExamples: string[] = []
let parsed = 0
let failed = 0
const errFiles: string[] = []

const sha = (rel: string): string =>
  createHash("sha256").update(readFileSync(path.join(process.cwd(), rel))).digest("hex").slice(0, 16)

const ANALYZER_REL = "src/ast/real-nim-analyzer.ts"
const before = sha(ANALYZER_REL)

let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
      parsed++
    } catch {
      failed++
      if (errFiles.length < 20) errFiles.push(`${f.repo}/${f.rel}`)
      continue
    }
    const key = `${f.repo}/${f.rel}`
    const mine = inFile.get(key) ?? new Set<string>()
    const repoNames = namesByRepo.get(f.repo) ?? new Set<string>()
    for (const s of r.symbols ?? []) {
      symbolsTotal++
      const nm = String(s.name ?? "")
      const owner = String(s.ownerName ?? "")
      // A SYMBOL whose own name is a reserved word is the same fabrication one
      // level up: it is what makes `contains`/`references` edges point at a
      // keyword. Counted separately because it is independently checkable — an
      // edge count can be argued about, a published symbol named `type` cannot.
      if (NIM_KEYWORDS.has(nm)) {
        keywordNamedSymbols++
        if (keywordSymbolExamples.length < 12) {
          keywordSymbolExamples.push(`${f.repo}/${f.rel}:${s.range?.startLine}  owner=${owner || "(none)"} name=${nm} kind=${String(s.kind ?? "")}`)
        }
      }
      if (nm.length > 0) {
        mine.add(nm)
        if (!SYNTHETIC_SOURCES.has(nm)) mine.add(nm.split(".").pop() ?? nm)
        repoNames.add(nm)
        if (!SYNTHETIC_SOURCES.has(nm)) repoNames.add(nm.split(".").pop() ?? nm)
        namesGlobal.add(nm)
        if (!SYNTHETIC_SOURCES.has(nm)) namesGlobal.add(nm.split(".").pop() ?? nm)
      }
      if (owner && nm) { mine.add(`${owner}.${nm}`); repoNames.add(`${owner}.${nm}`) }
    }
    inFile.set(key, mine)
    namesByRepo.set(f.repo, repoNames)
    for (const rel of r.relationships ?? []) {
      const t = String(rel?.type ?? "")
      if (!ALL_TYPES.includes(t)) continue
      buffered.push({
        t,
        src: String(rel?.source ?? ""),
        tgt: String(rel?.target ?? ""),
        repo: f.repo, rel: f.rel,
      })
    }
  }
}

// ─────────────────────────────────────────────────────────────── classify
type Bucket = "inFileSymbol" | "synthetic" | "keyword" | "moduleStem" | "declaredInRepo" | "nowhere" | "unknown" | "empty"
type Tally = Record<Bucket, number>

const newTally = (): Tally => ({
  inFileSymbol: 0, synthetic: 0, keyword: 0, moduleStem: 0, declaredInRepo: 0,
  nowhere: 0, unknown: 0, empty: 0,
})

/** ORDER IS THE MEASUREMENT. `keyword` is tested BEFORE `inFileSymbol`, because a
 *  file that publishes a symbol named `type` has itself the defect — resolving the
 *  endpoint against that symbol would score the fabrication as a success. */
const classify = (ep: string, t: string, repo: string, mine: Set<string>): Bucket => {
  if (ep.length === 0) return "empty"
  if (ep === "unknown") return "unknown"
  if (SYNTHETIC_SOURCES.has(ep)) return "synthetic"
  if (NIM_KEYWORDS.has(ep)) return "keyword"
  if (mine.has(ep)) return "inFileSymbol"
  if (t === "imports") {
    const stems = moduleStemsByRepo.get(repo)
    if (stems && (stems.has(ep) || stems.has(ep.split("/").pop() ?? ep))) return "moduleStem"
  }
  const repoNames = namesByRepo.get(repo)
  if (repoNames && (repoNames.has(ep) || repoNames.has(ep.split(".").pop() ?? ep))) return "declaredInRepo"
  return "nowhere"
}

const srcTally = new Map<string, Tally>()
const tgtTally = new Map<string, Tally>()
const nowhereNames = new Map<string, Map<string, number>>()
for (const t of ALL_TYPES) { srcTally.set(t, newTally()); tgtTally.set(t, newTally()); nowhereNames.set(t, new Map()) }

// ───────────────────────────────────────────────────────────────── report
await Promise.all(Array.from({ length: WORKERS }, () => worker()))

for (const e of buffered) {
  const key = `${e.repo}/${e.rel}`
  const mine = inFile.get(key) ?? new Set<string>()
  const s = classify(e.src, e.t, e.repo, mine)
  const g = classify(e.tgt, e.t, e.repo, mine)
  srcTally.get(e.t)![s]++
  tgtTally.get(e.t)![g]++
  if (g === "nowhere") {
    const m = nowhereNames.get(e.t)!
    if (m.size < 4000) m.set(e.tgt, (m.get(e.tgt) ?? 0) + 1)
  }
}

const after = sha(ANALYZER_REL)
const w = (s: string, n: number): string => String(s).padEnd(n)
const lpad = (s: string, n: number): string => String(s).padStart(n)
const pct = (a: number, b: number): string => (b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(1)}%`)

console.log("nim endpoint provenance — production parseFile over the corpus")
console.log(`analyzer    : ${ANALYZER_REL} sha256:${before}`)
console.log(`corpus root : ${CR}`)
console.log(`files       : ${files.length.toLocaleString()} (git ls-files, detectLanguageFromPath==="nim", <=512KB)`)
console.log(`workers     : ${WORKERS}  (BB_NIM_WORKERS; see Limitations 8/11)`)
console.log(`parsed      : ${parsed.toLocaleString()}   parseFile threw: ${failed}`)
console.log(`symbols     : ${symbolsTotal.toLocaleString()}   named after a Nim reserved word: ${keywordNamedSymbols}`)
console.log(`edges held  : ${buffered.length.toLocaleString()} (buffered, then classified — see the header)`)
console.log("")
console.log("SOURCE endpoints — can the graph walk OUT of this edge?")
console.log(`${w("type", 14)}${lpad("edges", 9)}${lpad("inFile", 9)}${lpad("synth", 8)}${lpad("KEYWORD", 9)}${lpad("module", 8)}${lpad("inRepo", 8)}${lpad("nowhere", 9)}${lpad("unkn", 6)}${lpad("empty", 7)}`)
console.log("-".repeat(95))
for (const t of ALL_TYPES) {
  const r = srcTally.get(t)!
  const tot = r.inFileSymbol + r.synthetic + r.keyword + r.moduleStem + r.declaredInRepo + r.nowhere + r.unknown + r.empty
  console.log(`${w(t, 14)}${lpad(tot, 9)}${lpad(r.inFileSymbol, 9)}${lpad(r.synthetic, 8)}${lpad(r.keyword, 9)}${lpad(r.moduleStem, 8)}${lpad(r.declaredInRepo, 8)}${lpad(r.nowhere, 9)}${lpad(r.unknown, 6)}${lpad(r.empty, 7)}`)
}
console.log("")
console.log("TARGET endpoints — can the graph walk INTO this edge?")
console.log(`${w("type", 14)}${lpad("edges", 9)}${lpad("inFile", 9)}${lpad("synth", 8)}${lpad("KEYWORD", 9)}${lpad("module", 8)}${lpad("inRepo", 8)}${lpad("nowhere", 9)}${lpad("unkn", 6)}${lpad("empty", 7)}`)
console.log("-".repeat(95))
for (const t of ALL_TYPES) {
  const r = tgtTally.get(t)!
  const tot = r.inFileSymbol + r.synthetic + r.keyword + r.moduleStem + r.declaredInRepo + r.nowhere + r.unknown + r.empty
  console.log(`${w(t, 14)}${lpad(tot, 9)}${lpad(r.inFileSymbol, 9)}${lpad(r.synthetic, 8)}${lpad(r.keyword, 9)}${lpad(r.moduleStem, 8)}${lpad(r.declaredInRepo, 8)}${lpad(r.nowhere, 9)}${lpad(r.unknown, 6)}${lpad(r.empty, 7)}`)
}
console.log("")
console.log("FABRICATIONS — an endpoint the language cannot name. These must be 0.")
{
  let edgeTotal = 0
  let srcTotal = 0
  let tgtTotal = 0
  for (const t of ALL_TYPES) {
    const s = srcTally.get(t)!
    const g = tgtTally.get(t)!
    srcTotal += s.keyword
    tgtTotal += g.keyword
    if (s.keyword + g.keyword === 0) continue
    edgeTotal += s.keyword + g.keyword
    console.log(`  ${w(t, 13)} source ${String(s.keyword).padStart(6)}   target ${String(g.keyword).padStart(6)}`)
  }
  console.log(`  ${w("TOTAL", 13)} source ${lpad(srcTotal, 6)}   target ${lpad(tgtTotal, 6)}   = ${edgeTotal} of ${buffered.length.toLocaleString()} edges (${((edgeTotal / buffered.length) * 100).toFixed(3)}%)`)
  console.log(`  symbols published under a reserved-word name : ${keywordNamedSymbols}`)
  for (const e of keywordSymbolExamples) console.log(`    ${e}`)
}
console.log("")
console.log("THE TWO OPPOSITE FINDINGS, SPLIT — `nowhere` is not automatically a defect")
console.log("  inRepo = a declaration this corpus publishes, in another file. External to THIS file, real.")
console.log("  nowhere = declared by no file in this corpus. For Nim the system module is absent, so this")
console.log("            bucket is dominated by correct edges to code that was never indexed.")
console.log(`${w("type", 14)}${lpad("tgt nowhere", 13)}${lpad("tgt inRepo", 12)}${lpad("nowhere %", 11)}${lpad("unexpl", 9)}${lpad("share", 8)}`)
console.log("-".repeat(70))
const rows: Record<string, unknown> = {}
for (const t of ALL_TYPES) {
  const g = tgtTally.get(t)!
  const total = g.inFileSymbol + g.synthetic + g.keyword + g.moduleStem + g.declaredInRepo + g.nowhere + g.unknown + g.empty
  const unexpl = g.nowhere + g.unknown + g.empty
  console.log(`${w(t, 14)}${lpad(g.nowhere, 13)}${lpad(g.declaredInRepo, 12)}${lpad(pct(g.nowhere, total), 11)}${lpad(unexpl, 9)}${lpad(pct(unexpl, total), 8)}`)
  rows[t] = { total, source: srcTally.get(t), target: g, topNowhere: [...(nowhereNames.get(t)!.entries())].sort((a, b) => b[1] - a[1]).slice(0, 20) }
}
console.log("")
console.log("Top `nowhere` TARGET names per type — the table that decides which of the two it is")
for (const t of ALL_TYPES) {
  const m = [...(nowhereNames.get(t)!.entries())].sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (m.length === 0) continue
  console.log(`  ${w(t, 13)} ${m.map(([n, c]) => `${n}(${c})`).join(" ")}`)
}
console.log("")
console.log(`analyzer sha256 after the walk : ${after}  (${before === after ? "unchanged" : "CHANGED — every number above is tied to two analyzer states"})`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    lang: LANG, corpusRoot: CR, analyzerSha256: before, analyzerStableDuringRun: before === after,
    workers: WORKERS, files: files.length, parsed, parseFileThrew: failed, symbolsTotal,
    keywordNamedSymbols, keywordSymbolExamples,
    edgesHeld: buffered.length,
    fabrications: ALL_TYPES.map(t => ({
      type: t,
      sourceKeyword: srcTally.get(t)!.keyword,
      targetKeyword: tgtTally.get(t)!.keyword,
    })).filter(r => r.sourceKeyword + r.targetKeyword > 0),
    syntheticSentinels: [...SYNTHETIC_SOURCES],
    reposPublished: [...namesByRepo.entries()].map(([k, v]) => [k, v.size]),
    distinctNamesGlobal: namesGlobal.size,
    types: rows,
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}
