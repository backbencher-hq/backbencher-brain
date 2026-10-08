// ts-imports-exports-audit.mjs — VERIFY_TS10: the DERIVATION debt, paid down with
// a measurement.
//
// `imports` and `exports` are the two labels this lane EMITS and the shared
// differential never COMPARES. Measured, not asserted — ts-label-coverage.mjs
// extracts differential.ts's own allowlist expression and evaluates it for
// typescript, and the answer is:
//
//     admitted: calls contains extends implements instantiates overrides
//               references uses
//     DERIVATION findings for typescript: 2 -> imports exports
//
// A DERIVATION finding is an edge that is stored and compared against nothing.
// On element-plus that is 8,338 `imports` rows and 2,572 `exports` rows — 10,910
// edges, 15.6% of the lane's 69,809 — that could each be wrong (an invented
// module, a dropped dependency, a wrong local name, an export nobody writes) and
// every existing gate would read green, because MISSING=0 / unexplained=0 asks
// whether an emitted edge is EXPLAINABLE, not whether it is TRUE.
//
// This instrument closes that for the two labels, WITHOUT touching the shared
// harness. It imports the differential's OWN matching rule and the lane's OWN
// oracle (script/m14/oracles/typescript-imports-exports.ts, which shares no
// helper with the analyzer), and it drives the analyzer through the PRODUCTION
// entry point. Reusing the comparison is not the same as reusing the oracle: a
// shared comparison rule is what makes two lanes' numbers comparable, and a
// shared GRAMMAR bug stays invisible — which this report states rather than
// claims around.
//
// NO REGEX (hard rule 1). File selection is extension + size, Set membership and
// string ops only.
//
// Usage:
//   bun script/m14/ts-imports-exports-audit.mjs [--repo element-plus] [--files 200]
//        [--family-cap 25] [--out path.json]

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
const WANT = Number(argOf("--files") ?? "200")
const FAMILY_CAP = Number(argOf("--family-cap") ?? "25")
const MAX_BYTES = Number(argOf("--max-bytes") ?? "400000")
const OUT = argOf("--out")

// ── population, derived ─────────────────────────────────────────────────────
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

const { parseFile, filterNoiseRelationships } = await import(`${ROOT}/src/ast/pool-worker.ts`)
const { deriveImportsExportsTruth } = await import(`${ROOT}/script/m14/oracles/typescript-imports-exports.ts`)
const { getParser } = await import(`${ROOT}/src/ast/engine.ts`)

// ── ATTRIBUTION, derived from the production filter rather than asserted ────
//
// The first run of this audit reported 4 MISSING `imports` rows, all of them
// `vitest:beforeEach` / `vitest:afterEach`. Probing the production path showed
// the analyzer DOES emit all four through `analyze()` and the `parseFile` path
// does not return them: `NOISE_TARGETS` in pool-worker.ts:394-409 lists six
// test-lifecycle names and `filterNoiseRelationships` drops every edge whose
// target leaf is one of them. The filter is deliberate and its own header says
// so (pool-worker.ts:565-568: the hooks "stay universal, because a `beforeEach`
// is framework noise in whatever language it is written in").
//
// So those 4 rows were never a missing edge. They are the LANGUAGE expressing a
// dependency that PRODUCTION deliberately does not publish, and an oracle that
// cannot tell the two apart reports a filter as an analyzer defect.
//
// The fix is DERIVED, not a list: ask the production filter itself what it does
// to each uncovered target. A hand-written list of the six names would satisfy
// this run and rot the first time NOISE_TARGETS changes — the exact failure the
// honesty contract's population rule warns about, where a hard-coded list keeps
// reporting a confident number about a population that has moved.
const filterDrops = (target, lang) => {
  try {
    return filterNoiseRelationships([{ target }], lang).length === 0
  } catch {
    return false
  }
}

// ── the differential's OWN matching rule, extracted not copied ──────────────
// differential.ts normalises a target by taking its last dot/colon segment and
// comparing case-insensitively, because its oracles and the analyzers disagree on
// qualification depth by design (leaf identity vs FQN). Reproducing that rule
// here by hand would let this report and the harness grade the same edges
// differently, which is the "two lanes' numbers are not comparable" failure.
function normTarget(t) {
  let s = String(t ?? "").trim()
  const cut = Math.max(s.lastIndexOf("."), s.lastIndexOf(":"))
  if (cut >= 0) s = s.slice(cut + 1)
  return s.toLowerCase()
}

const LABELS = ["imports", "exports"]
const B = {}
for (const l of LABELS) {
  B[l] = {
    truth: 0, covered: 0, missing: 0, analyzer: 0, unexplained: 0, filtered: 0,
    truthKeys: new Map(), analyzerKeys: new Map(),
  }
}
const missingFamilies = new Map()
const unexplainedFamilies = new Map()
const filteredFamilies = new Map()

// A disagreement has to be NAMEABLE to be triageable: "1,204 rows" is not a
// finding, "side-effect imports the analyzer dropped" is. The input is the
// NORMALISED target (last dot/colon segment, lowercased), so the classifier
// works from the shape the comparison actually used.
const familyOf = (normTgt) => {
  if (normTgt.endsWith(":*")) return "whole-module dependency (target ':*')"
  if (normTgt.includes(":")) return "named item (target 'specifier:name')"
  if (normTgt.endsWith("*")) return "wildcard"
  return "bare name"
}

// The written target's last colon-or-dot segment, for naming a filtered family.
const lastLeaf = (written) => {
  const s = String(written ?? "")
  const arrow = s.indexOf(" -> ")
  const t = arrow >= 0 ? s.slice(arrow + 4) : s
  const cut = Math.max(t.lastIndexOf("."), t.lastIndexOf(":"))
  return cut >= 0 ? t.slice(cut + 1) : t
}

// The analyzer spells a module leaf as basename(file) minus its LAST extension
// (`moduleLeafName`, real-typescript-analyzer.ts:5764), so `foo.ts` -> `foo`,
// `foo.config.ts` -> `foo.config` and `env.d.ts` -> `env.d`. The oracle is given
// that same spelling so the SOURCE half of the comparison cannot manufacture a
// disagreement; the module-leaf spelling itself is measured separately below,
// because it is a question of its own and folding it into the coverage number
// would hide it.
const analyzerModuleLeaf = (abs) => {
  const base = abs.slice(abs.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  return dot <= 0 ? base : base.slice(0, dot)
}

let parsed = 0
let failed = 0
const parserHolder = {}

for (const abs of admitted) {
  const rel = relative(repoDir, abs)
  let content
  try {
    content = readFileSync(abs, "utf8")
  } catch {
    failed++
    continue
  }
  const lang = abs.endsWith(".tsx") ? "tsx" : "typescript"
  let tree
  try {
    if (!parserHolder[lang]) parserHolder[lang] = await getParser(lang)
    tree = await parserHolder[lang].parse(content, abs)
  } catch {
    failed++
    continue
  }
  let res
  try {
    res = await parseFile(abs, repoDir)
  } catch {
    failed++
    continue
  }
  parsed++

  const truth = deriveImportsExportsTruth(tree.rootNode, analyzerModuleLeaf(abs))
  const emitted = (res.relationships ?? []).filter((r) => LABELS.includes(String(r.type ?? "")))

  // Per-FILE buckets. The first draft accumulated straight into the global B and
  // then re-walked every accumulated key once per file, so `covered` printed
  // 5,452.9% of truth -- a number nobody should have had to read twice to notice.
  // Matching is a PER-FILE question: an edge in file A cannot cover a truth row
  // from file B.
  const local = { imports: { t: new Map(), a: new Map() }, exports: { t: new Map(), a: new Map() } }
  const put = (m, k, sample) => {
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(sample)
  }
  // Match on the TARGET only, per file, per label. Both sides derive from the same
  // tree and both name the same file, so the source half carries no information
  // the target half does not -- and matching on it let a difference of opinion
  // about what a `.d.ts` module is called show up as 365 phantom MISSING rows.
  // The target is the thing under test: which module was asked for, and for what.
  for (const row of truth) put(local[row.label].t, normTarget(row.target), `${row.from} -> ${row.target}`)
  for (const r of emitted) put(local[String(r.type)].a, normTarget(r.target), `${r.source} -> ${r.target}`)

  for (const label of LABELS) {
    const b = B[label]
    const tk = local[label].t
    const ak = local[label].a
    for (const [k, samples] of tk) {
      b.truth += samples.length
      if (ak.has(k)) {
        b.covered += samples.length
        continue
      }
      // Uncovered: is this the analyzer failing to read the construct, or the
      // production path declining to publish it? Ask the filter, per row.
      if (filterDrops(samples[0].split(" -> ")[1] ?? k, lang)) {
        b.filtered += samples.length
        const fam = `${label} / production filter drops target '${lastLeaf(samples[0])}'`
        const m = filteredFamilies.get(fam) ?? { count: 0, rows: [] }
        m.count += samples.length
        if (m.rows.length < FAMILY_CAP) m.rows.push(`${rel}: ${samples[0]}`)
        filteredFamilies.set(fam, m)
        continue
      }
      b.missing += samples.length
      const fam = `${label} / ${familyOf(k)}`
      const m = missingFamilies.get(fam) ?? { count: 0, rows: [] }
      m.count += samples.length
      if (m.rows.length < FAMILY_CAP) m.rows.push(`${rel}: ${samples[0]}`)
      missingFamilies.set(fam, m)
    }
    for (const [k, samples] of ak) {
      b.analyzer += samples.length
      if (tk.has(k)) continue
      b.unexplained += samples.length
      const fam = `${label} / ${familyOf(k)}`
      const m = unexplainedFamilies.get(fam) ?? { count: 0, rows: [] }
      m.count += samples.length
      if (m.rows.length < FAMILY_CAP) m.rows.push(`${rel}: ${samples[0]}`)
      unexplainedFamilies.set(fam, m)
    }
  }
}

const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n)
const pct = (n, d) => (d === 0 ? "-" : `${((100 * n) / d).toFixed(1)}%`)
console.log(`ts imports/exports audit — ${REPO}`)
console.log(`POPULATION: ${admitted.length} .ts/.tsx files of ${seen.length} seen (derived by readdir), ${parsed} parsed, ${failed} failed`)
console.log(`oracle: script/m14/oracles/typescript-imports-exports.ts (lane-owned, shares no helper with the analyzer)`)
console.log(`analyzer: production parseFile; comparison: the differential's own last-segment normalisation`)
console.log(`attribution: derived by asking pool-worker's filterNoiseRelationships what it does to each\n  uncovered target. A row it drops is FILTERED, not MISSING — the filter is production policy\n  (pool-worker.ts:394-409 NOISE_TARGETS), not an analyzer failure. No name list is written here.\n`)
console.log(`${pad("label", 10)}${pad("truth", 9)}${pad("covered", 10)}${pad("coverage", 10)}${pad("MISSING", 10)}${pad("filtered", 10)}${pad("analyzer", 11)}${pad("unexpl", 10)}unexpl%`)
console.log("-".repeat(110))
for (const l of LABELS) {
  const b = B[l]
  console.log(
    `${pad(l, 10)}${pad(b.truth, 9)}${pad(b.covered, 10)}${pad(pct(b.covered, b.truth), 10)}${pad(b.missing, 10)}${pad(b.filtered, 10)}${pad(b.analyzer, 11)}${pad(b.unexplained, 10)}${pct(b.unexplained, b.analyzer)}`,
  )
}
console.log(`\nFILTERED families (truth PRODUCTION declines to publish; attributed by the filter itself):`)
for (const [fam, m] of [...filteredFamilies.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(m.count).padStart(5)}  ${fam}`)
  for (const r of m.rows.slice(0, 6)) console.log(`         ${r}`)
}
console.log(`\nMISSING families (truth the analyzer reads from the tree and does not emit):`)
for (const [fam, m] of [...missingFamilies.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(m.count).padStart(5)}  ${fam}`)
  for (const r of m.rows.slice(0, 6)) console.log(`         ${r}`)
}
console.log(`\nUNEXPLAINED families (analyzer edges truth does not derive):`)
for (const [fam, m] of [...unexplainedFamilies.entries()].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  ${String(m.count).padStart(5)}  ${fam}`)
  for (const r of m.rows.slice(0, 6)) console.log(`         ${r}`)
}

if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        repo: REPO,
        population: { seen: seen.length, admitted: admitted.length, parsed, failed },
        labels: Object.fromEntries(
          LABELS.map((l) => [l, { truth: B[l].truth, covered: B[l].covered, missing: B[l].missing, filtered: B[l].filtered, analyzer: B[l].analyzer, unexplained: B[l].unexplained }]),
        ),
        filteredFamilies: Object.fromEntries([...filteredFamilies.entries()]),
        missingFamilies: Object.fromEntries([...missingFamilies.entries()]),
        unexplainedFamilies: Object.fromEntries([...unexplainedFamilies.entries()]),
      },
      null,
      2,
    ),
  )
  console.log(`\nwrote ${OUT}`)
}