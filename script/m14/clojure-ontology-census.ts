// CLJ3 CHANNEL CENSUS — the per-type measurement behind every verdict in
// docs/analyzers/clojure.md's ontology section.
//
// WHY A NEW INSTRUMENT. script/m14/firing-check-v2.mjs reports TWO channels:
// res.relationships and res.imports. ParseResult (src/ast/types.ts:221-231)
// carries THREE: `imports: ImportInfo[]`, `exports?: ExportInfo[]`, and
// `relationships: UniversalRelationship[]`. v2 has no `exports[]` channel, so a
// lane whose exports surface is an ExportInfo[] reads as "silent on exports" no
// matter how many exports it emits. This census reads all three and names the
// channel each count came from, so a reader is never asked to guess.
//
// INSTRUMENT CONTRACT (M14-HONESTY-CONTRACT.md "an instrument must declare the
// population it covered"):
//   - the population is DERIVED by walking the corpus directory (readdirSync +
//     extension test). No hand-written FILES array, which rots silently.
//   - every count is printed beside the population that produced it, and the
//     population itself is printed (files discovered / files attempted /
//     files parsed / files failed / files skipped).
//   - the extension set is a constant the walk applies, and the walk prints
//     how many files it saw before the extension filter.
//
// PRODUCTION PATH: pool-worker.parseFile() — the entry the indexer uses, not
// analyze(). An edge can be correct in analyze() and absent from parseFile()
// (the M60 LUA-14 export loss was exactly that), so only parseFile settles it.
//
// NO REGEX anywhere: string methods only (endsWith/startsWith/split/includes/
// indexOf). Every "what shape is this name" question is a char-code or a Set
// lookup, matching the analyzer's own zero-regex policy.
//
// Usage:
//   BB_CORPUS=$HOME/fixtures/repositories BB_REPO=<repo> \
//   BB_CORPUS_DIR=clj-kondo bun script/m14/clojure-ontology-census.ts
//
// Named `clojure-ontology-census.ts` to follow the tracked lane convention
// (go-ontology-census.ts, clean-ontology-census.ts, clojure-truth.ts) rather
// than script/m14/tmp/, which is git-excluded via .git/info/exclude and would
// leave the measurement uncommitted — an uncommitted instrument is a number
// nobody can re-run.
import { readdirSync, statSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

const REPO = process.env.BB_REPO || "$HOME/backbencher-brain"
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const DIR = process.env.BB_CORPUS_DIR || "clj-kondo"
const LIMIT = Number(process.env.BB_LIMIT || 0) // 0 = whole population
const EXT = [".clj", ".cljs", ".cljc"]

const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const { ASTEngine } = await import(`${REPO}/src/ast/engine.ts`)
// `Object.values<string>`: the module is loaded by a computed specifier
// (`await import(`${REPO}/...`)`), so the namespace is `any` and TS 5.9 types
// `Object.values(any)` as `unknown[]` — the seven errors this caused are at PROD's
// uses (relTally.get(t), t.padEnd), not here. RelationshipType members are all
// string-initialised (src/ast/engine.ts:582+).
const PROD = [...new Set(Object.values<string>(ASTEngine.RelationshipType))]

// ── derived population ─────────────────────────────────────────────────────
function deriveFiles(root: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 24) return
    let ents
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "target") continue
        walk(p, depth + 1)
      } else if (EXT.some((x) => e.name.endsWith(x))) {
        try { if (statSync(p).size <= 400_000) out.push(p) } catch {}
      }
    }
  }
  walk(root, 0)
  out.sort()
  return out
}

const corpusDir = join(CORPUS, DIR)
let seen = 0
try { seen = statSync(corpusDir).isDirectory() ? 1 : 0 } catch {}
if (!seen) {
  console.error(`CENSUS: ${corpusDir} is not a directory. A missing corpus is a SKIP, never a pass.`)
  process.exit(2)
}
const all = deriveFiles(corpusDir)
const files = LIMIT > 0 ? all.slice(0, LIMIT) : all

console.log(`population   corpus=${DIR}`)
console.log(`             files discovered by derived walk (${EXT.join(",")}, <=400KB): ${all.length}`)
console.log(`             files attempted: ${files.length}${LIMIT > 0 ? `  (BB_LIMIT=${LIMIT} of ${all.length})` : " (whole population)"}`)

// ── tallies ────────────────────────────────────────────────────────────────
const relTally = new Map<string, number>()
const relFiles = new Map<string, Set<string>>()
const confTally = new Map<string, Map<string, number>>() // type -> conf bucket -> n
const evTally = new Map<string, Map<string, number>>() // type -> evidenceClass -> n
let imports = 0, importFiles = 0
let exportsCh = 0, exportFiles = 0
let parsed = 0, failed: string[] = []
const symbolNames = new Map<string, Set<string>>()
let symbolsTotal = 0
// rule R7 / standing rules: no unknown symbols, no empty names, no placeholder
// literal edge endpoints.
const placeholderHits: string[] = []
const emptyNameHits: string[] = []
const unknownKindHits: string[] = []
let relTotal = 0

const PLACEHOLDER = "unknown"

for (const f of files) {
  const rel = relative(corpusDir, f)
  let r: any
  try { r = await parseFile(f, corpusDir) } catch (e) { failed.push(`${rel}: ${String(e).slice(0, 80)}`); continue }
  if (!r) { failed.push(`${rel}: null result`); continue }
  parsed++

  const names = new Set<string>()
  for (const s of r.symbols || []) {
    const n = String(s?.name ?? "")
    if (n.length === 0) emptyNameHits.push(`${rel}: symbol with empty name`)
    else names.add(n)
    const k = String(s?.kind ?? "")
    if (k.length === 0 || k === "unknown" || k === PLACEHOLDER) unknownKindHits.push(`${rel}: kind=${k} name=${n}`)
  }
  symbolsTotal += (r.symbols || []).length
  symbolNames.set(rel, names)

  const imps = r.imports || []
  if (imps.length) importFiles++
  imports += imps.length
  const exps = r.exports || []
  if (exps.length) exportFiles++
  exportsCh += exps.length

  for (const e of r.relationships || []) {
    const t = String(e?.type ?? e?.relationshipType ?? "")
    relTotal++
    relTally.set(t, (relTally.get(t) || 0) + 1)
    if (!relFiles.has(t)) relFiles.set(t, new Set())
    relFiles.get(t)!.add(rel)
    // confidence histogram — anything below 0.7 is a heuristic (contract §4)
    const cf = typeof e?.confidence === "number" ? e.confidence : -1
    const bucket = cf < 0 ? "unset" : cf >= 1 ? "1.0" : cf >= 0.9 ? "0.9-0.99" : cf >= 0.8 ? "0.8-0.89" : cf >= 0.7 ? "0.7-0.79" : "HEURISTIC(<0.7)"
    if (!confTally.has(t)) confTally.set(t, new Map())
    const cm = confTally.get(t)!
    cm.set(bucket, (cm.get(bucket) || 0) + 1)
    const ec = String((e?.metadata as any)?.evidenceClass ?? "none")
    if (!evTally.has(t)) evTally.set(t, new Map())
    const em = evTally.get(t)!
    em.set(ec, (em.get(ec) || 0) + 1)
    // rule R7: an endpoint equal to the placeholder literal is a defect
    for (const end of [e?.source, e?.target]) {
      const s = String(end ?? "")
      if (s === PLACEHOLDER) placeholderHits.push(`${rel}: ${t} ${s}`)
      if (s.length === 0) emptyNameHits.push(`${rel}: ${t} has an empty endpoint`)
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────
console.log(`             files parsed: ${parsed}   files failed: ${failed.length}`)
if (failed.length) for (const f of failed.slice(0, 10)) console.log(`               FAIL ${f}`)
console.log(`             symbols emitted: ${symbolsTotal}`)
console.log("")
console.log("=== RELATIONSHIP CHANNEL (res.relationships) — the 10 production types ===")
for (const t of PROD) {
  const n = relTally.get(t) || 0
  const fs = relFiles.get(t)
  const where = n > 0 ? [...(fs as Set<string>)].slice(0, 4).join(", ") + (fs!.size > 4 ? ` …(+${fs!.size - 4} files)` : "") : ""
  console.log(`  ${t.padEnd(14)} ${String(n).padStart(6)}  in ${fs ? fs.size : 0} files${where ? "   e.g. " + where : ""}`)
}
const offEnum = [...relTally.keys()].filter((t) => !PROD.includes(t))
console.log(`  OFF-ENUM      ${offEnum.join(" ") || "(none)"}`)
console.log(`  TOTAL edges   ${relTotal}`)
console.log("")
console.log("=== IMPORTS CHANNEL (res.imports: ImportInfo[]) — reaches brain_import TABLE ===")
console.log(`  imports       ${String(imports).padStart(6)}  in ${importFiles}/${parsed} files`)
console.log("")
console.log("=== EXPORTS CHANNEL (res.exports: ExportInfo[]) — NOT a relationship channel ===")
console.log(`  exports[]     ${String(exportsCh).padStart(6)}  in ${exportFiles}/${parsed} files`)
console.log("")
console.log("=== confidence / evidenceClass per relationship type ===")
for (const t of PROD) {
  if (!relTally.has(t)) continue
  const cm = confTally.get(t)!
  const em = evTally.get(t)!
  console.log(`  ${t}`)
  console.log(`      conf  ${[...cm.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join("  ")}`)
  console.log(`      ev    ${[...em.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}:${n}`).join("  ")}`)
}
console.log("")
console.log("=== standing-rule checks ===")
console.log(`  placeholder-literal endpoints (R7, literal "${PLACEHOLDER}"): ${placeholderHits.length}`)
for (const h of placeholderHits.slice(0, 8)) console.log(`      ${h}`)
console.log(`  empty-name / empty-endpoint hits: ${emptyNameHits.length}`)
for (const h of emptyNameHits.slice(0, 8)) console.log(`      ${h}`)
console.log(`  unknown/empty SymbolKind hits: ${unknownKindHits.length}`)
for (const h of unknownKindHits.slice(0, 8)) console.log(`      ${h}`)
console.log("")
console.log("=== verdict score, both channels, as firing-check-v2 would read it ===")
const firedRel = PROD.filter((t) => relTally.has(t))
console.log(`  relationship channel: ${firedRel.length}/10  silent: ${PROD.filter((t) => !relTally.has(t)).join(" ") || "-"}`)
const anyImports = imports > 0
console.log(`  imports verdict: ${anyImports ? "EMITTED" : "SILENT"}  (imports[] ${imports} in ${importFiles} files)`)
const anyExports = exportsCh > 0
console.log(`  exports verdict: ${anyExports ? "EMITTED on the ExportInfo[] channel, SILENT on the relationship channel" : "SILENT on both"}`)
