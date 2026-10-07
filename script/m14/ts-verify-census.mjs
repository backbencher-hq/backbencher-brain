// ts-verify-census.mjs — VERIFY_TS10 JOB 1's main instrument.
//
// Runs the PRODUCTION entry point (`parseFile` from `src/ast/pool-worker.ts`, the
// same one the indexer calls) over a whole real corpus and reports, for each of
// the ten ontology relationship types, the numbers a verdict needs:
//
//   fires      count + the files it came from (EMITTED requires both)
//   resolved   both endpoints binding to a symbol the analyzer emitted — measured
//              TWICE, because the two answers are different questions:
//                inFile  : the target is a symbol declared in the SAME file
//                          (what a per-file analyzer can be held to)
//                corpus  : the target is a name declared SOMEWHERE in the corpus
//                          (what a consumer joining the whole brain can reach)
//   confident  confidence + evidenceClass histograms (honesty contract §4: under
//              0.7 is a heuristic and must be countable as one)
//   R7         unknown symbols, empty names, placeholder-literal endpoints
//
// Two channels, because they are two channels (src/ast/types.ts:206-216):
// `relationships[]` and `imports[]`. imports is reported on BOTH, since
// REVIEW-2026-10-04.md §1 measured that the relationship type `imports` and the
// `imports[]` channel are different facts and conflating them is the defect that
// made firing-check v1 unable to observe an import at all.
//
// NO REGEX anywhere (hard rule 1). Placeholder detection is Set membership plus
// charAt/startsWith. Population is DERIVED by readdir and printed with every
// count (M14-HONESTY-CONTRACT.md: an instrument must declare its population).
//
// Usage:
//   bun script/m14/ts-verify-census.mjs --repo element-plus [--limit 0]
//        [--max-bytes 1048576] [--out path.json]

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const argv = process.argv.slice(2)
const argOf = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPO = argOf("--repo") ?? "element-plus"
const LIMIT = Number(argOf("--limit") ?? "0")
const MAX_BYTES = Number(argOf("--max-bytes") ?? "1048576")
const OUT = argOf("--out")

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates",
]

// ── population, derived ─────────────────────────────────────────────────────
const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"]
const endsWithAny = (name, exts) => {
  for (const e of exts) if (name.endsWith(e)) return true
  return false
}
const repoDir = join(CORPUS_ROOT, REPO)
const seen = []
;(function walk(dir, depth) {
  if (depth > 24) return
  let ents
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue
      walk(p, depth + 1)
    } else if (endsWithAny(e.name, TS_EXTS)) seen.push(p)
  }
})(repoDir, 0)

let skippedBig = 0
const files = []
for (const abs of seen) {
  if (LIMIT > 0 && files.length >= LIMIT) break
  try {
    if (statSync(abs).size > MAX_BYTES) {
      skippedBig++
      continue
    }
  } catch {
    continue
  }
  files.push(abs)
}

const { parseFile } = await import(`${ROOT}/src/ast/pool-worker.ts`)

// ── accumulators ────────────────────────────────────────────────────────────
const bucket = () => ({
  count: 0,
  files: new Set(),
  srcInFile: 0,
  tgtInFile: 0,
  bothInFile: 0,
  srcCorpus: 0,
  tgtCorpus: 0,
  bothCorpus: 0,
  conf: new Map(),
  evidence: new Map(),
  reason: new Map(),
  emptyEnd: 0,
  placeholderEnd: 0,
  selfLoop: 0,
  examples: [],
  rows: [],
})
const rows = new Map()
for (const t of ALL_TYPES) rows.set(t, bucket())

// corpus-wide declared names, for the second resolution measure
const corpusNames = new Map() // name -> Set<rel>
let parsed = 0
let failed = 0
let totalSymbols = 0
let totalRels = 0
let totalImports = 0
let filesWithImports = 0
let filesWithExports = 0
let unknownSymbolKind = 0
let emptySymbolName = 0
let parseErrorFiles = 0
const errors = []
const perFileRows = []

// Rule R7, in the exact sense validation/m60/ledger.json states it and
// script/m60/sentinel-census.ts enforces: "No analyzer may NAME something with a
// placeholder literal ... not the string \"unknown\"". The sentinel census's
// marker is the `unknown` literal in its bracketed forms — "unknown",
// "<unknown>", "(unknown)", "Unknown" — because that is the literal a FALLBACK
// writes when it has nothing truthful to say.
//
// A first draft of this script used a much wider list that also contained "name",
// "value", "target", "source", "object", "string", "number", "any", "foo", "bar"
// and "baz". It reported 755 R7 hits on element-plus and every one of them was a
// real identifier: `contains: Sponsor -> name`, `uses: mapPrefix -> children`.
// Those are properties the corpus declares. A placeholder rule wide enough to
// convict them measures nothing, which is the same defect shape as the ontology
// gate's first text probe. So: R7 is the `unknown` literal, and an EMPTY name is
// counted separately, because the workstream lists them as two rules.
const R7_FORMS = new Set(["unknown", "<unknown>", "(unknown)", "[unknown]"])
const isPlaceholder = (s) => R7_FORMS.has(s)
const norm = (s) => String(s ?? "").toLowerCase().trim()
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)

const relType = (r) => String(r.type ?? r.relationshipType ?? "")
const endOf = (r) => [String(r.source ?? ""), String(r.target ?? "")]

// ── pass 1: run production parseFile ─────────────────────────────────────────
const CONCURRENCY = 4
let cursor = 0
async function worker() {
  for (;;) {
    const i = cursor++
    if (i >= files.length) return
    const abs = files[i]
    const rel = relative(repoDir, abs)
    let r
    try {
      r = await parseFile(abs, repoDir)
    } catch (e) {
      failed++
      continue
    }
    parsed++
    const symbols = Array.isArray(r?.symbols) ? r.symbols : []
    const ids = new Set()
    const names = new Set()
    for (const s of symbols) {
      const nm = String(s?.name ?? "")
      if (nm) {
        names.add(nm)
        const set = corpusNames.get(nm) ?? new Set()
        set.add(rel)
        corpusNames.set(nm, set)
      }
      if (s?.id) ids.add(String(s.id))
      totalSymbols++
      const kind = String(s?.kind ?? "")
      if (!kind || kind === "unknown") unknownSymbolKind++
      if (!nm) emptySymbolName++
    }
    if (Array.isArray(r?.errors) && r.errors.length) {
      parseErrorFiles++
      if (errors.length < 40) errors.push(`${rel}: ${r.errors.length}`)
    }
    const imps = Array.isArray(r?.imports) ? r.imports : []
    totalImports += imps.length
    if (imps.length) filesWithImports++
    const exps = Array.isArray(r?.exports) ? r.exports : []
    if (exps.length) filesWithExports++
    const rels = Array.isArray(r?.relationships) ? r.relationships : []
    totalRels += rels.length
    for (const edge of rels) {
      const t = relType(edge)
      const b = rows.get(t)
      if (!b) continue
      const [src, tgt] = endOf(edge)
      b.count++
      b.files.add(rel)
      const srcIn = src !== "" && (ids.has(src) || names.has(src))
      const tgtIn = tgt !== "" && (ids.has(tgt) || names.has(tgt))
      if (srcIn) b.srcInFile++
      if (tgtIn) b.tgtInFile++
      if (srcIn && tgtIn) b.bothInFile++
      const srcC = src !== "" && corpusNames.has(src)
      const tgtC = tgt !== "" && corpusNames.has(tgt)
      if (srcC) b.srcCorpus++
      if (tgtC) b.tgtCorpus++
      if (srcC && tgtC) b.bothCorpus++
      if (!src || !tgt) b.emptyEnd++
      if (isPlaceholder(norm(src)) || isPlaceholder(norm(tgt))) b.placeholderEnd++
      if (src === tgt && src !== "") b.selfLoop++
      bump(b.conf, String(edge.confidence ?? "absent"))
      const md = edge.metadata ?? {}
      bump(b.evidence, String(md.evidenceClass ?? edge.evidenceClass ?? "absent"))
      const rsn = md.reason ?? md.confidenceReason ?? edge.reason
      if (rsn) bump(b.reason, String(rsn))
      if (b.examples.length < 8) b.examples.push(`${src} -> ${tgt}`)
      if (b.rows.length < 4000) b.rows.push(`${rel}\t${src}\t${tgt}`)
      perFileRows.push([rel, t, src, tgt])
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

// ── report ──────────────────────────────────────────────────────────────────
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n)
const pct = (n, d) => (d === 0 ? "-" : ((100 * n) / d).toFixed(1))

console.log(`ts-verify-census — ${REPO}, production parseFile`)
console.log(
  `POPULATION: ${files.length} files under ${repoDir} (derived by readdir; exts ${TS_EXTS.join("/")}; ` +
    `${seen.length} seen, ${skippedBig} over ${MAX_BYTES} bytes)`,
)
console.log(`parsed ${parsed}, failed ${failed}; symbols ${totalSymbols.toLocaleString()}, relationships ${totalRels.toLocaleString()}`)
console.log(`imports[] channel: ${totalImports} in ${filesWithImports} files; exports[] channel: non-empty in ${filesWithExports} files`)
console.log(`symbols with unknown/empty kind: ${unknownSymbolKind}; empty names: ${emptySymbolName}; files with parse errors: ${parseErrorFiles}${errors.length ? " -> " + errors.join(" | ") : ""}`)
console.log(`distinct declared symbol names corpus-wide: ${corpusNames.size}\n`)

console.log(
  `${pad("type", 13)}${pad("count", 10)}${pad("files", 7)}${pad("inFile%", 9)}${pad("corpus%", 9)}${pad("tgt-in", 9)}${pad("tgt-corp", 9)}${pad("empty", 7)}${pad("R7", 6)}confidence`,
)
console.log("-".repeat(120))
for (const t of ALL_TYPES) {
  const b = rows.get(t)
  const hist = [...b.conf.entries()].sort((a, b2) => b2[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(
    `${pad(t, 13)}${pad(b.count.toLocaleString(), 10)}${pad(b.files.size, 7)}${pad(pct(b.bothInFile, b.count), 9)}${pad(pct(b.bothCorpus, b.count), 9)}${pad(pct(b.tgtInFile, b.count), 9)}${pad(pct(b.tgtCorpus, b.count), 9)}${pad(b.emptyEnd, 7)}${pad(b.placeholderEnd, 6)}${hist}`,
  )
}
const silent = ALL_TYPES.filter((t) => rows.get(t).count === 0)
console.log(`\nNOT EMITTED (0 relationship edges): ${silent.length ? silent.join(" ") : "(none)"}`)
for (const t of ALL_TYPES) {
  const b = rows.get(t)
  if (!b.count) continue
  console.log(`\n--- ${t}: ${b.count} edges in ${b.files.size} files`)
  console.log(`    files: ${[...b.files].slice(0, 10).join(", ")}${b.files.size > 10 ? ` (+${b.files.size - 10} more)` : ""}`)
  console.log(`    evidenceClass: ${JSON.stringify(Object.fromEntries(b.evidence))}`)
  console.log(`    confidence reasons: ${JSON.stringify(Object.fromEntries([...b.reason.entries()].slice(0, 8)))}`)
  console.log(`    examples: ${b.examples.slice(0, 5).join("  |  ")}`)
}

if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        repo: REPO,
        population: { seen: seen.length, admitted: files.length, skippedBig, parsed, failed },
        totals: { symbols: totalSymbols, relationships: totalRels, importsChannel: totalImports, filesWithImports },
        hygiene: { unknownSymbolKind, emptySymbolName, parseErrorFiles },
        types: Object.fromEntries(
          ALL_TYPES.map((t) => {
            const b = rows.get(t)
            return [
              t,
              {
                count: b.count,
                files: b.files.size,
                fileList: [...b.files],
                bothResolveInFile: b.bothInFile,
                bothResolveCorpus: b.bothCorpus,
                targetResolvesInFile: b.tgtInFile,
                targetResolvesCorpus: b.tgtCorpus,
                emptyEndpoints: b.emptyEnd,
                placeholderEndpoints: b.placeholderEnd,
                selfLoops: b.selfLoop,
                confidence: Object.fromEntries(b.conf),
                evidenceClass: Object.fromEntries(b.evidence),
                examples: b.examples,
                rows: b.rows,
              },
            ]
          }),
        ),
      },
      null,
      2,
    ),
  )
  console.log(`\nwrote ${OUT}`)
}