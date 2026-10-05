/**
 * clean-wide-aggregate — merge sharded census JSON into one population-level report.
 *
 * WHAT IT ADDS AND WHY. Three of the census's figures cannot be merged by summing,
 * and each has a stated rule here rather than a silent one:
 *
 *   `n`, `heuristic`, `noLine`, `unknownEndpoint`, `selfEdges`, `conf`, `meta`
 *       — per-edge counters, disjoint by construction: a shard partition of the file
 *         set cannot double-count an edge. SUMMED.
 *   `typeFiles`
 *       — per-type distinct FILES. Summing per-shard counts would over-count every
 *         file that appears in more than one shard's per-type list, so the actual
 *         lists are UNIONED. `perType[t].files` from each shard is ignored for this.
 *   `corpusBoth`
 *       — resolution against a name index built from the SAMPLE. Inside a shard that
 *         index covers only that shard, so summing it would UNDERSTATE the
 *         population figure by an amount that depends on shard count — a number that
 *         moves when the instrument's own knob moves. It is therefore NOT summed.
 *         Instead every shard's `edgePairs` are resolved ONCE here against the union of
 *         all shards' names, using the SAME `resolves()` the census uses. That is the
 *         figure the un-sharded census would have printed at the same population.
 *   `intraBoth`
 *       — resolved per file against that file's own symbols, so it needs no global
 *         index and is exactly additive. It is SUMMED and never re-derived from
 *         `edgePairs`, because `edgePairs` carries no file context and could not
 *         reproduce the file-local tier even in principle.
 *
 * The resolution function is DUPLICATED rather than imported, because `resolves()` in
 * the census closes over that process's own name index. The duplication is guarded:
 * `--compare <single-process census .json>` prints every per-type figure from this
 * aggregate beside the single-process figure for the SAME population and exits
 * non-zero on any edge-count disagreement, so a drift between the copy and the
 * original is a printed number and a non-zero exit rather than a silent difference.
 *
 * Usage:
 *   npx tsx script/m14/clean-wide-aggregate.mts --in /tmp/clean-wide-walk
 *   npx tsx script/m14/clean-wide-aggregate.mts --in /tmp/clean-wide-control-shards \
 *       --compare /tmp/clean-wide-control/single.json
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : "" }
const IN = arg("--in")
const COMPARE = arg("--compare")
if (!IN || !fs.existsSync(IN)) {
  console.error("usage: clean-wide-aggregate.mts --in <walk dir> [--compare <single-process census .json>]")
  process.exit(2)
}

const shards = fs.readdirSync(IN).filter((f) => /^shard-\d+\.json$/.test(f)).sort()
if (!shards.length) { console.error(`no shard-*.json in ${IN}`); process.exit(2) }

type Shard = {
  sampled: number; filesParsed: number; parseFail: number; fallbackFiles: number
  symbols: number; emptyNames: number; unknownKind: number; totalEdges: number
  kindTally: Record<string, number>; evidenceTally: Record<string, number>
  perType: Record<Type, { n: number; intraBoth: number; corpusBoth: number; heuristic: number; noLine: number; unknownEndpoint: number; selfEdges: number; conf: Record<string, number>; meta: Record<string, number> }>
  typeFiles?: Record<Type, string[]>
  names?: string[]; qnames?: string[]
  /** [typeIndex, source, target] — the index is a number, the two endpoints are names. */
  edgePairs?: [number, string, string][]
}
const loaded: Shard[] = shards.map((f) => JSON.parse(fs.readFileSync(path.join(IN, f), "utf8")) as Shard)

// ---------------------------------------------------------------- global index
const corpusNames = new Set<string>()
const corpusQNames = new Set<string>()
for (const s of loaded) {
  for (const n of s.names ?? []) corpusNames.add(n)
  for (const n of s.qnames ?? []) corpusQNames.add(n)
}

/** Byte-identical to clean-ontology-census.ts's `resolves`, plus the corpus tier. */
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

// ---------------------------------------------------------------- totals
const add = (a: Record<string, number>, b: Record<string, number> | undefined) => {
  for (const [k, v] of Object.entries(b ?? {})) a[k] = (a[k] ?? 0) + v
}
let sampled = 0, filesParsed = 0, parseFail = 0, fallbackFiles = 0
let symbols = 0, emptyNames = 0, unknownKind = 0, totalEdges = 0
const kindTally: Record<string, number> = Object.create(null)
const evidenceTally: Record<string, number> = Object.create(null)
const typeFiles: Record<Type, Set<string>> = Object.create(null)
for (const t of ALL_TYPES) typeFiles[t] = new Set<string>()
const acc: Record<Type, {
  n: number; intraBoth: number; corpusBoth: number; heuristic: number; noLine: number
  unknownEndpoint: number; selfEdges: number; shardCorpusBothSum: number
  conf: Record<string, number>; meta: Record<string, number>
}> = Object.create(null)
for (const t of ALL_TYPES) {
  acc[t] = { n: 0, intraBoth: 0, corpusBoth: 0, heuristic: 0, noLine: 0, unknownEndpoint: 0, selfEdges: 0, shardCorpusBothSum: 0, conf: Object.create(null), meta: Object.create(null) }
}

for (const s of loaded) {
  sampled += s.sampled; filesParsed += s.filesParsed; parseFail += s.parseFail ?? 0
  fallbackFiles += s.fallbackFiles ?? 0; symbols += s.symbols
  emptyNames += s.emptyNames ?? 0; unknownKind += s.unknownKind ?? 0; totalEdges += s.totalEdges
  add(kindTally, s.kindTally); add(evidenceTally, s.evidenceTally)
  for (const t of ALL_TYPES) {
    const r = s.perType[t]
    if (!r) continue
    const a = acc[t]
    a.n += r.n; a.intraBoth += r.intraBoth; a.heuristic += r.heuristic
    a.noLine += r.noLine; a.unknownEndpoint += r.unknownEndpoint; a.selfEdges += r.selfEdges
    a.shardCorpusBothSum += r.corpusBoth
    add(a.conf, r.conf); add(a.meta, r.meta)
    for (const f of s.typeFiles?.[t] ?? []) typeFiles[t].add(f)
  }
}

// ---------------------------------------------------------------- resolve once
//
// ONLY the corpus tier is re-derived here. Two rules, both learned from a control run
// that read 39,168 edges against a true 30,744 and intraBoth at 198.8%:
//
//   1. `intraBoth` is SUMMED from the shards and never re-derived. It is resolved
//      against each FILE'S OWN symbols, and `edgePairs` carries no file context, so it
//      is not re-derivable from them — and it needs no global index, so summing is
//      exact. Adding a second increment here is what produced the 200% rows.
//   2. Resolution needs BOTH endpoints. The first version read only `p[2]`, the target,
//      which would report an edge resolved when its source was unknown. The census's
//      own rule is `sC && tC`; this reproduces that rule at the global tier.
//
// The global union is a superset of every file's own names, so `resolves(x, union,
// false)` already includes the corpus fallback and equals `resolves(x, union, true)`.
let pairsResolved = 0
let pairsUnresolved = 0
let srcUnresolved = 0
for (const s of loaded) {
  for (const p of s.edgePairs ?? []) {
    const t = ALL_TYPES[p[0]]
    if (!t) continue
    const [, src, tgt] = p
    const sOk = resolves(src, corpusNames, corpusQNames, false)
    const tOk = resolves(tgt, corpusNames, corpusQNames, false)
    if (sOk && tOk) acc[t].corpusBoth++
    else {
      pairsUnresolved++
      if (!sOk) srcUnresolved++
    }
    pairsResolved++
  }
}

// ---------------------------------------------------------------- report
const pct = (a: number, b: number) => (b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(1)}%`)
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

let excluded: string[] = []
const summaryPath = path.join(IN, "walk-summary.json")
if (fs.existsSync(summaryPath)) {
  const s = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as { excluded?: string[] }
  excluded = s.excluded ?? []
}

console.log(`clean WIDE aggregate — ${shards.length} shards from ${IN}`)
console.log(`files ATTEMPTED ${sampled}   files MEASURED ${filesParsed}   files EXCLUDED-unmeasured ${excluded.length}`)
const denom = sampled + excluded.length
console.log(`measured / (attempted + excluded) = ${denom ? ((filesParsed / denom) * 100).toFixed(2) : "n/a"}%  of a declared population of ${denom}`)
console.log(`parse failures ${parseFail}   fallback (structural) files ${fallbackFiles}`)
console.log(`symbols ${symbols.toLocaleString()}   empty names ${emptyNames}   empty/unknown kind ${unknownKind}`)
console.log(`total relationship edges ${totalEdges.toLocaleString()}`)
console.log(`edge pairs re-resolved ${pairsResolved.toLocaleString()}   unresolvable at BOTH ends ${pairsUnresolved.toLocaleString()} (source alone unresolvable ${srcUnresolved.toLocaleString()})`)

console.log("\nSYMBOL KINDS")
for (const [k, v] of Object.entries(kindTally).sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 16)}${v.toLocaleString()}`)
console.log("\nSYMBOL evidenceClass")
for (const [k, v] of Object.entries(evidenceTally).sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 24)}${v.toLocaleString()}`)

console.log("\nPER-TYPE (Q2 FIRES / Q5 RESOLVED / Q6 CONFIDENT)")
console.log([w("type", 13), w("edges", 9), w("files", 7), w("intraBoth", 11), w("corpusBoth", 11), w("intra%", 8), w("corpus%", 8), w("<0.7", 7), w("noLine", 7), w("unkEP", 6), w("self", 6)].join(""))
console.log("-".repeat(120))
for (const t of ALL_TYPES) {
  const a = acc[t]
  if (a.n === 0) { console.log(`${w(t, 13)}${w("0", 9)}NOT EMITTED on this population`); continue }
  console.log([
    w(t, 13), w(a.n.toLocaleString(), 9), w(typeFiles[t].size.toLocaleString(), 7),
    w(`${a.intraBoth}/${a.n}`, 11), w(`${a.corpusBoth}/${a.n}`, 11),
    w(pct(a.intraBoth, a.n), 8), w(pct(a.corpusBoth, a.n), 8),
    w(String(a.heuristic), 7), w(String(a.noLine), 7), w(String(a.unknownEndpoint), 6), w(String(a.selfEdges), 6),
  ].join(""))
}

console.log("\nCORPUS RESOLUTION — re-derived here, and why the shards' own figures are not summed")
console.log("Each shard resolved against only ITS OWN names, so its corpusBoth is measured")
console.log("against a fraction of the population and summing it would understate by an amount")
console.log("that moves when --shards moves. The column above is every edge resolved once against")
console.log("the UNION of all shard names. The shards' own sum is printed beside it for comparison.")
console.log([w("type", 13), w("edges", 9), w("global-corpus%", 14), w("shard-summed%", 14), w("shard-summed n", 14)].join(""))
for (const t of ALL_TYPES) {
  const a = acc[t]
  if (a.n === 0) continue
  const g = pct(a.corpusBoth, a.n)
  const s = pct(a.shardCorpusBothSum, a.n)
  console.log([w(t, 13), w(a.n.toLocaleString(), 9), w(g, 14), w(s, 14), w(a.shardCorpusBothSum.toLocaleString(), 14)].join(""))
}

console.log("\nPER-TYPE confidence distribution")
for (const t of ALL_TYPES) {
  const a = acc[t]
  if (a.n === 0) continue
  console.log(`  ${w(t, 13)}${Object.entries(a.conf).sort((x, y) => Number(y[0]) - Number(x[0])).map(([k, v]) => `${k}:${v}`).join(" ")}`)
}
console.log("\nPER-TYPE edge metadata discriminator")
for (const t of ALL_TYPES) {
  const a = acc[t]
  if (a.n === 0) continue
  console.log(`  ${w(t, 13)}${Object.entries(a.meta).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${v}`).join(" ")}`)
}

if (excluded.length) {
  console.log(`\nEXCLUDED — UNMEASURED, reported as zero edges nowhere in this output:`)
  for (const f of excluded) console.log(`  ${f}`)
}
if (COMPARE) {
  // The CONTROL. The sharded path is only quotable if it reproduces the single-process
  // census on the same population, so this is a gate and not a nicety: any edge-count
  // disagreement is a defect in the sharding or the merge, and exits 4.
  if (!fs.existsSync(COMPARE)) { console.error(`--compare: no such file ${COMPARE}`); process.exit(2) }
  const one = JSON.parse(fs.readFileSync(COMPARE, "utf8")) as Shard
  console.log(`\nCONTROL — this aggregate vs the single-process census ${COMPARE}`)
  const rows: string[] = []
  let bad = 0
  const cmpNum = (label: string, a: number, b: number) => {
    const ok = a === b
    if (!ok) bad++
    rows.push(`  ${w(label, 22)} aggregate ${w(a.toLocaleString(), 12)} single ${w(b.toLocaleString(), 12)} ${ok ? "MATCH" : "*** MISMATCH ***"}`)
  }
  cmpNum("files sampled", sampled, one.sampled)
  cmpNum("files parsed", filesParsed, one.filesParsed)
  cmpNum("symbols", symbols, one.symbols)
  cmpNum("empty names", emptyNames, one.emptyNames ?? 0)
  cmpNum("unknown kinds", unknownKind, one.unknownKind ?? 0)
  cmpNum("TOTAL edges", totalEdges, one.totalEdges)
  for (const t of ALL_TYPES) {
    cmpNum(`edges ${t}`, acc[t].n, one.perType?.[t]?.n ?? 0)
    cmpNum(`intraBoth ${t}`, acc[t].intraBoth, one.perType?.[t]?.intraBoth ?? 0)
    cmpNum(`corpusBoth ${t}`, acc[t].corpusBoth, one.perType?.[t]?.corpusBoth ?? 0)
    cmpNum(`<0.7 ${t}`, acc[t].heuristic, one.perType?.[t]?.heuristic ?? 0)
  }
  console.log(rows.join("\n"))
  console.log(bad === 0
    ? `\nCONTROL PASS — ${rows.length} figures compared, 0 mismatches. The sharded path reproduces the single-process census.`
    : `\nCONTROL FAIL — ${bad} of ${rows.length} figures disagree. Do not quote any number from this aggregate.`)
  process.exit(bad === 0 ? 0 : 4)
}
