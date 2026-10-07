// VERIFY_PY10 — production-path firing check for the python lane.
//
// WHY THIS FILE EXISTS: script/m14/firing-check-v2.mjs is MASTER-owned and its
// LANES table has no python entry. MEASURED 2026-10-05:
//
//   $ cd $HOME/backbencher-brain
//   $ NFILES=200 bun script/m14/firing-check-v2.mjs VERIFY_PY10
//   FIRING-CHECK v2: no lane matches "VERIFY_PY10".
//   REAL EXIT=2
//
// It cannot be made to match: v2's ALIAS table maps the token `PY` to null
// (firing-check-v2.mjs:178), so the lane is deliberately absent. This file
// reproduces v2's METHOD — getParser -> parse -> analyze, relationship channel
// and imports[] channel reported separately, code-bearing filter — against THIS
// worktree's analyzer rather than the main checkout's. Two REPORTED differences
// from v2, both deliberate:
//   * the population is derived by walking CORPUS_ROOT for .py/.pyi (readdir,
//     no hand-written file list), and the derived population is printed;
//   * the walk is sorted, so a given NFILES is a stable sample rather than
//     whatever directory-walk order happened to produce.
//
// NO REGEX (workstream rule 1). String includes and char-code scans only.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, relative } from "node:path"

const REPO = process.env.BB_REPO || "/tmp/opencode/wt/VERIFY_PY10"
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const NFILES = Number(process.env.NFILES || 200)
const EXTS = [".py", ".pyi"]
const SKIP_DIRS = new Set([
  "node_modules", ".git", "target", "build", "dist", ".tox", "vendor",
  "__pycache__", ".mypy_cache", ".venv", "venv", "htmlcov", ".eggs",
])

// Code-bearing signals, string-includes only (v2's DEFECT 1 filter). A file must
// carry at least one. v2 refused to sample an extension with no SIGNAL entry at
// all — that guard is KEPT: a lane that accepts nothing and reports "NO CORPUS"
// reads as a missing corpus when the corpus is on disk.
const SIGNAL = ["def ", "class ", "import ", "@", "lambda "]

function codeBearing(content: string): boolean {
  for (const s of SIGNAL) if (content.includes(s)) return true
  return false
}

interface Population { all: string[]; bearing: string[]; bytes: number }

function derivePopulation(): Population {
  const all: string[] = []
  const bearing: string[] = []
  let bytes = 0
  const walk = (d: string, depth: number): void => {
    if (depth > 24) return
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(p, depth + 1)
        continue
      }
      let isPy = false
      for (const x of EXTS) if (e.name.endsWith(x)) { isPy = true; break }
      if (!isPy) continue
      let st
      try { st = statSync(p) } catch { continue }
      if (!st.isFile()) continue
      all.push(p)
      bytes += st.size
      if (st.size >= 400_000) continue
      let content = ""
      try { content = readFileSync(p, "utf8") } catch { continue }
      if (codeBearing(content)) bearing.push(p)
    }
  }
  if (!existsSync(CORPUS)) {
    console.error(`corpus root not found: ${CORPUS}`)
    process.exit(2)
  }
  walk(CORPUS, 0)
  all.sort()
  bearing.sort()
  return { all, bearing, bytes }
}

// ---------------------------------------------------------------------------

const { getParser, ASTEngine } = await import(`${REPO}/src/ast/engine.ts`)
const { RealPythonAnalyzer } = await import(`${REPO}/src/ast/real-python-analyzer.ts`)

const PROD = [...new Set(Object.values(ASTEngine.RelationshipType))]
console.log(`VERIFY_PY10 firing check   repo=${REPO}`)
console.log(`corpus=${CORPUS}`)
console.log(`production vocabulary (${PROD.length}): ${PROD.join(" ")}`)

// Sampling method, derived and reproducible. Two modes, because a sorted PREFIX
// of an alphabetically sorted walk concentrates on whichever repos sort first.
// MEASURED at NFILES=200 (the spread this script prints, not an assumption):
//   prefix  {python-corpus 115, haskell 39, aspnetcore 13, cpp-example 9, cpp-sample 9,
//            otp 5, kotlin 4, groovy 3, go-stdlib 2, kotlinx-coroutines 1}
//   stride  {python-corpus 186, swift-corpus 9, aspnetcore 1, cpp-sample 1, haskell 1,
//            otp 1, ruby 1}
// Both reach python-corpus, so neither is a coverage hole, but they are not the
// same measurement either: 44% of the prefix sample is non-python-corpus against
// 7% of the stride sample, and `haskell/testsuite/driver/*.py` is build tooling
// rather than application python. STRIDE walks the whole derived population at an
// even step, so the sample is spread over every repo in proportion to its size;
// it is the default. PREFIX is kept so the alternative is reproducible rather
// than argued about.
const MODE = (process.env.SAMPLE || "stride").toLowerCase()
const t0 = Date.now()
const pop = derivePopulation()
let sample: string[]
if (MODE === "prefix") {
  sample = pop.bearing.slice(0, NFILES)
} else if (MODE === "stride") {
  sample = []
  if (pop.bearing.length > 0) {
    const n = Math.min(NFILES, pop.bearing.length)
    for (let i = 0; i < n; i++) {
      sample.push(pop.bearing[Math.floor((i * pop.bearing.length) / n)])
    }
  }
} else {
  console.error(`SAMPLE must be "stride" or "prefix"; got "${MODE}"`)
  process.exit(2)
}
const byRepo = new Map<string, number>()
for (const f of sample) {
  const top = relative(CORPUS, f).split("/")[0]
  byRepo.set(top, (byRepo.get(top) || 0) + 1)
}
console.log(
  `\nPOPULATION (derived by readdir walk of ${CORPUS}, no hand-written list)`,
)
console.log(`  .py/.pyi files in corpus tree          : ${pop.all.length}`)
console.log(`  bytes                                  : ${pop.bytes.toLocaleString("en-US")}`)
console.log(`  code-bearing (>=1 signal, <400KB)     : ${pop.bearing.length}`)
console.log(`  sampling mode                          : ${MODE}`)
console.log(`  sample drawn (NFILES)                  : ${sample.length}`)
console.log(`  sample spread over repos               : ${JSON.stringify(Object.fromEntries([...byRepo.entries()].sort((a, b) => b[1] - a[1])))}`)
console.log(`  signals: ${JSON.stringify(SIGNAL)}`)
console.log(`  e.g. ${sample.slice(0, 3).map((f) => relative(CORPUS, f)).join("  ")}`)

const relTally = new Map<string, number>()
const filesByType = new Map<string, Set<string>>()
const confTally = new Map<string, number>()      // `${type}@${confidence}` -> n
const evTally = new Map<string, number>()        // `${type}@${evidenceClass}` -> n
const filesWithType = new Map<string, number>()  // type -> distinct files
let imports = 0
let filesWithImports = 0
let parsed = 0
let errorNodes = 0
let errorFiles = 0
let symbols = 0
let emptyNameEndpoints = 0
let placeholderEndpoints = 0
const placeholderNames = new Set(["unknown", "<unknown>", "Unknown", "global"])
let unresolvedSource = 0
let unresolvedTarget = 0
let bothResolved = 0
const unresolvedByType = new Map<string, number>()

// RESOLUTION, stated so it can be read rather than believed. Three separate
// questions, because one combined number hides which of them failed:
//   full       — the whole endpoint string is a symbol this file publishes
//   owner      — the endpoint is compound (`Class.method`, `mod:item`) and its
//                OWNER prefix names something this file publishes
//   leaf       — the last segment names something this file publishes
// `leaf` is the weakest and is the only one that can make a compound edge look
// resolved by accident: `overrides Foo.m -> Bar.m` passes on `m` alone even when
// neither `Foo` nor `Bar` is declared here. `full` and `owner` are reported
// beside it so that accident is visible rather than hidden in an aggregate.
//
// An UNRESOLVED endpoint is not automatically a defect: this analyzer is
// single-file and emits OUTGOING edges, so `calls f` where `f` is imported from
// another module resolves only when the store joins it to that module. What is
// measurable here is the within-file rate, and that is what is printed.
interface Res {
  total: number
  fullSrc: number
  fullTgt: number
  ownerSrc: number
  ownerTgt: number
  compound: number
}
const resByType = new Map<string, Res>()
const resSlot = (t: string): Res => {
  let r = resByType.get(t)
  if (!r) { r = { total: 0, fullSrc: 0, fullTgt: 0, ownerSrc: 0, ownerTgt: 0, compound: 0 }; resByType.set(t, r) }
  return r
}

const analyzer = new RealPythonAnalyzer()
const parser = await getParser("python")

for (const f of sample) {
  let content = ""
  try { content = readFileSync(f, "utf8") } catch { continue }
  let res
  try {
    const pr = await parser.parse(content, f)
    res = analyzer.analyze(pr.rootNode, content, f)
  } catch { continue }
  parsed++
  const rel = relative(CORPUS, f)
  symbols += res.symbols?.length ?? 0
  const errs = res.errors?.length ?? 0
  if (errs > 0) { errorFiles++; errorNodes += errs }
  const imps = res.imports || []
  imports += imps.length
  if (imps.length) filesWithImports++

  // Declared symbol names per file, so "does the endpoint resolve" is measurable.
  const declared = new Set<string>()
  for (const s of res.symbols || []) if (s.name) declared.add(s.name)
  const seenHere = new Set<string>()

  for (const r of res.relationships || []) {
    const t = r.relationshipType ?? r.type
    if (!t) continue
    relTally.set(t, (relTally.get(t) || 0) + 1)
    let fs = filesByType.get(t)
    if (!fs) { fs = new Set(); filesByType.set(t, fs) }
    fs.add(rel)
    if (!seenHere.has(t)) { seenHere.add(t); filesWithType.set(t, (filesWithType.get(t) || 0) + 1) }
    const ck = `${t}@${r.confidence}`
    confTally.set(ck, (confTally.get(ck) || 0) + 1)
    const ev = String((r.metadata as any)?.evidenceClass ?? "(none)")
    evTally.set(`${t}@${ev}`, (evTally.get(`${t}@${ev}`) || 0) + 1)
    const sName = String(r.source ?? "")
    const tName = String(r.target ?? "")
    if (!sName.length || !tName.length) emptyNameEndpoints++
    if (placeholderNames.has(sName) || placeholderNames.has(tName)) placeholderEndpoints++
    const ownerOf = (n: string): string => {
      const dot = n.lastIndexOf(".")
      if (dot > 0) return n.slice(0, dot)
      const colon = n.lastIndexOf(":")
      if (colon > 0) return n.slice(0, colon)
      return ""
    }
    const leafOf = (n: string): string => {
      const owner = ownerOf(n)
      return owner ? n.slice(owner.length + 1) : n
    }
    const slot = resSlot(t)
    slot.total++
    if (ownerOf(sName) || ownerOf(tName)) slot.compound++
    if (declared.has(sName)) slot.fullSrc++
    if (declared.has(tName)) slot.fullTgt++
    if (!ownerOf(sName) || declared.has(ownerOf(sName))) slot.ownerSrc++
    if (!ownerOf(tName) || declared.has(ownerOf(tName))) slot.ownerTgt++
    const sOk = declared.has(sName) || (!!ownerOf(sName) && declared.has(ownerOf(sName)))
    const tOk = declared.has(tName) || (!!ownerOf(tName) && declared.has(ownerOf(tName)))
    if (sOk && tOk) bothResolved++
    else {
      if (!sOk) unresolvedSource++
      if (!tOk) unresolvedTarget++
      unresolvedByType.set(t, (unresolvedByType.get(t) || 0) + 1)
    }
  }
}
const dt = Date.now() - t0

const fired = PROD.filter((t) => relTally.has(t))
const silent = PROD.filter((t) => !relTally.has(t))
const offEnum = [...relTally.keys()].filter((t) => !PROD.includes(t))

console.log(`\nran ${parsed}/${sample.length} sampled files in ${dt}ms; ` +
  `${symbols} symbols; ${errorNodes} ERROR/missing nodes across ${errorFiles} files\n`)

console.log("lane        types  detail")
console.log("-".repeat(96))
console.log(`PYTHON      ${String(fired.length).padStart(3)}/10  ${parsed}/${sample.length} parsed · imports[] ${imports} in ${filesWithImports} files`)
console.log(`   fired:  ${fired.join(" ") || "(none)"}`)
console.log(`   silent: ${silent.join(" ") || "(all ten)"}`)
if (offEnum.length) console.log(`   OFF-ENUM (not a production relationship type): ${offEnum.join(" ")}`)
console.log(`   imports[] channel (ParseResult.imports, types.ts ParseResult): ${imports} entries in ${filesWithImports} files`)

console.log("\nPER-TYPE TABLE  type | edges | files | confidence | evidenceClass")
console.log("-".repeat(96))
const rows = PROD.map((t) => {
  const n = relTally.get(t) || 0
  const fc = filesByType.get(t)?.size ?? 0
  const confs = [...confTally.entries()].filter(([k]) => k.startsWith(`${t}@`)).map(([, v]) => v)
  const evs = [...evTally.entries()].filter(([k]) => k.startsWith(`${t}@`)).map(([, v]) => v)
  return { t, n, fc, confs, evs }
})
for (const r of rows) {
  console.log(
    `${r.t.padEnd(13)} ${String(r.n).padStart(7)} ${String(r.fc).padStart(6)} files` +
    (r.n ? `   [${r.confs.join(", ")}]` : "   —") + (r.n ? `   [${r.evs.join(", ")}]` : ""),
  )
}

console.log("\nCONFIDENCE DETAIL (type@confidence -> count)")
for (const [k, v] of [...confTally.entries()].sort()) console.log(`  ${k.padEnd(28)} ${v}`)
console.log("\nEVIDENCECLASS DETAIL (type@evidenceClass -> count)")
for (const [k, v] of [...evTally.entries()].sort()) console.log(`  ${k.padEnd(34)} ${v}`)

console.log("\nRESOLUTION — within-file, on an OUTGOING-ONLY single-file analyzer")
console.log("  full = the whole endpoint is a symbol this file publishes")
console.log("  owner = the endpoint's owner prefix (`Class` of `Class.method`, `mod` of `mod:item`) is")
console.log("          published here, or the endpoint is not compound")
const resRows = [...resByType.entries()].sort((a, b) => b[1].total - a[1].total)
console.log(`  ${"type".padEnd(13)}${"edges".padStart(8)}${"compound".padStart(10)}${"src full".padStart(11)}${"src owner".padStart(11)}${"tgt full".padStart(10)}${"tgt owner".padStart(11)}${"both ok".padStart(9)}`)
for (const [t, r] of resRows) {
  const pct = (n: number): string => `${n} (${((100 * n) / (r.total || 1)).toFixed(1)}%)`
  const bothOk = r.total - (unresolvedByType.get(t) || 0)
  console.log(
    `  ${t.padEnd(13)}${String(r.total).padStart(8)}${String(r.compound).padStart(10)}` +
    `${pct(r.fullSrc).padStart(11)}${pct(r.ownerSrc).padStart(11)}` +
    `${pct(r.fullTgt).padStart(10)}${pct(r.ownerTgt).padStart(11)}${pct(bothOk).padStart(9)}`,
  )
}
console.log(`  overall: source not within-file ${unresolvedSource}, target not within-file ${unresolvedTarget}, both ok ${bothResolved}`)

console.log("\nR7 / STANDING RULES")
console.log(`  empty-name endpoints        : ${emptyNameEndpoints}`)
console.log(`  placeholder-literal endpoints: ${placeholderEndpoints}  (${[...placeholderNames].join(", ")})`)

const totalEdges = [...relTally.values()].reduce((a, b) => a + b, 0)
console.log(`\nTOTAL relationship edges on this sample: ${totalEdges}`)
console.log(`SCORE ${fired.length}/10 on the RELATIONSHIP channel; ` +
  `imports ${imports ? "FIRES on its own channel (imports[])" : "ABSENT from both channels"}`)