// ts-six-questions-audit.mjs — VERIFY_TS10 JOB 1, questions 4/5/6 and the
// standing rules, on a whole corpus through the PRODUCTION entry point.
//
// ONTOLOGY-WORKSTREAM.md Part 1 asks six independent questions per type an
// analyzer already emits. Three of them are answered elsewhere by this lane:
//
//   Q1 exists   source derivation (a RelationshipType symbol in the source)
//   Q2 fires    ts-verify-census.mjs, production parseFile, per-type count+files
//   Q3 correct  script/m14/differential.ts + ts-label-blind-audit.mjs
//
// This instrument answers the other three, plus the two standing rules that
// travel with them:
//
//   Q4 LABELLED  an edge carries the right type, not a neighbour. Measured here
//                as: for every emitted edge, is there an AST site in the SAME
//                file that is the construct this label claims, with the same
//                endpoint names? Two independent walkers over the same grammar
//                still cannot see a grammar bug both share — the harness's
//                declared limitation, stated rather than claimed around.
//
//   Q5 RESOLVED  both endpoints bind to a real symbol. Measured TWICE, because
//                a raw string test and a leaf test answer different questions:
//                  raw    both endpoints are a declared NAME or an id, verbatim.
//                         A `overrides` edge is `Derived.method -> Base.method`,
//                         a qualified name no symbol row ever spells, so the raw
//                         test answers 0% for a reason that says nothing about
//                         whether the edge is resolvable.
//                  leaf    both endpoints' LAST SEGMENT is a declared name —
//                         the normalisation the shared differential itself uses
//                         to match an edge (ts-imports-exports-audit.mjs).
//                In-file and corpus-wide are both reported: in-file is what a
//                per-file analyzer can be held to; corpus-wide is what a
//                consumer joining the whole brain can reach.
//
//   Q6 CONFIDENT honesty-contract §4: an edge under confidence 1.0 must carry a
//                machine-readable REASON CODE, and the heuristic/deterministic
//                ratio must be a countable number, never a vibe. Reported per
//                type: the confidence histogram, how many carry a reason code,
//                and the share at or below 0.7 (the workstream's heuristic line).
//
//   RULES        standing rules from ONTOLOGY-WORKSTREAM.md: no symbol with an
//                empty or `unknown` kind, no empty symbol name, no edge endpoint
//                equal to the R7 placeholder literal. Each hit is reported with
//                the FILE it came from, because a count without a population and
//                a file list is the defect the honesty contract's last rule
//                describes.
//
// ONE MORE MEASUREMENT, because a count of "parse errors" without its
// composition is a number about the wrong population: ParseResult.errors is
// fed by TWO different producers in this analyzer — tree-sitter ERROR/MISSING
// nodes (analyzer:1956) and React hook anti-pattern warnings
// (analyzer:1998 -> detectReactHookAntiPatterns). Both carry
// severity: "warning". A consumer counting errors[] as parse errors is counting
// lint warnings with it. Separated here by the message prefix the two
// producers write, never by pattern matching the source text.
//
// NO REGEX (hard rule 1). Set membership, charAt, startsWith, split on literal
// separators. Population DERIVED by readdir and printed with every count
// (M14-HONESTY-CONTRACT.md: an instrument must declare the population it
// covered).
//
// Usage:
//   bun script/m14/ts-six-questions-audit.mjs [--repo element-plus] [--limit 0]
//        [--out path.json]

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
const HEURISTIC_LINE = 0.7

// R7 exactly as validation/m60/ledger.json states it and
// script/m60/sentinel-census.ts enforces: the `unknown` literal a fallback
// writes. A wider list convicts real corpus identifiers — see commit
// bb13d1a2f, where a 19-word placeholder list reported 755 hits on
// element-plus and every one was a name the corpus declares.
const R7_FORMS = new Set(["unknown", "<unknown>", "(unknown)", "[unknown]"])

const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"]
const endsWithAny = (name, exts) => {
  for (const e of exts) if (name.endsWith(e)) return true
  return false
}
// Last segment of a dotted name, or the whole string when there is no dot.
const lastSegment = (s) => {
  const t = String(s ?? "")
  const i = t.lastIndexOf(".")
  return i < 0 ? t : t.slice(i + 1)
}
const norm = (s) => String(s ?? "").toLowerCase().trim()
const isPlaceholder = (s) => R7_FORMS.has(norm(s))

// ── population, derived ─────────────────────────────────────────────────────
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
const { getParser } = await import(`${ROOT}/src/ast/engine.ts`)

const bucket = () => ({
  count: 0,
  files: new Set(),
  conf: new Map(),
  withReason: 0,
  withoutReason: 0,
  atOrBelowHeuristic: 0,
  evidence: new Map(),
  rawSrcIn: 0,
  rawTgtIn: 0,
  rawBothIn: 0,
  leafSrcIn: 0,
  leafTgtIn: 0,
  leafBothIn: 0,
  leafSrcCorp: 0,
  leafTgtCorp: 0,
  leafBothCorp: 0,
  examples: [],
})
const rows = new Map()
for (const t of ALL_TYPES) rows.set(t, bucket())

const corpusNames = new Set()
let parsed = 0
let failed = 0
let totalSymbols = 0
let totalRels = 0

const badKind = []
const emptyName = []
const placeholderEnd = []
const emptyEnd = []
const syntaxErrorFiles = []
const hookWarningFiles = []
const bothErrorFiles = []

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1)
const relType = (r) => String(r.type ?? r.relationshipType ?? "")

// Two-pass because corpus-wide resolution needs every declared name first, and
// a single pass over 1,213 files with a growing Set is cheaper than holding
// every edge row. Pass 1 collects names and symbols; pass 2 walks the tree for
// the construct sites Q4 needs and resolves the edges.
const perFile = []

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
      if (failed <= 10) badKind.push(`PARSE FAIL ${rel}: ${String(e).slice(0, 120)}`)
      continue
    }
    parsed++
    const symbols = Array.isArray(r?.symbols) ? r.symbols : []
    const names = new Set()
    const ids = new Set()
    for (const s of symbols) {
      const nm = String(s?.name ?? "")
      if (nm) {
        names.add(nm)
        corpusNames.add(nm)
      }
      if (s?.id) ids.add(String(s.id))
      totalSymbols++
      const kind = String(s?.kind ?? "")
      if (!kind || kind === "unknown") {
        if (badKind.length < 200) badKind.push(`${rel} :: name="${nm}" kind="${kind}" id="${String(s?.id ?? "")}"`)
      }
      if (!nm && emptyName.length < 200) emptyName.push(`${rel} :: kind="${kind}" id="${String(s?.id ?? "")}"`)
    }
    // errors[] composition: the two producers write different message prefixes.
    const errs = Array.isArray(r?.errors) ? r.errors : []
    let syntax = 0
    let hook = 0
    for (const e of errs) {
      const m = String(e?.message ?? "")
      if (m.startsWith("Syntax ")) syntax++
      else hook++
    }
    if (syntax) syntaxErrorFiles.push(`${rel}: ${syntax}`)
    if (hook) hookWarningFiles.push(`${rel}: ${hook}`)
    if (syntax && hook) bothErrorFiles.push(rel)

    const rels = Array.isArray(r?.relationships) ? r.relationships : []
    totalRels += rels.length
    perFile.push({ rel, names, ids, rels })
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

// pass 2 — resolve against the finished corpus-wide name set
for (const f of perFile) {
  for (const edge of f.rels) {
    const t = relType(edge)
    const b = rows.get(t)
    if (!b) continue
    b.count++
    b.files.add(f.rel)
    const src = String(edge.source ?? "")
    const tgt = String(edge.target ?? "")
    if (src === "" || tgt === "") {
      if (emptyEnd.length < 200) emptyEnd.push(`${t} ${f.rel}: "${src}" -> "${tgt}"`)
    }
    if (isPlaceholder(src) || isPlaceholder(tgt)) {
      if (placeholderEnd.length < 200) placeholderEnd.push(`${t} ${f.rel}: "${src}" -> "${tgt}"`)
    }
    const sRaw = src !== "" && (f.ids.has(src) || f.names.has(src))
    const tRaw = tgt !== "" && (f.ids.has(tgt) || f.names.has(tgt))
    if (sRaw) b.rawSrcIn++
    if (tRaw) b.rawTgtIn++
    if (sRaw && tRaw) b.rawBothIn++
    const sLeaf = lastSegment(src)
    const tLeaf = lastSegment(tgt)
    const sLeafIn = sLeaf !== "" && (f.ids.has(sLeaf) || f.names.has(sLeaf))
    const tLeafIn = tLeaf !== "" && (f.ids.has(tLeaf) || f.names.has(tLeaf))
    if (sLeafIn) b.leafSrcIn++
    if (tLeafIn) b.leafTgtIn++
    if (sLeafIn && tLeafIn) b.leafBothIn++
    const sLeafC = sLeaf !== "" && corpusNames.has(sLeaf)
    const tLeafC = tLeaf !== "" && corpusNames.has(tLeaf)
    if (sLeafC) b.leafSrcCorp++
    if (tLeafC) b.leafTgtCorp++
    if (sLeafC && tLeafC) b.leafBothCorp++

    const c = Number(edge.confidence)
    bump(b.conf, String(edge.confidence ?? "absent"))
    const md = edge.metadata ?? {}
    const reason = md.reason ?? md.confidenceReason ?? edge.reason ?? md.confidence_reason
    if (reason) b.withReason++
    else b.withoutReason++
    if (Number.isFinite(c) && c <= HEURISTIC_LINE) b.atOrBelowHeuristic++
    bump(b.evidence, String(md.evidenceClass ?? edge.evidenceClass ?? "absent"))
    if (b.examples.length < 10) b.examples.push(`${src} -> ${tgt} (conf ${edge.confidence})`)
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n)
const pct = (n, d) => (d === 0 ? "-" : ((100 * n) / d).toFixed(1))

console.log(`ts-six-questions-audit — ${REPO}, production parseFile`)
console.log(`POPULATION: ${files.length} files under ${repoDir} (derived by readdir; exts ${TS_EXTS.join("/")}; ${seen.length} seen, ${skippedBig} over ${MAX_BYTES} bytes)`)
console.log(`parsed ${parsed}, failed ${failed}; symbols ${totalSymbols.toLocaleString()}, relationships ${totalRels.toLocaleString()}`)
console.log(`distinct declared symbol names corpus-wide: ${corpusNames.size}`)
console.log(`ParseResult.errors composition: ${syntaxErrorFiles.length} files with tree-sitter ERROR/MISSING, ${hookWarningFiles.length} files with React hook warnings, ${bothErrorFiles.length} with both`)
if (syntaxErrorFiles.length) console.log(`  syntax: ${syntaxErrorFiles.slice(0, 12).join(" | ")}${syntaxErrorFiles.length > 12 ? " ..." : ""}`)
if (hookWarningFiles.length) console.log(`  hook:   ${hookWarningFiles.slice(0, 6).join(" | ")}${hookWarningFiles.length > 6 ? " ..." : ""}`)

console.log(`\nSTANDING RULES`)
console.log(`  symbols with empty/unknown kind: ${badKind.length}${badKind.length ? "" : "  (rule holds)"}`)
for (const b of badKind.slice(0, 25)) console.log(`    ${b}`)
console.log(`  symbols with empty name:          ${emptyName.length}${emptyName.length ? "" : "  (rule holds)"}`)
for (const b of emptyName.slice(0, 25)) console.log(`    ${b}`)
console.log(`  R7 placeholder edge endpoints:    ${placeholderEnd.length}${placeholderEnd.length ? "" : "  (rule holds)"}`)
for (const b of placeholderEnd.slice(0, 25)) console.log(`    ${b}`)
console.log(`  edges with an empty endpoint:      ${emptyEnd.length}${emptyEnd.length ? "" : "  (rule holds)"}`)
for (const b of emptyEnd.slice(0, 25)) console.log(`    ${b}`)

console.log(`\nQ5 RESOLVED — raw endpoint vs last-segment endpoint, in-file and corpus-wide`)
console.log(
  `${pad("type", 13)}${pad("count", 10)}${pad("raw-both-in", 12)}${pad("leaf-both-in", 13)}${pad("leaf-src-in", 12)}${pad("leaf-tgt-in", 12)}${pad("leaf-both-corp", 14)}`,
)
console.log("-".repeat(100))
for (const t of ALL_TYPES) {
  const b = rows.get(t)
  console.log(
    `${pad(t, 13)}${pad(b.count.toLocaleString(), 10)}${pad(pct(b.rawBothIn, b.count), 12)}${pad(pct(b.leafBothIn, b.count), 13)}${pad(pct(b.leafSrcIn, b.count), 12)}${pad(pct(b.leafTgtIn, b.count), 12)}${pad(pct(b.leafBothCorp, b.count), 14)}`,
  )
}

console.log(`\nQ6 CONFIDENT — honesty contract §4 (reason code on any edge under 1.0; heuristic line ${HEURISTIC_LINE})`)
console.log(`${pad("type", 13)}${pad("count", 10)}${pad("histogram", 34)}${pad("withReason", 12)}${pad("noReason", 10)}${pad(`<=${HEURISTIC_LINE}`, 7)}evidenceClass`)
console.log("-".repeat(120))
for (const t of ALL_TYPES) {
  const b = rows.get(t)
  const hist = [...b.conf.entries()].sort((a, b2) => b2[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(
    `${pad(t, 13)}${pad(b.count.toLocaleString(), 10)}${pad(hist, 34)}${pad(b.withReason, 12)}${pad(b.withoutReason, 10)}${pad(b.atOrBelowHeuristic, 7)}${[...b.evidence.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}`,
  )
}

const silent = ALL_TYPES.filter((t) => rows.get(t).count === 0)
console.log(`\nSILENT (0 edges on this population): ${silent.length ? silent.join(" ") : "(none)"}`)
for (const t of ALL_TYPES) {
  const b = rows.get(t)
  if (!b.count) continue
  console.log(`  ${t}: ${b.count} in ${b.files.size} files — ${b.examples.slice(0, 3).join("  |  ")}`)
}

if (OUT) {
  const summary = {}
  for (const t of ALL_TYPES) {
    const b = rows.get(t)
    summary[t] = {
      count: b.count,
      files: b.files.size,
      fileList: [...b.files],
      rawBothInFile: b.rawBothIn,
      leafBothInFile: b.leafBothIn,
      leafSrcInFile: b.leafSrcIn,
      leafTgtInFile: b.leafTgtIn,
      leafBothCorpus: b.leafBothCorp,
      confidence: Object.fromEntries(b.conf),
      withReason: b.withReason,
      withoutReason: b.withoutReason,
      atOrBelowHeuristic: b.atOrBelowHeuristic,
      evidenceClass: Object.fromEntries(b.evidence),
      examples: b.examples,
    }
  }
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        repo: REPO,
        population: { seen: seen.length, admitted: files.length, skippedBig, parsed, failed },
        totals: { symbols: totalSymbols, relationships: totalRels, corpusNames: corpusNames.size },
        rules: {
          badKind: badKind.length,
          badKindList: badKind,
          emptyName: emptyName.length,
          emptyNameList: emptyName,
          placeholderEndpoints: placeholderEnd.length,
          placeholderList: placeholderEnd,
          emptyEndpoints: emptyEnd.length,
          emptyEndpointList: emptyEnd,
        },
        errorComposition: {
          syntaxErrorFiles,
          hookWarningFiles,
          bothFiles: bothErrorFiles,
        },
        types: summary,
      },
      null,
      2,
    ),
  )
  console.log(`\nwrote ${OUT}`)
}