/**
 * PHP INCOMING CENSUS — WHY each unresolved edge is unresolved, over the WHOLE admitted corpus.
 *
 * ## The question this answers, and why the gate cannot
 *
 * `incoming-gate.ts php php 60` reports one line:
 *
 *     VERDICT: FAIL — 135 ambiguous + 2483 unresolved of 3257 edges
 *     (pooled corpus key space: 194 ambiguous + 2403 unresolved)
 *
 * That number is about ONE STRIDE SAMPLE of 60 files, resolved against the key space of the
 * files IN THAT RUN. It cannot separate the three things an unresolved edge can be:
 *
 *   1. DECLARED IN THE CORPUS, and unresolved only because this run's budget did not
 *      include the file that declares it. `PHPUnit\Framework\TestCase` is phpunit's OWN
 *      class; a 60-file stride over the whole corpus holds ~2 phpunit files, so the
 *      declaration is out of scope by construction. Fixing "resolution" here means
 *      nothing in the analyzer; the sample is the defect.
 *   2. GENUINELY EXTERNAL — declared by php-src or by a library this corpus does not
 *      carry. There is no declaration to resolve to anywhere, and the honest edge is one
 *      that SAYS SO (`metadata` external marker, the gate's declared exception).
 *   3. A REAL DEFECT — the name is spelled so no declaration could ever answer it, or the
 *      analyzer emits an endpoint it cannot justify.
 *
 * So this census builds a key space from the UNSAMPLED ADMITTED POPULATION (every `.php`
 * file the gate would admit, all repositories), then re-runs the gate's own stride sample
 * and asks of every unresolved target: is it published ANYWHERE in the corpus? And of the
 * ones that are not: what SHAPE is the target, because the gate's external-claim verifier
 * looks up `targetOwner` (everything before the final `.`) and a PHP target carries either
 * no separator at all (`RuntimeException`) or a backslash (`PHPUnit\Framework\TestCase`) —
 * never a dot. That is measurable, and it decides whether marking can ever verify.
 *
 * ## Population and population sizes are PRINTED
 *
 * `docs/M14-HONESTY-CONTRACT.md` §"an instrument must declare the population": the admitted
 * count, the sampled count, the key-space size and the shape histogram are all reported, so
 * a reader can tell a zero from an unmeasured thing.
 *
 * Run: npx tsx validation/m14/fixtures/php/incoming-census.mts [maxFiles]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { targetOwner, classifyEdge, externalClaimOf } from "../../../../script/m14/incoming-rule"
// The analyzer's OWN php-src table, used only to SPLIT the not-in-corpus population for the
// report (how much of it the existing `labelExternalTargets` already recognises). It is a
// diagnostic column, not a truth side: the independent fact is the whole-corpus key space.
import { phpInternalKind } from "../../../../src/ast/real-php-analyzer"

const ROOT = process.cwd()
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXT = "php"
const MAX = Number(process.argv[2] ?? 60)

// ---------------------------------------------------------------- the admitted population
// EXACTLY the gate's discovery rule (its `discoverFiles`): real git checkouts only, tracked
// paths only, the lane extension, under SIZE_CAP. A census that admitted a different set
// would answer a question about a different corpus.
type Adm = { abs: string; repo: string; rel: string }
const admitted: Adm[] = []
let absent = 0
let overCap = 0
for (const name of readdirSync(CR).sort()) {
  const dir = path.join(CR, name)
  try {
    if (!statSync(dir).isDirectory()) continue
  } catch {
    continue
  }
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(`.${EXT}`)) continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > SIZE_CAP) { overCap++; continue }
    } catch { absent++; continue }
    admitted.push({ abs, repo: name, rel })
  }
}
admitted.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
console.log(`admitted .${EXT} files   ${admitted.length}   (repos ${new Set(admitted.map((a) => a.repo)).size})`)
console.log(`excluded: ${absent} absent from the working tree, ${overCap} over ${SIZE_CAP} bytes`)

// ---------------------------------------------------------------- the whole-corpus key space
// Built with the PRODUCTION entry point (`parseFile`) rather than the analyzer class, so the
// key space is the one production would build — same reason the gate uses it.
const declWhole = new Map<string, number>()
const qnameWhole = new Map<string, number>()
const filesWithSymbols = new Set<string>()
for (const f of admitted) {
  let res: any
  try {
    res = await parseFile(f.abs, "php")
  } catch {
    continue
  }
  if (!res?.success) continue
  if ((res.symbols ?? []).length > 0) filesWithSymbols.add(f.abs)
  for (const s of res.symbols ?? []) {
    const n = s?.name
    if (typeof n === "string" && n.length > 0) declWhole.set(n, (declWhole.get(n) ?? 0) + 1)
    const q = s?.qualifiedName
    if (typeof q === "string" && q.length > 0) qnameWhole.set(q, (qnameWhole.get(q) ?? 0) + 1)
  }
}
console.log(`whole-corpus key space: ${declWhole.size} distinct names, ${qnameWhole.size} distinct qualifiedNames, from ${filesWithSymbols.size} files carrying symbols`)

// ---------------------------------------------------------------- the gate's stride sample
// The gate's own arithmetic (`discoverFiles`): stride = floor(total / maxFiles), take every
// stride-th entry from the sorted list until maxFiles are picked.
const total = admitted.length
const stride = MAX > 0 && total > MAX ? Math.max(1, Math.floor(total / MAX)) : 1
const sample: Adm[] = []
for (let i = 0; i < admitted.length && sample.length < MAX; i += stride) sample.push(admitted[i])
console.log(`gate sample (maxFiles=${MAX}): ${sample.length} files, stride ${stride}`)

// ---------------------------------------------------------------- the run's own key spaces
// MIRRORS THE GATE EXACTLY (`incoming-gate.ts` `measure`): the key space is each symbol's
// `name` AND its `qualifiedName` (a second SPELLING of the same declaration, counted as the
// same declaration), and the verdict's scope is the file's own repository.
const runProjectDecl = new Map<string, Map<string, number>>() // repo -> key -> count
const runProjectKinds = new Map<string, Map<string, Set<string>>>()
const edges: { label: string; tgt: string; repo: string; externalMark: unknown; claim: any; src: string }[] = []
let parsed = 0
let aliasedKeys = 0
{
  const countKey = (repo: string, key: string, kind: string) => {
    let m = runProjectDecl.get(repo)
    if (!m) runProjectDecl.set(repo, (m = new Map()))
    m.set(key, (m.get(key) ?? 0) + 1)
    let k = runProjectKinds.get(repo)
    if (!k) runProjectKinds.set(repo, (k = new Map()))
    let s = k.get(key)
    if (!s) k.set(key, (s = new Set()))
    s.add(kind)
  }
  for (const f of sample) {
    let res: any
    try {
      res = await parseFile(f.abs, "php")
    } catch {
      continue
    }
    if (!res?.success) continue
    parsed++
    for (const s of res.symbols ?? []) {
      const n = String(s?.name ?? "")
      if (n.length === 0) continue
      const kind = String(s?.kind ?? "")
      countKey(f.repo, n, kind)
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== n) { countKey(f.repo, q, kind); aliasedKeys++ }
    }
    for (const r of res.relationships ?? []) {
      const label = String(r?.type ?? "")
      const tgt = String(r?.target ?? "")
      if (!tgt) continue
      edges.push({ label, tgt, repo: f.repo, externalMark: r?.metadata?.external, claim: externalClaimOf(r), src: f.rel })
    }
  }
}
console.log(`run parsed ${parsed}/${sample.length} files, ${edges.length} edges, ${aliasedKeys} qualifiedName aliases\n`)

// ---------------------------------------------------------------- classify
const shapeOf = (t: string): string => {
  if (t.includes(".")) return "dotted(owner-shaped)"
  if (t.includes("\\")) return "backslash-qualified"
  if (/[:/\s]/.test(t)) return "other-non-identifier"
  return "bare"
}
const isDeclaredInCorpus = (t: string): boolean =>
  (declWhole.get(t) ?? 0) > 0 || (qnameWhole.get(t) ?? 0) > 0
const ownerDeclaredInCorpus = (t: string): boolean => {
  const o = targetOwner(t)
  if (o === null) return false
  return (declWhole.get(o) ?? 0) > 0 || (qnameWhole.get(o) ?? 0) > 0
}

type Agg = {
  edges: number; resolvedRun: number; ambRun: number; unresolvedRun: number
  declaredInCorpus: number; resolvableIfWholeCorpus: number
  externalByTable: number; externalTableIsBoolean: number
  phpSrcDeclared: number
  shapes: Map<string, number>
  names: Map<string, number>
  inCorpusNames: Map<string, number>
  externalNames: Map<string, number>
  dottedNames: string[]
}
const byType = new Map<string, Agg>()
for (const e of edges) {
  let a = byType.get(e.label)
  if (!a) {
    byType.set(e.label, (a = {
      edges: 0, resolvedRun: 0, ambRun: 0, unresolvedRun: 0,
      declaredInCorpus: 0, resolvableIfWholeCorpus: 0, externalByTable: 0, externalTableIsBoolean: 0,
      phpSrcDeclared: 0,
      shapes: new Map(), names: new Map(), inCorpusNames: new Map(), externalNames: new Map(), dottedNames: [],
    }))
  }
  a.edges++
  const projectKey = runProjectDecl.get(e.repo)?.get(e.tgt) ?? 0
  if (projectKey > 1) a.ambRun++
  else if (projectKey === 1) a.resolvedRun++
  else {
    a.unresolvedRun++
    const sh = shapeOf(e.tgt)
    a.shapes.set(sh, (a.shapes.get(sh) ?? 0) + 1)
    a.names.set(e.tgt, (a.names.get(e.tgt) ?? 0) + 1)
    if (sh === "dotted(owner-shaped)" && a.dottedNames.length < 20) a.dottedNames.push(e.tgt)
    const inCorpus = isDeclaredInCorpus(e.tgt) || ownerDeclaredInCorpus(e.tgt)
    if (inCorpus) {
      a.declaredInCorpus++
      a.inCorpusNames.set(e.tgt, (a.inCorpusNames.get(e.tgt) ?? 0) + 1)
    } else {
      a.externalNames.set(e.tgt, (a.externalNames.get(e.tgt) ?? 0) + 1)
      if (phpInternalKind(e.tgt) !== null) a.phpSrcDeclared++
    }
    if ((declWhole.get(e.tgt) ?? 0) === 1 || (qnameWhole.get(e.tgt) ?? 0) === 1) a.resolvableIfWholeCorpus++
    if (e.externalMark !== undefined) {
      a.externalByTable++
      if (e.externalMark === true) a.externalTableIsBoolean++
    }
  }
}

console.log(`=== THE SPLIT THE GATE CANNOT MAKE (per relationship type, gate's own scope) ===`)
let totUnres = 0, totDeclared = 0, totExternalTable = 0, totResolvableWhole = 0, totAmb = 0, totEdges = 0, totPhpSrc = 0
const externalNamesAll = new Map<string, number>()
for (const [label, a] of [...byType].sort()) {
  totEdges += a.edges
  totAmb += a.ambRun
  totUnres += a.unresolvedRun
  totDeclared += a.declaredInCorpus
  totExternalTable += a.externalByTable
  totResolvableWhole += a.resolvableIfWholeCorpus
  totPhpSrc += a.phpSrcDeclared
  for (const [n, c] of a.externalNames) externalNamesAll.set(n, (externalNamesAll.get(n) ?? 0) + c)
  const shapes = [...a.shapes].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(
    `${label.padEnd(12)} edges ${String(a.edges).padStart(5)}  resolved ${String(a.resolvedRun).padStart(5)}  ` +
    `amb ${String(a.ambRun).padStart(4)}  UNRESOLVED ${String(a.unresolvedRun).padStart(5)}`)
  if (a.unresolvedRun > 0) {
    console.log(`             shapes: ${shapes}`)
    console.log(`             DECLARED IN CORPUS (budget artifact): ${a.declaredInCorpus}` +
      `   unique-in-whole-corpus: ${a.resolvableIfWholeCorpus}` +
      `   carrying metadata.external: ${a.externalByTable} (of which ===true: ${a.externalTableIsBoolean})` +
      `   php-src-declared: ${a.phpSrcDeclared}`)
    const top = [...a.names].sort((x, y) => y[1] - x[1]).slice(0, 12)
    console.log(`             top unresolved: ${top.map(([n, c]) => `${n}(${c})`).join(" ")}`)
    const inC = [...a.inCorpusNames].sort((x, y) => y[1] - x[1]).slice(0, 8)
    if (inC.length) console.log(`             of those, IN CORPUS: ${inC.map(([n, c]) => `${n}(${c})`).join(" ")}`)
    const exN = [...a.externalNames].sort((x, y) => y[1] - x[1]).slice(0, 8)
    if (exN.length) console.log(`             of those, NOT IN CORPUS: ${exN.map(([n, c]) => `${n}(${c})`).join(" ")}`)
    if (a.dottedNames.length) console.log(`             DOTTED (the only shape verifyExternalClaim can look up): ${a.dottedNames.join(" ")}`)
  }
}
console.log(`\nTOTALS: edges ${totEdges}   ambiguous ${totAmb}   unresolved ${totUnres}`)
console.log(`        (a) declared-in-corpus, out of this run's budget : ${totDeclared}`)
console.log(`        (b) NOT declared anywhere in the admitted corpus : ${totUnres - totDeclared}`)
console.log(`            of (b): declared by php-src (phpInternalKind): ${totPhpSrc}`)
console.log(`        resolvable-if-target-unique-in-whole-corpus      : ${totResolvableWhole}`)
console.log(`        already carrying metadata.external               : ${totExternalTable}`)
console.log(`\n=== SELF-CHECK against incoming-gate.ts php php ${MAX} ===`)
console.log(`  gate printed: 135 ambiguous + 2483 unresolved of 3257 edges`)
console.log(`  this census : ${totAmb} ambiguous + ${totUnres} unresolved of ${totEdges} edges`)
console.log(`  ${totAmb === 135 && totUnres === 2483 && totEdges === 3257 ? "MATCH — the split above is a split of the gate's own number" : "MISMATCH — the split is NOT of the gate's number; do not read it as one"}`)

// A machine-readable artifact, so the Lead can audit the names without re-running the sweep.
console.log(`\n=== AS THE GATE WOULD CLASSIFY THEM (its own rule, imported not re-implemented) ===`)
let gateCounts: Record<string, number> = {}
{
  const counts = new Map<string, number>()
  for (const e of edges) {
    const c = classifyEdge(
      runProjectDecl.get(e.repo)!, runProjectKinds.get(e.repo)!, e.tgt, e.claim,
    )
    counts.set(c.outcome, (counts.get(c.outcome) ?? 0) + 1)
  }
  for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${v}`)
  gateCounts = Object.fromEntries(counts)
  const unresSplit = new Map<string, number>()
  for (const e of edges) {
    const c = classifyEdge(runProjectDecl.get(e.repo)!, runProjectKinds.get(e.repo)!, e.tgt, e.claim)
    if (c.outcome !== "unresolved") continue
    unresSplit.set(e.label, (unresSplit.get(e.label) ?? 0) + 1)
  }
  console.log(`  of the unresolved: ${[...unresSplit].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")}`)
}

const artifact = {
  generatedAt: new Date().toISOString(),
  corpusRoot: CR,
  population: { admitted: admitted.length, repos: new Set(admitted.map((a) => a.repo)).size, sample: sample.length, stride, parsed, edges: edges.length },
  gateLine: `VERDICT: FAIL — 135 ambiguous + 2483 unresolved of 3257 edges`,
  totals: { edges: totEdges, ambiguous: totAmb, unresolved: totUnres, declaredInCorpus: totDeclared, notInCorpus: totUnres - totDeclared, phpSrcDeclared: totPhpSrc, resolvableUniqueWholeCorpus: totResolvableWhole, alreadyMarkedExternal: totExternalTable },
  gateClassification: gateCounts,
  byType: Object.fromEntries([...byType].map(([k, a]) => [k, {
    edges: a.edges, resolved: a.resolvedRun, ambiguous: a.ambRun, unresolved: a.unresolvedRun,
    declaredInCorpus: a.declaredInCorpus, notInCorpus: a.unresolvedRun - a.declaredInCorpus,
    phpSrcDeclared: a.phpSrcDeclared, resolvableUniqueWholeCorpus: a.resolvableIfWholeCorpus,
    alreadyMarkedExternal: a.externalByTable, shapes: Object.fromEntries(a.shapes),
    dottedNames: a.dottedNames,
    notInCorpusNames: Object.fromEntries([...a.externalNames].sort((x, y) => y[1] - x[1]).slice(0, 60)),
    inCorpusNames: Object.fromEntries([...a.inCorpusNames].sort((x, y) => y[1] - x[1]).slice(0, 60)),
  }])),
  notInCorpusTop: Object.fromEntries([...externalNamesAll].sort((x, y) => y[1] - x[1]).slice(0, 60)),
}

const outPath = path.join(ROOT, "validation/m14/fixtures/php/incoming-census.json")
writeFileSync(outPath, JSON.stringify(artifact, null, 2))
console.log(`\nartifact: ${path.relative(ROOT, outPath)}`)
