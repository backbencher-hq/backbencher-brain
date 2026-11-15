/**
 * BASH LANE — the incoming-edge A/B/C split, measured through production `parseFile`.
 *
 * ## Why this file exists
 *
 * `script/m14/diagnose-incoming.mts` (shared, supervisor-owned) separates three causes
 * that all render as "the incoming number is bad":
 *
 *   A  NAME IS NOT AN IDENTIFIER  the published symbol name is a bare simple name, so
 *      same-named declarations in different files collapse into one node.
 *   B  EMITTER/PUBLISHER FORMAT MISMATCH  the edge target does not equal the published
 *      name but its FINAL SEGMENT does. Mechanical to fix; free.
 *   C  EXTERNAL  stdlib / env / catalog, legitimately outside the corpus.
 *
 * The supervisor's row for this lane is `incoming-whole.tsv`:
 *
 *     bash   600   6   623   5084        files  fired  ambiguous  unresolved
 *
 * Two things about that instrument are reproduced here verbatim so the numbers are
 * comparable — the A/B/C DEFINITIONS and the SAMPLE (`find <corpus> -name '*.sh' | sort
 * | head -N`). Two things are changed, both deliberate, both declared here:
 *
 *   1. ENTRY POINT. The shared instrument calls `ASTEngine.parseFile` directly, which is
 *      the per-file unit and SKIPS the pipeline stages production indexing runs
 *      (pool-worker timeouts, truncation, enhancements). This probe calls
 *      `parseFile` from `src/ast/pool-worker.ts`, the production entry, so every edge
 *      counted here is an edge the index would store. `--entry ast` runs the shared
 *      instrument's entry for the A/B difference, which is a fact about the instrument.
 *   2. ROUTING. `*.sh` only, because the shared instrument takes a bare extension. The
 *      production router also admits `*.bash`, `.bashrc`, `.bash_profile` and
 *      extensionless shebang files, so `--ext sh` is a SUBSET of this lane's corpus and
 *      a whole-corpus figure needs `--router`. Both are printed with their population.
 *
 * ## What is NOT decided here
 *
 * A target in the B bucket is a mechanically recoverable edge. It is NOT proof the
 * analyzer is wrong — it is proof two code paths spell one symbol differently. Which of
 * them is wrong is a CONTRACT decision, and this probe only measures the size of the
 * disagreement. A target in the C bucket is not proof it is external either; the probe
 * prints the C residue per name so it can be adjudicated by hand, and the classification
 * heuristics it prints are LABELLED HEURISTICS with their own measured error rate, not
 * verdicts.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-abc.mts \
 *     [--sample 600] [--ext sh] [--order path|hash] [--router] [--entry pool|ast] [--json out]
 *
 * NO REGEX in the measurement path: every name below comes from `r.symbols[].name`,
 * `r.relationships[].target` or the filesystem.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { ASTEngine } from "../../../../src/ast/engine"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (n: string) => argv.includes(`--${n}`)
const SAMPLE = Number(flag("sample") ?? 600)
const EXT = flag("ext") ?? "sh"
const ORDER = flag("order") ?? "path"
const ENTRY = flag("entry") ?? "pool"

interface FileRec { abs: string; dir: string; rel: string; repo: string; hash: string }
const files: FileRec[] = []

if (ORDER === "path") {
  // The shared instrument's exact population.
  const listed = execFileSync(
    "bash",
    ["-lc", `find ${CR} -name '*.${EXT}' -type f 2>/dev/null | sort | head -${SAMPLE}`],
    { encoding: "utf8", maxBuffer: 1 << 28 },
  )
    .trim()
    .split("\n")
    .filter(Boolean)
  for (const abs of listed) {
    files.push({
      abs,
      dir: path.dirname(abs),
      rel: abs,
      repo: abs.slice(CR.length + 1).split("/")[0],
      hash: createHash("sha256").update(abs.slice(CR.length + 1)).digest("hex"),
    })
  }
} else {
  // This lane's reproducible sample: git-tracked files, ascending sha256 of repo/relpath.
  let scanned = 0
  for (const e of readdirSync(CR)) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8", maxBuffer: 1 << 28 })
        .split("\n").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      scanned++
      if (detectLanguageFromPath(abs, "") !== "bash") continue
      const hash = createHash("sha256").update(`${e}/${rel}`).digest("hex")
      if (files.some((f) => f.hash === hash)) continue
      files.push({ abs, dir, rel, repo: e, hash })
    }
  }
  files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
  if (has("router")) {
    // already router-admitted above
  } else {
    files.length = Math.min(files.length, SAMPLE)
  }
  void scanned
}

const sample = files.slice(0, SAMPLE)

/** published name -> files / kinds / distinct qualifiedNames that declare it */
const byName = new Map<string, { files: Set<string>; kinds: Set<string>; quals: Set<string> }>()
/** one row per edge, so a target's cost can be attributed per type and per file */
const edges: { t: string; type: string; file: string; src: string }[] = []
let parsed = 0
let failed = 0
let degraded = 0
let symbols = 0
const digest = createHash("sha256")

for (const f of sample) {
  let r: any
  try {
    if (ENTRY === "ast") {
      r = await ASTEngine.parseFile(f.abs, readFileSync(f.abs, "utf8"))
    } else {
      r = await parseFile(f.abs, f.dir)
    }
    parsed++
  } catch {
    failed++
    continue
  }
  const syms: any[] = r?.symbols ?? []
  symbols += syms.length
  if (r?.degraded) degraded++
  for (const s of syms) {
    let e = byName.get(s.name)
    if (!e) byName.set(s.name, (e = { files: new Set(), kinds: new Set(), quals: new Set() }))
    e.files.add(f.abs)
    e.kinds.add(String(s.kind))
    if (s.qualifiedName && s.qualifiedName !== s.name) e.quals.add(String(s.qualifiedName))
  }
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (!t) continue
    const type = String(e?.type ?? "")
    edges.push({ t, type, file: f.abs, src: String(e?.source ?? "") })
    digest.update(`${f.abs}\u0000${type}\u0000${e?.source ?? ""}\u0000${t}\n`)
  }
}

const distinctTargets = [...new Set(edges.map((e) => e.t))]
const unresolved = distinctTargets.filter((t) => !byName.has(t))
const ambiguous = distinctTargets
  .filter((t) => byName.has(t))
  .map((t) => ({ t, d: byName.get(t)! }))
  .filter((x) => x.d.files.size > 1)

const repos = new Set(sample.map((f) => f.repo))
const out: any = {
  population: {
    corpusRoot: CR, order: ORDER, ext: EXT, sample: sample.length, repos: repos.size,
    entry: ENTRY, parsed, failed, degraded, symbols,
    relationshipEdges: edges.length, distinctTargets: distinctTargets.length,
    analyzerDigest: digest.digest("hex").slice(0, 16),
  },
  totals: { ambiguous: ambiguous.length, unresolved: unresolved.length },
}

console.log(
  `BASH A/B/C  order=${ORDER} ext=${EXT} entry=${ENTRY}  sample=${sample.length} repos=${repos.size}`,
)
console.log(
  `  parsed ${parsed}  failed ${failed}  degraded ${degraded}  symbols ${symbols}  edges ${edges.length}  distinct targets ${distinctTargets.length}  digest ${out.population.analyzerDigest}`,
)
console.log(`  ambiguous ${ambiguous.length}  unresolved ${unresolved.length}`)
console.log()

// ---------------------------------------------------------------- A
console.log(`A  NAME IS NOT AN IDENTIFIER`)
if (ambiguous.length) {
  const noQual = ambiguous.filter((x) => x.d.quals.size === 0).length
  console.log(`   ambiguous targets (>1 file declaring the name): ${ambiguous.length}`)
  console.log(`   of those, NO distinct qualifiedName: ${noQual} (${Math.round((100 * noQual) / ambiguous.length)}%)`)
  const hist = new Map<string, number>()
  for (const a of ambiguous) {
    const k = a.d.files.size > 10 ? "11+" : String(a.d.files.size)
    hist.set(k, (hist.get(k) ?? 0) + 1)
  }
  console.log(`   declarations-per-colliding-name: ${[...hist.entries()].sort().map(([k, v]) => `${k}:${v}`).join("  ")}`)
  for (const a of ambiguous.sort((x, y) => y.d.files.size - x.d.files.size).slice(0, 8)) {
    console.log(`     ${String(a.d.files.size).padStart(4)} files declare  ${a.t}  [${[...a.d.kinds].join("|")}]  quals=${a.d.quals.size}`)
  }
  // what the ambiguous edges COST, per type
  const ambSet = new Set(ambiguous.map((a) => a.t))
  const cost = new Map<string, number>()
  for (const e of edges) if (ambSet.has(e.t)) cost.set(e.type, (cost.get(e.type) ?? 0) + 1)
  console.log(`   ambiguous EDGES by type: ${JSON.stringify(Object.fromEntries([...cost].sort((a, b) => b[1] - a[1])))}`)
}
out.a = {
  ambiguousTargets: ambiguous.length,
  ambiguousNoQualifiedName: ambiguous.filter((x) => x.d.quals.size === 0).length,
  ambiguousEdges: edges.filter((e) => ambiguous.some((a) => a.t === e.t)).length,
  worst: ambiguous.sort((x, y) => y.d.files.size - x.d.files.size).slice(0, 20)
    .map((a) => ({ target: a.t, files: a.d.files.size, kinds: [...a.d.kinds], quals: a.d.quals.size })),
}
console.log()

// ---------------------------------------------------------------- B
console.log(`B  EMITTER/PUBLISHER FORMAT MISMATCH  (cheapest real win)`)
const dotted = unresolved.filter((t) => t.includes("."))
const lastSegHits = dotted.filter((t) => byName.has(t.split(".").pop()!))
console.log(`   unresolved targets: ${unresolved.length}`)
console.log(`   containing '.': ${dotted.length} (${dotted.length ? Math.round((100 * dotted.length) / unresolved.length) : 0}%)`)
console.log(`   final segment IS a published name: ${lastSegHits.length} (${dotted.length ? Math.round((100 * lastSegHits.length) / dotted.length) : 0}%)`)
if (lastSegHits.length) {
  const cost = new Map<string, number>()
  for (const e of edges) {
    if (byName.has(e.t)) continue
    if (!e.t.includes(".")) continue
    if (!byName.has(e.t.split(".").pop()!)) continue
    cost.set(e.type, (cost.get(e.type) ?? 0) + 1)
  }
  const total = [...cost.values()].reduce((a, b) => a + b, 0)
  console.log(`   EDGES recoverable by fixing the name function: ${total}`)
  console.log(`   by edge type: ${JSON.stringify(Object.fromEntries([...cost].sort((a, b) => b[1] - a[1])))}`)
  console.log(`   examples: ${lastSegHits.slice(0, 10).map((s) => `"${s}"`).join(" ")}`)
  out.b = {
    unresolved, dotted: dotted.length, lastSegHits: lastSegHits.length,
    recoverableEdges: total, byType: Object.fromEntries(cost),
    examples: lastSegHits.slice(0, 40),
  }
}
console.log()

// ---------------------------------------------------------------- C
const fmtFixed = new Set(lastSegHits)
const external = unresolved.filter((t) => !fmtFixed.has(t))
console.log(`C  EXTERNAL / GENUINELY ABSENT  (needs an explicit external marker, not a resolver)`)
console.log(`   unresolved remaining after fixing B: ${external.length}`)
const byType = new Map<string, number>()
for (const e of edges) {
  if (byName.has(e.t) || fmtFixed.has(e.t)) continue
  byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
}
console.log(`   residual unresolved EDGES by type: ${JSON.stringify(Object.fromEntries([...byType].sort((a, b) => b[1] - a[1])))}`)

// Name SHAPE census over the C residue. These are COUNTS OF SPELLING, not judgements:
// no entry here is claimed to be external until a name is read and adjudicated by hand.
const shapes = new Map<string, string[]>()
for (const t of external) {
  const up = [...t].every((ch) => ch >= "A" && ch <= "Z" || ch === "_" || (ch >= "0" && ch <= "9"))
  const lo = [...t].every((ch) => ch >= "a" && ch <= "z" || ch === "_")
  const key = t.includes("/") ? "contains /" : t.includes(".") ? "contains ." : t.includes("-") ? "contains -" : up ? "ALL-CAPS (env-shaped)" : lo ? "all-lower" : "mixed"
  if (!shapes.has(key)) shapes.set(key, [])
  shapes.get(key)!.push(t)
}
console.log(`   C residue by name SHAPE (a spelling count, not a verdict):`)
for (const [k, v] of [...shapes.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`     ${String(v.length).padStart(5)}  ${k}   e.g. ${v.slice(0, 5).join(" ")}`)
}
const cap = [...shapes.entries()].sort((a, b) => b[1].length - a[1].length)[0]
if (cap) {
  console.log(`   top residue names (${cap[0]}):`)
  const h = new Map<string, number>()
  for (const t of cap[1]) h.set(t, (h.get(t) ?? 0) + 1)
  console.log(`     ` + [...h.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([t, n]) => `${t}(${n})`).join(" "))
}
out.c = {
  afterB: external.length,
  edgesByType: Object.fromEntries(byType),
  shapes: Object.fromEntries([...shapes.entries()].map(([k, v]) => [k, v.length])),
  residue: external.slice(0, 500),
}

// ------------------------------------------------- incoming-check.ts equivalence
//
// `validation/m14/measurements/incoming-whole.tsv` records bash as
// `600 6 623 5084` (files fired ambiguous unresolved). That row came from
// `script/m14/incoming-check.ts`, whose definitions are NOT the ones above:
//
//   unresolvedTargets / ambiguousTargets are counted PER EDGE, not per distinct target
//     (incoming-check.ts:238-256 recomputes them by looping `rels`, one increment per rel)
//   ambiguous means `published.get(tgt).length > 1` where the array is DISTINCT KINDS
//     (incoming-check.ts:141-149, 249) — so a name published once as `variable` and once
//     as `function` is "ambiguous", while a name declared in 52 files under a single kind
//     is NOT
//   self-loops (src === tgt) are skipped before either counter
//
// Three different numbers are in circulation under the word "incoming". This block
// reproduces the tsv's definitions on this sample so the two are comparable, and prints
// them next to the diagnose-incoming definitions rather than instead of them.
{
  let icUnres = 0
  let icAmb = 0
  let icSelf = 0
  let icEdges = 0
  for (const e of edges) {
    if (e.src === e.t) { icSelf++; continue }
    icEdges++
    const d = byName.get(e.t)
    if (!d) { icUnres++; continue }
    if (d.kinds.size > 1) icAmb++
  }
  // Variant 2: incoming-check registers the qualifiedName as an EXTRA resolution key
  // (incoming-check.ts:186-194), so a target spelling the qualified form resolves. bash's
  // analyzer sets `scope` and not `qualifiedName`, and pool-worker.ts:930 derives
  // `${scope}.${name}` — so this variant is the shared instrument's ACTUAL behaviour.
  const byQ = new Map<string, Set<string>>()
  for (const [name, d] of byName) {
    for (const q of d.quals) {
      const e2 = byQ.get(q)
      if (e2) for (const k of d.kinds) e2.add(k)
      else byQ.set(q, new Set(d.kinds))
    }
  }
  let qUnres = 0
  let qAmb = 0
  for (const e of edges) {
    if (e.src === e.t) continue
    const d = byName.get(e.t)
    const kq = d ? undefined : byQ.get(e.t)
    const hits = d ? d.kinds : kq
    if (!hits || hits.size === 0) { qUnres++; continue }
    if (hits.size > 1) qAmb++
  }
  console.log(`EQUIVALENCE  script/m14/incoming-check.ts definitions, same sample, production parseFile`)
  console.log(`   edges counted (non-self-loop) ${icEdges}  self-loops ${icSelf}`)
  console.log(`   unresolved  ${icUnres}   <- EDGES, not distinct targets`)
  console.log(`   ambiguous   ${icAmb}   <- EDGES whose target name carries >1 distinct KIND`)
  console.log(`   + qualifiedName registered as a resolution key (what incoming-check does):`)
  console.log(`      qualifiedName keys ${byQ.size}   unresolved ${qUnres}   ambiguous ${qAmb}`)
  console.log(`      edges that resolve ONLY via a qualifiedName: ${icUnres - qUnres}`)
  out.incomingCheckEquivalent = {
    edges: icEdges, selfLoops: icSelf, unresolvedEdges: icUnres, ambiguousEdgesByKind: icAmb,
    qualifiedNameKeys: byQ.size, unresolvedEdgesWithQualifiedKeys: qUnres, ambiguousEdgesWithQualifiedKeys: qAmb,
    resolvedOnlyViaQualifiedName: icUnres - qUnres,
  }
  console.log()
}

const jf = flag("json")
if (jf) {
  writeFileSync(jf as string, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${jf as string}`)
}
