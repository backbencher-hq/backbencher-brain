// ts-label-blind-audit.mjs — VERIFY_TS10: questions 3 and 4 of the six, measured.
//
// "Does an independent oracle agree?" and "is the edge carrying the RIGHT label?"
// are different questions, and an instrument that only answers the first cannot
// tell a missing edge from a mislabelled one. The shared differential reports one
// MISSING number over both: on element-plus it is 2,423, and its sample rows are
// `uses configProviderProps -> ExperimentalFeatures` and
// `references ConfigProviderProps -> configProviderProps` — which look like two
// different defects and may be one.
//
// So this instrument matches LABEL-BLIND first and only then asks which label each
// side chose:
//
//   same-label        the oracle and the analyzer agree, edge and label
//   other-label       the EDGE exists and the label differs -> a labelling finding,
//                     named as a family "truthLabel -> analyzerLabel"
//   MISSING           no edge under either label -> a genuinely absent edge
//   UNEXPLAINED       an analyzer edge with no truth row under any label
//
// The three oracles used here are the LANE's (script/m14/oracles/typescript-*.ts),
// each written from the tree sharing no rule with the analyzer. That is the
// harness's declared limitation and it is stated rather than argued around: an
// oracle that walks the SAME wasm grammar cannot see a grammar bug the analyzer
// also has. What it CAN see is every rule, key set and classification list, and
// those are where a mislabel lives.
//
// NO REGEX. Corpus selection by extension/size; normalisation by string ops.
//
// Usage:
//   bun script/m14/ts-label-blind-audit.mjs [--repo element-plus] [--files 200]
//        [--family-cap 20] [--out path.json]

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
const FAMILY_CAP = Number(argOf("--family-cap") ?? "20")
const MAX_BYTES = Number(argOf("--max-bytes") ?? "400000")
const OUT = argOf("--out")

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
const { deriveTypeScriptUsesTruth } = await import(`${ROOT}/script/m14/oracles/typescript-uses.ts`)
const { deriveTypeScriptReferencesTruth } = await import(`${ROOT}/script/m14/oracles/typescript-references.ts`)
const { deriveTypeScriptContainsTruth } = await import(`${ROOT}/script/m14/oracles/typescript-contains.ts`)

const norm = (t) => {
  let s = String(t ?? "").trim()
  const cut = Math.max(s.lastIndexOf("."), s.lastIndexOf(":"))
  if (cut >= 0) s = s.slice(cut + 1)
  return s.toLowerCase()
}

const AUDITED = ["uses", "references", "contains"]
const stat = { truth: 0, same: 0, other: 0, otherEndpoint: 0, endpointDiffers: 0, missing: 0, analyzer: 0, unexplained: 0 }
const otherFam = new Map()
const endpointFam = new Map()
const missingFam = new Map()
const unexpFam = new Map()
const whyFam = new Map()

let parsed = 0
let failed = 0
const parsers = {}

const add = (m, k, n, sample) => {
  const e = m.get(k) ?? { count: 0, rows: [] }
  e.count += n
  if (e.rows.length < FAMILY_CAP) e.rows.push(sample)
  m.set(k, e)
}

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
    if (!parsers[lang]) parsers[lang] = await getParser(lang)
    tree = await parsers[lang].parse(content, abs)
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

  const truth = [
    ...deriveTypeScriptUsesTruth(tree.rootNode),
    ...deriveTypeScriptReferencesTruth(tree.rootNode),
    ...deriveTypeScriptContainsTruth(tree.rootNode),
  ].filter((t) => AUDITED.includes(String(t.label)))
  const emitted = (res.relationships ?? []).filter((r) => AUDITED.includes(String(r.type ?? "")))

  // per-file maps: endpoint key -> label
  const tMap = new Map()
  for (const t of truth) {
    stat.truth++
    const k = `${norm(t.from)} ${norm(t.target)}`
    if (!tMap.has(k)) tMap.set(k, { label: String(t.label), n: 0, sample: `${t.from} -> ${t.target}`, why: t.why ?? "(none)", raw: `${t.from}\u0000${t.target}` })
    tMap.get(k).n++
    add(whyFam, `${t.label} / ${t.why ?? "(none)"}`, 1, `${rel}: ${t.from} -> ${t.target}`)
  }
  const aMap = new Map()
  for (const r of emitted) {
    stat.analyzer++
    const k = `${norm(r.source)} ${norm(r.target)}`
    if (!aMap.has(k)) aMap.set(k, { label: String(r.type), n: 0, sample: `${r.source} -> ${r.target}`, raw: `${r.source}\u0000${r.target}` })
    aMap.get(k).n++
  }
  for (const [k, t] of tMap) {
    const a = aMap.get(k)
    if (!a) {
      stat.missing += t.n
      add(missingFam, t.label, t.n, `${rel}: ${t.sample}`)
      continue
    }
    const shared = Math.min(t.n, a.n)
    // The match is on the differential's NORMALISED endpoint, so it merges
    // `Placement` with `placement` and `autocompleteProps` with `AutocompleteProps`.
    // Those rows are an ENDPOINT disagreement wearing a label bucket's clothes, and
    // counting them as "the label is wrong" would be a measurement artefact dressed
    // as a finding — so they are counted separately and reported separately.
    const endpointsIdentical = t.raw === a.raw
    if (a.label === t.label) {
      stat.same += shared
      if (!endpointsIdentical) stat.endpointDiffers += shared
    } else if (endpointsIdentical) {
      stat.other += shared
      add(otherFam, `${t.label} -> ${a.label}`, shared, `${rel}: truth "${t.sample}"  analyzer "${a.sample}"`)
    } else {
      stat.otherEndpoint += shared
      add(endpointFam, `${t.label} -> ${a.label}`, shared, `${rel}: truth "${t.sample}"  analyzer "${a.sample}"`)
    }
  }
  for (const [k, a] of aMap) {
    if (tMap.has(k)) continue
    stat.unexplained += a.n
    add(unexpFam, a.label, a.n, `${rel}: ${a.sample}`)
  }
}

const pad = (s, n) => (String(s) + " ".repeat(n)).slice(0, n)
const pct = (n, d) => (d === 0 ? "-" : `${((100 * n) / d).toFixed(1)}%`)
console.log(`ts label-blind audit — ${REPO}`)
console.log(`POPULATION: ${admitted.length} .ts/.tsx files of ${seen.length} seen (derived by readdir); ${parsed} measured, ${failed} failed`)
console.log(`labels audited: ${AUDITED.join(", ")} (the three the differential's allowlist admits for typescript)`)
console.log(`oracles: script/m14/oracles/typescript-{uses,references,contains}.ts (lane-owned; share no rule with the analyzer)\n`)
console.log(`truth rows ${stat.truth}   analyzer rows ${stat.analyzer}`)
console.log(`  same label      ${String(stat.same).padStart(7)}  ${pct(stat.same, stat.truth)} of truth`)
console.log(`  OTHER label     ${String(stat.other).padStart(7)}  ${pct(stat.other, stat.truth)} of truth  <- edge exists, label differs`)
console.log(`  MISSING         ${String(stat.missing).padStart(7)}  ${pct(stat.missing, stat.truth)} of truth  <- no edge under ANY label`)
console.log(`  OTHER label+ends ${String(stat.otherEndpoint).padStart(6)}  <- label AND at least one endpoint spelling differ`)
console.log(`  UNEXPLAINED     ${String(stat.unexplained).padStart(7)}  ${pct(stat.unexplained, stat.analyzer)} of analyzer rows`)
console.log(`  (of the same-label rows, ${stat.endpointDiffers} had the same label but a different endpoint SPELLING)`)
const show = (title, m) => {
  console.log(`\n${title}`)
  const e = [...m.entries()].sort((a, b) => b[1].count - a[1].count)
  if (!e.length) console.log("  (none)")
  for (const [k, v] of e.slice(0, 12)) {
    console.log(`  ${String(v.count).padStart(7)}  ${k}`)
    for (const r of v.rows.slice(0, 3)) console.log(`            ${r}`)
  }
}
show("OTHER-LABEL families (truth label -> analyzer label, endpoints identical):", otherFam)
show("ENDPOINT+LABEL families (normalised match only — spelling differs):", endpointFam)
show("MISSING families:", missingFam)
show("UNEXPLAINED families:", unexpFam)
show("truth-side surfaces (which position produced the row):", whyFam)

if (OUT) {
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        repo: REPO,
        population: { seen: seen.length, admitted: admitted.length, parsed, failed },
        labels: AUDITED,
        totals: stat,
        otherLabelFamilies: Object.fromEntries(otherFam),
        endpointAndLabelFamilies: Object.fromEntries(endpointFam),
        missingFamilies: Object.fromEntries(missingFam),
        unexplainedFamilies: Object.fromEntries(unexpFam),
        truthSurfaces: Object.fromEntries(whyFam),
      },
      null,
      2,
    ),
  )
  console.log(`\nwrote ${OUT}`)
}