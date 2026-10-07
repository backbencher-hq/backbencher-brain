// ts-production-drop.mjs — VERIFY_TS10: what the analyzer emits vs what the
// PRODUCT receives.
//
// Two measurements the ontology census cannot make, because both live on the seam
// between `analyze()` and `parseFile` (src/ast/pool-worker.ts), which is where
// every lane's edges are silently rewritten:
//
//   A. THE PRODUCTION FILTER'S DROP. `parseFile` runs
//      `filterNoiseRelationships(parsed.relationships, language, declaredNames)`
//      over everything the analyzer returned. An edge the analyzer emitted and
//      the filter deleted is invisible to every fixture (fixtures call
//      `analyze()`) and to every differential that reads `analyze()` — which is
//      the same "unpinnable seam" shape pool-worker.ts's own MD-5 note records.
//      Measured by running BOTH entry points over the same file and subtracting.
//
//   B. THE MODULE LEAF SPELLING. `imports` and `exports` are sourced from the
//      module, and `moduleLeafName()` is
//      `path.basename(file, path.extname(file))`. For `env.d.ts` that is `env.d`:
//      the module TypeScript itself calls `env`. Every edge out of a declaration
//      file is therefore attributed to a module name nothing else spells.
//
// NO REGEX. File selection by extension/size; the drop classification is Set
// membership and string ops on the ANALYZER's own target text.
//
// Usage:
//   bun script/m14/ts-production-drop.mjs [--repo element-plus] [--files 200]

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const argv = process.argv.slice(2)
const argOf = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPO = argOf("--repo") ?? "element-plus"
const WANT = Number(argOf("--files") ?? "200")
const MAX_BYTES = Number(argOf("--max-bytes") ?? "400000")

const TS_EXTS = [".ts", ".tsx"]
const endsWithAny = (n, exts) => {
  for (const e of exts) if (n.endsWith(e)) return true
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

const admitted = []
for (const abs of seen) {
  // 0 means "the whole population". Without this, `--files 0` admitted nothing
  // and printed an all-zero table with a POPULATION line reading "0 files of
  // 1210 seen" -- a correct number about an empty population, which is the
  // shape M14-HONESTY-CONTRACT.md §"an instrument must declare the population"
  // warns about, produced by my own instrument.
  if (WANT > 0 && admitted.length >= WANT) break
  try {
    if (statSync(abs).size > MAX_BYTES) continue
  } catch {
    continue
  }
  admitted.push(abs)
}

const { getParser } = await import(`${ROOT}/src/ast/engine.ts`)
const { parseFile } = await import(`${ROOT}/src/ast/pool-worker.ts`)
const mod = await import(`${ROOT}/src/ast/real-typescript-analyzer.ts`)
const Cls = Object.values(mod).find((v) => typeof v === "function" && v.name.endsWith("Analyzer"))

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates",
]
const direct = new Map(ALL_TYPES.map((t) => [t, 0]))
const produced = new Map(ALL_TYPES.map((t) => [t, 0]))
const dropFamilies = new Map()
const leaves = new Map() // module leaf -> { files, imports, exports }
let dtsFiles = 0
let dtsEdges = 0
let parsed = 0
let failed = 0
// A failure is a MEASUREMENT about the population, not a nuisance: swallowing the
// reason is how an instrument prints "581 measured" over a 1,210-file corpus and
// reads as though that were the corpus. The first full run did exactly that —
// 629 of 1,210 files failed and the table looked like a corpus measurement.
const failures = []
const noteFailure = (rel, where, e) => {
  failed++
  if (failures.length < 30) failures.push(`${where} ${rel}: ${String(e).slice(0, 120)}`)
}
// web-tree-sitter's wasm heap is FIXED-SIZE and a long-lived Parser in one
// process degrades into `RuntimeError: Out of bounds memory access` partway
// through a corpus. The first full run of this instrument reported 581 measured
// of 1,210 and printed a table that read like a corpus measurement; the second
// printed the failures and the cause was a dead parser, not a hard corpus.
// engine.ts recycles its own parsers every 500 parses (pool-worker caches differ);
// this instrument caches its own, so it has to do the same.
const parsers = {}
let parsesSinceRefresh = 0
const PARSE_REFRESH_EVERY = 250
async function parserFor(lang) {
  if (parsers[lang] && parsesSinceRefresh >= PARSE_REFRESH_EVERY) {
    try { if (typeof parsers[lang].delete === "function") parsers[lang].delete() } catch {}
    delete parsers[lang]
    parsesSinceRefresh = 0
  }
  if (!parsers[lang]) parsers[lang] = await getParser(lang)
  parsesSinceRefresh++
  return parsers[lang]
}

const bump = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n)

for (const abs of admitted) {
  const rel = relative(repoDir, abs)
  let content
  try {
    content = readFileSync(abs, "utf8")
  } catch (e) {
    noteFailure(rel, "read", e)
    continue
  }
  const lang = abs.endsWith(".tsx") ? "tsx" : "typescript"
  let tree
  try {
    tree = await (await parserFor(lang)).parse(content, abs)
  } catch (e) {
    noteFailure(rel, "parse", e)
    continue
  }
  let a
  try {
    a = new Cls().analyze(tree.rootNode, content, abs)
  } catch (e) {
    noteFailure(rel, "analyze", e)
    continue
  }
  let p
  try {
    p = await parseFile(abs, repoDir)
  } catch (e) {
    noteFailure(rel, "parseFile", e)
    continue
  }
  parsed++

  // ── B: module leaf spelling ────────────────────────────────────────────
  const base = abs.slice(abs.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  const leaf = dot <= 0 ? base : base.slice(0, dot)
  if (base.endsWith(".d.ts")) {
    dtsFiles++
    for (const r of p.relationships ?? []) {
      if (r.type === "imports" || r.type === "exports") {
        dtsEdges++
        bump(dropFamilies, `module leaf for a .d.ts file is "${leaf}" (should be the stem)`)
      }
    }
  }
  const rec = leaves.get(leaf) ?? { files: new Set(), imports: 0, exports: 0 }
  rec.files.add(rel)
  if (rec.files.size === 1) {
    for (const r of p.relationships ?? []) {
      if (r.type === "imports") rec.imports++
      if (r.type === "exports") rec.exports++
    }
  }
  leaves.set(leaf, rec)

  // ── A: what the production filter dropped ──────────────────────────────
  const pKeys = new Set()
  for (const r of p.relationships ?? []) {
    const t = String(r.type ?? "")
    bump(produced, t)
    pKeys.add(`${t} ${r.source} ${r.target}`)
  }
  for (const r of a.relationships ?? []) {
    const t = String(r.type ?? "")
    bump(direct, t)
    const k = `${t} ${r.source} ${r.target}`
    if (pKeys.has(k)) continue
    const target = String(r.target ?? "")
    // Name the shape the drop took, the way the workstream asks: a count with no
    // family is not triageable.
    const leafOfTarget = target.slice(Math.max(target.lastIndexOf("."), target.lastIndexOf(":")) + 1)
    const fam = `${t} -> leaf "${leafOfTarget}"`
    bump(dropFamilies, fam)
  }
}

const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n)
console.log(`ts production drop — ${REPO}`)
console.log(`POPULATION: ${admitted.length} .ts/.tsx files of ${seen.length} seen (derived by readdir); ${parsed} measured, ${failed} failed`)
if (failed) {
  console.log(`FAILURES: ${failed} of ${admitted.length} files did not produce a measurement. The population above is what was MEASURED, not what exists:`)
  for (const f of failures.slice(0, 10)) console.log(`  ${f}`)
  console.log("")
}
console.log(`analyze() direct vs production parseFile, same file, same process\n`)
console.log(`${pad("type", 13)}${pad("analyze()", 12)}${pad("parseFile", 12)}dropped    %dropped`)
console.log("-".repeat(70))
for (const t of ALL_TYPES) {
  const d = direct.get(t) ?? 0
  const q = produced.get(t) ?? 0
  const d0 = d - q
  console.log(`${pad(t, 13)}${pad(d.toLocaleString(), 12)}${pad(q.toLocaleString(), 12)}${pad(d0.toLocaleString(), 10)}${d === 0 ? "-" : ((100 * d0) / d).toFixed(2) + "%"}`)
}
console.log(`\nDROP FAMILIES (analyze() emitted, parseFile did not deliver):`)
const fams = [...dropFamilies.entries()].sort((a, b) => b[1] - a[1])
if (!fams.length) console.log("  (none)")
for (const [f, n] of fams.slice(0, 40)) console.log(`  ${String(n).padStart(7)}  ${f}`)
console.log(`\nB. module leaf spelling:`)
console.log(`   .d.ts files in the population: ${dtsFiles}; imports+exports edges sourced from them: ${dtsEdges}`)
const dotted = [...leaves.entries()].filter(([leaf]) => leaf.endsWith(".d")).slice(0, 10)
for (const [leaf, rec] of dotted) console.log(`   leaf "${leaf}" (files ${rec.files.size})`)
const multi = [...leaves.entries()].filter(([, rec]) => rec.files.size > 1).slice(0, 10)
console.log(`   module leaves shared by MORE THAN ONE file (an ambiguous module name): ${multi.length}`)
for (const [leaf, rec] of multi) console.log(`     "${leaf}" <- ${rec.files.size} files`)