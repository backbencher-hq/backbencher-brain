/**
 * GRAPHQL INCOMING SPLIT — the gate's population, the gate's rule, and the same edges against two
 * key spaces.
 *
 * ## Why this file exists
 *
 * `npx tsx script/m14/incoming-gate.ts graphql graphql 60` reads
 * `FAIL — 455 ambiguous + 2,317 unresolved of 11,158 edges`. The gate samples 60 files and resolves
 * every edge against the symbols THOSE FILES published, so the column mixes three different things:
 *
 *   SAMPLE BUDGET   the target is declared in another file of the same project — no amount of
 *                   analyzer work resolves it at 60 files, and production's full index does;
 *   EXTERNAL        the target is defined by the GraphQL SPECIFICATION rather than by any project
 *                   file (`String`, `Int`, `ID`, `@deprecated`, `__Schema`, …) — a language fact,
 *                   which is the only kind of evidence this programme accepts for an external claim;
 *   IN-CORPUS       the target IS declared by the project and the key space can answer it — a defect.
 *
 * The census classifies ONE edge set twice (sample scope, then whole-project scope) with the rule
 * IMPORTED from `script/m14/incoming-rule.ts`, never copied, and prints the residue at project scope
 * with the evidence that puts each name in its class. `--compare` refuses to present the sample
 * column as evidence about a gate run it disagrees with.
 *
 * ## The separator check, because this lane publishes `#`-suffixed keys
 *
 * HCL's history (and this programme's) records that a `#` in a published key made nine lanes'
 * claims unverifiable before the separator moved. GraphQL's analyzer publishes qualified selections
 * (`Type.field`) — so this file also reports how many published keys contain `#`, how many are
 * duplicated (two declarations with the SAME key), and how many edges target a key that is not
 * unique. A name-based resolution count is only meaningful if a name denotes one declaration.
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/graphql/probe-graphql-incoming-split.mts [--ext graphql] [--nf 60]
 *        [--compare <gate.json>] [--repo-wide]
 *
 * Read-only.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { classifyEdge, externalClaimOf, emptyOutcomes, tally } from "../../../../script/m14/incoming-rule"
import type { Outcomes } from "../../../../script/m14/incoming-rule"

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const EXT = (flag("ext") ?? "graphql").toLowerCase()
const NF = Number(flag("nf") ?? "60")
const COMPARE = flag("compare")
const REPO_WIDE = argv.includes("--repo-wide")
const SIZE_CAP = 1024 * 1024
const ALL_TYPES = ["calls", "extends", "implements", "uses", "imports", "exports", "contains", "references", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

/**
 * THE SPECIFICATION'S OWN DECLARATIONS — the language fact that licenses an external claim for this
 * lane. GraphQL predeclares five scalars, a set of introspection types, and its directives; none of
 * them is declared by any project file, and no extension can declare them (the spec forbids
 * redefining the built-in scalars). A project CAN declare a type named `String` in its own schema,
 * and the arbiter refutes the claim when it does — which is the point of marking rather than
 * assuming.
 */
const SPEC_SCALARS = new Set(["String", "Int", "Float", "Boolean", "ID"])
const SPEC_INTROSPECTION = new Set(["__Schema", "__Type", "__Field", "__InputValue", "__EnumValue", "__Directive", "__TypeKind", "__DirectiveLocation"])
const SPEC_DIRECTIVES = new Set(["deprecated", "skip", "include", "specifiedBy", "defer", "stream", "oneOf"])

// ------------------------------------------------------------------ discovery (the gate's rule)
const found: string[] = []
const repos = new Set<string>()
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
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!rel.toLowerCase().endsWith(`.${EXT}`)) continue
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > SIZE_CAP) {
        overCap++
        continue
      }
    } catch {
      absent++
      continue
    }
    found.push(abs)
    repos.add(name)
  }
}
found.sort()
const corpusTotal = found.length
let files = found
if (NF > 0 && corpusTotal > NF) {
  const stride = Math.max(1, Math.floor(corpusTotal / NF))
  const picked: string[] = []
  for (let i = 0; i < found.length && picked.length < NF; i += stride) picked.push(found[i])
  files = picked
}
const repoOf = (f: string): string => path.relative(CR, f).split(path.sep)[0]

const { parseFile } = await import(`${REPO_ROOT}/src/ast/pool-worker.ts`)

type KeySpace = { decl: Map<string, number>; kinds: Map<string, Set<string>>; dup: Map<string, number> }
const newKeySpace = (): KeySpace => ({ decl: new Map(), kinds: new Map(), dup: new Map() })
const addKey = (ks: KeySpace, key: string, kind: string) => {
  ks.decl.set(key, (ks.decl.get(key) ?? 0) + 1)
  if ((ks.decl.get(key) ?? 0) > 1) ks.dup.set(key, ks.decl.get(key)!)
  let s = ks.kinds.get(key)
  if (!s) ks.kinds.set(key, (s = new Set()))
  s.add(kind)
}
const addSymbolWithAlias = (ks: KeySpace, name: string, qualifiedName: string, kind: string) => {
  addKey(ks, name, kind)
  if (qualifiedName.length > 0 && qualifiedName !== name) addKey(ks, qualifiedName, kind)
}

// ------------------------------------------------------------------ phase 1: the sampled walk
const sampleSpaces = new Map<string, KeySpace>()
const sampleSpaceFor = (repo: string): KeySpace => {
  let ks = sampleSpaces.get(repo)
  if (!ks) sampleSpaces.set(repo, (ks = newKeySpace()))
  return ks
}
type Pending = { label: Type; tgt: string; claim: ReturnType<typeof externalClaimOf>; repo: string; file: string; line: number }
const pending: Pending[] = []
let parsed = 0
let failed = 0
let degraded = 0
for (const f of files) {
  let r: any
  try {
    r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any)
  } catch {
    failed++
    continue
  }
  if (!r) {
    failed++
    continue
  }
  parsed++
  if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
  const repo = repoOf(f)
  const ks = sampleSpaceFor(repo)
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    addSymbolWithAlias(ks, name, String(s?.qualifiedName ?? ""), String(s?.kind ?? ""))
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "") as Type
    if (!ALL_TYPES.includes(label)) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgt.length === 0) continue
    pending.push({ label, tgt, claim: externalClaimOf(rel), repo, file: f, line: Number(rel?.line_number ?? 0) })
  }
}

// ------------------------------------------------------------------ phase 2: the project key space
const projectSpaces = new Map<string, KeySpace>()
if (REPO_WIDE) {
  const sampleRepos = new Set(files.map(repoOf))
  for (const f of found) {
    const repo = repoOf(f)
    if (!sampleRepos.has(repo)) continue
    let r: any
    try {
      r = await parseFile(f, repo, { projectRoot: repo } as any)
    } catch {
      continue
    }
    if (!r) continue
    let ks = projectSpaces.get(repo)
    if (!ks) projectSpaces.set(repo, (ks = newKeySpace()))
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      addSymbolWithAlias(ks, name, String(s?.qualifiedName ?? ""), String(s?.kind ?? ""))
    }
  }
}

// ------------------------------------------------------------------ dual classification
type Row = Outcomes & { edges: number }
const rowsSample = new Map<Type, Row>()
const rowsProject = new Map<Type, Row>()
for (const t of ALL_TYPES) {
  rowsSample.set(t, { ...emptyOutcomes(), edges: 0 })
  rowsProject.set(t, { ...emptyOutcomes(), edges: 0 })
}
const unresolvedSample: Pending[] = []
const unresolvedProject: Pending[] = []
for (const e of pending) {
  const sk = sampleSpaceFor(e.repo)
  const cs = classifyEdge(sk.decl, sk.kinds, e.tgt, e.claim)
  const os = rowsSample.get(e.label)!
  os.edges++
  tally(os, cs, e.tgt, e.label)
  if (cs.outcome === "unresolved") unresolvedSample.push(e)

  // WITHOUT --repo-wide there is no project key space, and classifying against an EMPTY one would
  // report every edge as unresolved-at-project-scope — a column that looks like a measurement and is
  // an absence. The project rows are then left untouched and the report says so.
  if (!REPO_WIDE) continue
  const pk = projectSpaces.get(e.repo) ?? newKeySpace()
  const cp = classifyEdge(pk.decl, pk.kinds, e.tgt, e.claim)
  const op = rowsProject.get(e.label)!
  op.edges++
  tally(op, cp, e.tgt, e.label)
  if (cp.outcome === "unresolved") unresolvedProject.push(e)
}

const totals = (rows: Map<Type, Row>) => {
  const t: any = { ...emptyOutcomes(), edges: 0 }
  for (const r of rows.values()) {
    t.edges += r.edges
    for (const k of Object.keys(t)) if (k !== "edges" && typeof t[k] === "number") t[k] += (r as any)[k] ?? 0
  }
  return t
}
const tS = totals(rowsSample)
const tP = REPO_WIDE ? totals(rowsProject) : { ...emptyOutcomes(), edges: tS.edges }
const bad = (t: any): number => t.ambiguousByDecl + t.unresolved + t.externalRefuted + t.bindingRefuted + t.causeRefuted

/** `Owner.field` -> `Owner`; a bare name has no owner. */
const ownerOf = (t: string): string | null => {
  const i = t.indexOf(".")
  if (i <= 0) return null
  return t.slice(0, i)
}
/**
 * Is the target, or its owner, one of the specification's own names?
 *
 * A directive target arrives with its `@` (`@deprecated`, `@specifiedBy`, `@oneOf`), which the first
 * version of this test did not strip — it filed the spec's own directives under "type reference no
 * file declares", which is the difference between an external class and a defect. The `@` is part of
 * the SPELLING, not of the name.
 */
const specKind = (t: string): string | null => {
  const raw = ownerOf(t) ?? t
  const head = raw.startsWith("@") ? raw.slice(1) : raw
  if (raw.startsWith("__") || head.startsWith("__")) return "introspection type"
  if (SPEC_SCALARS.has(head)) return "spec scalar"
  if (SPEC_DIRECTIVES.has(head)) return "spec directive"
  return null
}
const isDirectiveTarget = (t: string): boolean => t.startsWith("@")

console.log(`PROBE-GRAPHQL-INCOMING-SPLIT  lang=graphql ext=.${EXT}`)
console.log(`  population: ${files.length} sampled of ${corpusTotal} tracked .${EXT} files in ${repos.size} repos; parsed=${parsed} failed=${failed} degraded=${degraded}; excluded absent=${absent} overCap=${overCap}`)
console.log(`  project key space: ${REPO_WIDE ? "ON" : "OFF (--repo-wide to build it)"}`)
console.log("")
console.log("THE SAME EDGES AGAINST TWO KEY SPACES")
console.log(`  ${"scope".padEnd(32)} resolved   amb(decl)  unresolved  extVerified  extUnverified  extRefuted`)
const scopes: [string, any][] = [["SAMPLE SCOPE (the gate's stride)", tS]]
if (REPO_WIDE) scopes.push(["PROJECT SCOPE (whole project)", tP])
else scopes.push(["PROJECT SCOPE (NOT BUILT — --repo-wide to measure it)", null])
for (const [label, t] of scopes) {
  if (t === null) {
    console.log(`  ${label.padEnd(32)}          —          —           —             —              —              —`)
    continue
  }
  console.log(`  ${label.padEnd(32)} ${String(t.resolved).padStart(8)} ${String(t.ambiguousByDecl).padStart(11)} ${String(t.unresolved).padStart(11)} ${String(t.externalVerified).padStart(12)} ${String(t.externalUnverified).padStart(14)} ${String(t.externalRefuted).padStart(11)}`)
}
console.log(`  edges=${tS.edges}  VERDICT sample: ${bad(tS) === 0 ? "PASS" : "FAIL"} (${tS.ambiguousByDecl} amb + ${tS.unresolved} unres)${REPO_WIDE ? `   PROJECT: ${bad(tP) === 0 ? "PASS" : "FAIL"} (${tP.ambiguousByDecl} amb + ${tP.unresolved} unres)` : "   PROJECT: not built"}`)
console.log(REPO_WIDE ? `  SAMPLE-BUDGET: ${tS.unresolved - tP.unresolved} edges resolve once the project's other files are in the key space (${tS.unresolved} -> ${tP.unresolved})` : "  SAMPLE-BUDGET: unmeasured (no project key space in this run)")
console.log("")
console.log("PER TYPE, sample -> project unresolved")
for (const ty of ALL_TYPES) {
  const a = rowsSample.get(ty)!
  const b = rowsProject.get(ty)!
  if (a.edges === 0) continue
  console.log(`  ${ty.padEnd(13)} edges=${String(a.edges).padStart(6)}  sample: resolved=${String(a.resolved).padStart(5)} amb=${String(a.ambiguousByDecl).padStart(4)} unres=${String(a.unresolved).padStart(4)}  ->  project: resolved=${String(b.resolved).padStart(5)} amb=${String(b.ambiguousByDecl).padStart(4)} unres=${String(b.unresolved).padStart(4)}`)
}

// ------------------------------------------------------------------ residue, with evidence
const residueSet = REPO_WIDE ? unresolvedProject : unresolvedSample
const byName = new Map<string, { type: Type; count: number; repos: Set<string> }>()
for (const e of residueSet) {
  const key = `${e.label}\u0000${e.tgt}`
  let a = byName.get(key)
  if (!a) byName.set(key, (a = { type: e.label, count: 0, repos: new Set() }))
  a.count++
  a.repos.add(e.repo)
}
const buckets = new Map<string, { edges: number; names: number; examples: string[] }>()
const bump = (b: string, tgt: string, n: number) => {
  let x = buckets.get(b)
  if (!x) buckets.set(b, (x = { edges: 0, names: 0, examples: [] }))
  x.edges += n
  x.names++
  if (x.examples.length < 6) x.examples.push(tgt)
}
const inCorpus: string[] = []
for (const [key, a] of [...byName.entries()].sort((x, y) => y[1].count - x[1].count)) {
  const tgt = key.split("\u0000")[1]
  const declaredInProject = REPO_WIDE && [...a.repos].some((r) => (projectSpaces.get(r)?.decl.get(tgt) ?? 0) > 0)
  const spec = specKind(tgt)
  if (declaredInProject) {
    inCorpus.push(`${tgt} x${a.count}`)
    bump(`${a.type}: DECLARED IN THE PROJECT (a defect: the key space could answer it)`, tgt, a.count)
  } else if (spec) {
    bump(`${a.type}: SPEC-BUILTIN ${spec} (the GraphQL specification declares it, no project file does)`, tgt, a.count)
  } else if (isDirectiveTarget(tgt)) {
    bump(`${a.type}: DIRECTIVE with no definition in the project (project-defined directives must resolve; spec ones are the bucket above)`, tgt, a.count)
  } else if (a.type === "references") {
    bump("references: EXECUTABLE REFERENCE — a field/fragment name no type in the project declares", tgt, a.count)
  } else if (a.type === "uses") {
    bump("uses: TYPE REFERENCE — a type name no file in the project declares", tgt, a.count)
  } else {
    bump(`${a.type}: OTHER (unclassified residue)`, tgt, a.count)
  }
}
console.log("")
console.log(`${REPO_WIDE ? "RESIDUE AT PROJECT SCOPE" : "RESIDUE AT SAMPLE SCOPE (project key space OFF — the budget column needs --repo-wide)"} (${residueSet.length} edges, ${byName.size} distinct type+name)`)
for (const [b, x] of [...buckets.entries()].sort((p, q) => q[1].edges - p[1].edges)) {
  console.log(`  ${String(x.edges).padStart(5)} edges / ${String(x.names).padStart(3)} names  ${b}`)
  console.log(`        e.g. ${x.examples.join(", ")}`)
}
if (inCorpus.length) {
  console.log("")
  console.log(`IN-CORPUS AND STILL UNRESOLVED AT ${REPO_WIDE ? "PROJECT" : "SAMPLE"} SCOPE (${inCorpus.length} distinct type+name) — DEFECTS:`)
  for (const s of inCorpus.slice(0, 25)) console.log(`  ${s}`)
}
// THE SPLIT THE BRIEF ASKS FOR, as three lines: external / in-corpus / the rest.
{
  const specEdges = [...buckets.entries()].filter(([b]) => b.includes("SPEC-BUILTIN")).reduce((n, [, x]) => n + x.edges, 0)
  const inCorpusEdges = [...buckets.entries()].filter(([b]) => b.includes("DECLARED IN THE PROJECT")).reduce((n, [, x]) => n + x.edges, 0)
  const restEdges = residueSet.length - specEdges - inCorpusEdges
  console.log("")
  console.log(`THE SPLIT (${REPO_WIDE ? "project" : "sample"} scope, ${residueSet.length} unresolved edges)`)
  console.log(`  EXTERNAL, licensed by the specification : ${specEdges} edges (${((specEdges / Math.max(1, residueSet.length)) * 100).toFixed(1)}%)`)
  console.log(`  IN-CORPUS, the key space can answer it  : ${inCorpusEdges} edges${inCorpusEdges === 0 ? "  (no defect in this column)" : "  <-- DEFECTS"}`)
  console.log(`  THE REST, characterised above           : ${restEdges} edges`)
}

// ------------------------------------------------------------------ the residue by type, for the split
console.log("")
console.log(`RESIDUE BY TYPE AT ${REPO_WIDE ? "PROJECT" : "SAMPLE"} SCOPE`)
for (const ty of ALL_TYPES) {
  const n = residueSet.filter((e) => e.label === ty).length
  if (n > 0) console.log(`  ${ty.padEnd(13)} ${n}`)
}

// ------------------------------------------------------------------ ambiguity characterisation
const ambNames = [...rowsProject.values()].flatMap((r) => (r as any).ambiguousNames ?? [])
const ambTop = new Map<string, number>()
for (const x of ambNames) ambTop.set(String(x.name), (ambTop.get(String(x.name)) ?? 0) + 1)
console.log("")
console.log(`AMBIGUITY AT PROJECT SCOPE: ${tP.ambiguousByDecl} edges (sample: ${tS.ambiguousByDecl}); top names in the gate's own 25-row worklist sample:`)
const ambTopRows = [...ambTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
if (!REPO_WIDE) {
  // at sample scope `ambiguousNames` come from the sample rows
  const ambS = [...rowsSample.values()].flatMap((r) => (r as any).ambiguousNames ?? [])
  const m = new Map<string, number>()
  for (const x of ambS) m.set(String(x.name), (m.get(String(x.name)) ?? 0) + 1)
  for (const [n, c] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`    ${String(c).padStart(3)}  ${n}`)
} else {
  for (const [n, c] of ambTopRows) console.log(`    ${String(c).padStart(3)}  ${n}`)
}

// ------------------------------------------------------------------ key uniqueness (the `#` history)
let keysWithHash = 0
let dupKeys = 0
let edgesOnDupKeys = 0
for (const ks of sampleSpaces.values()) {
  for (const k of ks.decl.keys()) if (k.includes("#")) keysWithHash++
  for (const k of ks.dup.keys()) dupKeys++
}
for (const e of pending) {
  const ks = sampleSpaceFor(e.repo)
  if ((ks.decl.get(e.tgt) ?? 0) > 1) edgesOnDupKeys++
}
console.log("")
console.log("KEY UNIQUENESS (the shape that made nine lanes' claims unverifiable)")
console.log(`  published keys containing '#': ${keysWithHash}`)
console.log(`  keys declared more than once in their project (sample scope): ${dupKeys}`)
console.log(`  edges targeting a non-unique key: ${edgesOnDupKeys}`)
const sampleDupSamples = [...sampleSpaces.values()].flatMap((ks) => [...ks.dup.keys()]).slice(0, 10)
if (sampleDupSamples.length) console.log(`  examples: ${sampleDupSamples.join(", ")}`)

if (COMPARE) {
  const g = JSON.parse(readFileSync(COMPARE, "utf8"))
  const gt = g.totals
  const same = gt.unresolved === tS.unresolved && gt.resolved === tS.resolved && gt.ambiguousByDecl === tS.ambiguousByDecl
  console.log("")
  console.log(`COMPARISON against ${COMPARE}`)
  console.log(`  gate   : resolved=${gt.resolved} amb=${gt.ambiguousByDecl} unresolved=${gt.unresolved}`)
  console.log(`  census : resolved=${tS.resolved} amb=${tS.ambiguousByDecl} unresolved=${tS.unresolved}   (sample scope)`)
  console.log(`  ${same ? "AGREE — the sample column is the gate's own set" : "DISAGREE — the sample column is NOT evidence about the gate's set"}`)
}
