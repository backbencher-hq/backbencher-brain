/**
 * THE INCOMING SPLIT — the gate's population, the gate's rule, and the SAME EDGES against TWO
 * key spaces.
 *
 * ## Why two scopes
 *
 * `script/m14/incoming-gate.ts` is the arbiter, and it samples: `bash sh 60` parses a 60-file
 * stride of the 2,360 tracked `.sh` files and resolves every edge against the symbols THOSE 60
 * FILES published. A target declared in a file the stride did not pick is therefore
 * `unresolved` even though the project declares it — the number is partly a budget, not a
 * defect. The fsharp lane measured exactly this (9,183 edges: 4,871 unresolved against the
 * sample key space, 2,106 against the whole-corpus key space) and php shows the same direction.
 *
 * So this census classifies ONE edge set twice:
 *
 *   SAMPLE SCOPE   the key space the gate actually builds (the parsed sample), so its numbers
 *                  reproduce the gate's;
 *   PROJECT SCOPE  the key space of the WHOLE admitted project of every sampled repository,
 *                  so what survives is what no amount of budget would resolve.
 *
 * The difference between the two IS the sample-budget column, and the residue at project scope
 * is the only part that is a fact about the analyzer.
 *
 * ## The rule is imported, never copied
 *
 * `classifyEdge`, `externalClaimOf`, `emptyOutcomes`, `tally` come from
 * `script/m14/incoming-rule.ts`, because two copies of a counting rule are two rules. The
 * population is discovered with the gate's own rule: git checkouts under the corpus root,
 * `git ls-files`, the extension argument, the 1 MB cap, sorted, then a STRIDE. `--compare`
 * checks the sample-scope totals against a captured `incoming-gate.ts --json` run and REFUSES to
 * present the split as evidence about that run when they disagree.
 *
 * ## Evidence per residue class
 *
 *   calls    `bash -c 'type -t NAME'` — the SHELL's own resolver: `file` is a PATH program,
 *            `builtin`/`keyword` is provided by the shell. Declared-anywhere-in-the-project is
 *            checked against the project key space, not against the sample.
 *   uses     declared in the project, or declared nowhere in it (environment/shell-supplied).
 *   paths    `source`/`.` operands, classified by SHAPE — a path is not a symbol, so the gate's
 *            key space cannot resolve one by construction.
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/bash/probe-bash-incoming-split.mts [--ext sh] [--nf 60]
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
// THE LANE'S DECLARED POPULATION IS `sh,bash,zsh` (both lane maps carry all three), so the split has
// to admit all three or it describes a narrower population than the gate it is compared against.
const EXTS = (flag("ext") ?? "sh,bash,zsh").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean)
const EXT = EXTS.join(",")
const NF = Number(flag("nf") ?? "60")
const COMPARE = flag("compare")
const REPO_WIDE = argv.includes("--repo-wide")
const SIZE_CAP = 1024 * 1024
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

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
    if (!EXTS.some((x) => rel.toLowerCase().endsWith(`.${x}`))) continue
    const abs = path.join(dir, rel)
    try {
      const size = statSync(abs).size
      if (size > SIZE_CAP) {
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

/** One key space: declaration counts and kinds, keyed on `name` AND on `qualifiedName` — the
 *  alias rule the gate applies, so a lane that targets a qualified spelling is not punished. */
type KeySpace = { decl: Map<string, number>; kinds: Map<string, Set<string>> }
const newKeySpace = (): KeySpace => ({ decl: new Map(), kinds: new Map() })
const addSymbol = (ks: KeySpace, name: string, kind: string) => {
  ks.decl.set(name, (ks.decl.get(name) ?? 0) + 1)
  let s = ks.kinds.get(name)
  if (!s) ks.kinds.set(name, (s = new Set()))
  s.add(kind)
}
const addSymbolWithAlias = (ks: KeySpace, name: string, qualifiedName: string, kind: string) => {
  addSymbol(ks, name, kind)
  if (qualifiedName.length > 0 && qualifiedName !== name) addSymbol(ks, qualifiedName, kind)
}

// ------------------------------------------------------------------ phase 1: the sampled walk
/**
 * ONE KEY SPACE PER PROJECT — the gate resolves "against the file's OWN PROJECT", so a global
 * key space would manufacture ambiguity that production does not have (the first version of
 * this rewrite used one space for all 117 repositories and read 291 ambiguous against the
 * gate's 188; the comparison below is what caught it).
 */
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
  const repoSpace = sampleSpaceFor(repo)
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    addSymbolWithAlias(repoSpace, name, String(s?.qualifiedName ?? ""), String(s?.kind ?? ""))
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
/**
 * DECLARED ANYWHERE IN THE PROJECT — built by parsing the WHOLE admitted population of the
 * repositories this run sampled (not the stride sample). This is the key space production has
 * after a full index, and the question the second column asks: is there a declaration of this
 * name in this project AT ALL.
 */
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
const markedSample: Pending[] = []
for (const e of pending) {
  const sk = sampleSpaceFor(e.repo)
  const cs = classifyEdge(sk.decl, sk.kinds, e.tgt, e.claim)
  const os = rowsSample.get(e.label)!
  os.edges++
  tally(os, cs, e.tgt, e.label)
  if (cs.outcome === "unresolved") unresolvedSample.push(e)
  if (cs.outcome === "externalVerified" || cs.outcome === "externalUnverified") markedSample.push(e)

  const pk = projectSpaces.get(e.repo) ?? newKeySpace()
  const cp = classifyEdge(pk.decl, pk.kinds, e.tgt, e.claim)
  const op = rowsProject.get(e.label)!
  op.edges++
  tally(op, cp, e.tgt, e.label)
  if (cp.outcome === "unresolved") unresolvedProject.push(e)
}

// ------------------------------------------------------------------ evidence
/** The shell's OWN resolver, asked rather than guessed: `file` is a PATH executable, `builtin`
 *  is provided by the shell, `keyword` is reserved, `function` would be a shell function. */
function shellType(name: string): string {
  try {
    const out = execFileSync("bash", ["-c", `type -t ${JSON.stringify(name)} 2>/dev/null || true`], { encoding: "utf8" }).trim()
    return out.length > 0 ? out : "(unresolvable)"
  } catch {
    return "(probe-failed)"
  }
}
const typeCache = new Map<string, string>()
const shellTypeOf = (name: string): string => {
  if (!typeCache.has(name)) typeCache.set(name, shellType(name))
  return typeCache.get(name)!
}
const shapeOfPath = (s: string): string => {
  const dyn = s.includes("$") || s.includes("`")
  const slash = s.includes("/")
  const dot = s.lastIndexOf(".")
  const ext = dot > 0 ? s.slice(dot) : ""
  const shellExt = ext === ".sh" || ext === ".bash" || ext === ".zsh" || ext === ".inc" || ext === ".lib" || ext === ".env"
  if (!slash && !shellExt && !dyn) return "NOT PATH-SHAPED (identifier)"
  if (dyn && slash) return "dynamic path"
  if (dyn) return "dynamic (expansion decides the path)"
  if (s.charCodeAt(0) === 47) return "absolute path"
  if (slash) return "relative path"
  return "bare filename with a shell extension"
}
const kindsOf = (ks: KeySpace, name: string): string => [...(ks.kinds.get(name) ?? [])].sort().join("|")

const totals = (rows: Map<Type, Row>): Outcomes & { edges: number } => {
  const t: any = { ...emptyOutcomes(), edges: 0 }
  for (const r of rows.values()) {
    t.edges += r.edges
    // `edges` is summed above; counting it again in this loop doubled the printed total.
    for (const k of Object.keys(t)) if (k !== "edges" && typeof t[k] === "number") t[k] += (r as any)[k] ?? 0
  }
  return t
}
const tS = totals(rowsSample)
const tP = totals(rowsProject)
const bad = (t: any) => t.ambiguousByDecl + t.unresolved + t.externalRefuted + t.bindingRefuted + t.causeRefuted

console.log(`PROBE-BASH-INCOMING-SPLIT  lang=bash ext=.${EXT}`)
console.log(`  population: ${files.length} sampled of ${corpusTotal} tracked .${EXT} files in ${repos.size} repos; parsed=${parsed} failed=${failed} degraded=${degraded}`)
console.log(`  project key space: ${REPO_WIDE ? `ON (whole admitted population of the sampled repos: ${[...projectSpaces.values()].reduce((n, ks) => n + ks.decl.size, 0)} distinct keys)` : "OFF (--repo-wide to build it)"}`)
console.log("")
console.log("THE SAME EDGES AGAINST TWO KEY SPACES")
console.log(`  ${"scope".padEnd(34)} resolved   amb(decl)  unresolved  extVerified  extUnverified  extRefuted`)
for (const [label, t] of [["SAMPLE SCOPE (the gate's stride)", tS], ["PROJECT SCOPE (whole project)", tP]] as const) {
  console.log(`  ${label.padEnd(34)} ${String(t.resolved).padStart(8)} ${String(t.ambiguousByDecl).padStart(11)} ${String(t.unresolved).padStart(11)} ${String(t.externalVerified).padStart(12)} ${String(t.externalUnverified).padStart(14)} ${String(t.externalRefuted).padStart(11)}`)
}
console.log(`  edges=${tS.edges}   VERDICT sample: ${bad(tS) === 0 ? "PASS" : "FAIL"} (${tS.ambiguousByDecl} amb + ${tS.unresolved} unres)   PROJECT: ${bad(tP) === 0 ? "PASS" : "FAIL"} (${tP.ambiguousByDecl} amb + ${tP.unresolved} unres)`)
console.log(`  SAMPLE-BUDGET, not defects: ${tS.unresolved - tP.unresolved} edges resolve once the project's other files are in the key space (${tS.unresolved} -> ${tP.unresolved})`)
console.log("")
console.log("PER TYPE, sample -> project unresolved")
for (const ty of ALL_TYPES) {
  const a = rowsSample.get(ty)!
  const b = rowsProject.get(ty)!
  if (a.edges === 0) continue
  console.log(`  ${ty.padEnd(13)} edges=${String(a.edges).padStart(5)}  sample: resolved=${String(a.resolved).padStart(5)} amb=${String(a.ambiguousByDecl).padStart(4)} unres=${String(a.unresolved).padStart(4)}  ->  project: resolved=${String(b.resolved).padStart(5)} amb=${String(b.ambiguousByDecl).padStart(4)} unres=${String(b.unresolved).padStart(4)}`)
}

// ------------------------------------------------------------------ the residue, with evidence
const byName = new Map<string, { type: Type; count: number; repos: Set<string> }>()
for (const e of unresolvedProject) {
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
  if (a.type === "calls") {
    const declaredInProject = [...a.repos].some((r) => (projectSpaces.get(r)?.decl.get(tgt) ?? 0) > 0)
    const st = shellTypeOf(tgt)
    if (declaredInProject) {
      inCorpus.push(`${tgt} [${[...a.repos].map((r) => kindsOf(projectSpaces.get(r)!, tgt)).join(",")}] x${a.count}`)
      bump("calls: DECLARED IN THE PROJECT (a defect: the key space could answer it)", tgt, a.count)
    } else if (st === "file") bump("calls: EXTERNAL, PATH-RESOLVED (`type -t` = file; declared nowhere in the project)", tgt, a.count)
    else if (st === "builtin" || st === "keyword") bump(`calls: SHELL ${st.toUpperCase()} (not a project symbol, not a binary either)`, tgt, a.count)
    else bump(`calls: UNRESOLVABLE ON THIS HOST (${st}) - a program this machine lacks, or a computed name`, tgt, a.count)
  } else if (a.type === "uses") {
    const declaredInProject = [...a.repos].some((r) => (projectSpaces.get(r)?.decl.get(tgt) ?? 0) > 0)
    if (declaredInProject) {
      inCorpus.push(`${tgt} [${[...a.repos].map((r) => kindsOf(projectSpaces.get(r)!, tgt)).join(",")}] x${a.count}`)
      bump("uses: DECLARED IN THE PROJECT (a defect: the key space could answer it)", tgt, a.count)
    } else bump("uses: ENVIRONMENT/SHELL-SUPPLIED (declared nowhere in the project)", tgt, a.count)
  } else {
    bump(`${a.type}: PATH-SHAPED, NOT A SYMBOL (the key space cannot answer it by construction)`, tgt, a.count)
  }
}
console.log("")
console.log(`RESIDUE AT PROJECT SCOPE (${unresolvedProject.length} edges, ${byName.size} distinct type+name) — what no amount of budget resolves`)
for (const [b, x] of [...buckets.entries()].sort((p, q) => q[1].edges - p[1].edges)) {
  console.log(`  ${String(x.edges).padStart(5)} edges / ${String(x.names).padStart(3)} names  ${b}`)
  console.log(`        e.g. ${x.examples.join(", ")}`)
}
if (inCorpus.length) {
  console.log("")
  console.log(`IN-CORPUS AND STILL UNRESOLVED AT PROJECT SCOPE (${inCorpus.length} distinct type+name) — these are DEFECTS, not externals:`)
  for (const s of inCorpus.slice(0, 30)) console.log(`  ${s}`)
}
if (unresolvedProject.length) {
  const pathShapes = new Map<string, number>()
  for (const e of unresolvedProject) {
    if (e.label !== "imports" && e.label !== "references") continue
    const s = shapeOfPath(e.tgt)
    pathShapes.set(s, (pathShapes.get(s) ?? 0) + 1)
  }
  if (pathShapes.size) {
    console.log("")
    console.log("  path-shaped residue, by shape (imports + references):")
    for (const [s, n] of [...pathShapes.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${s}`)
  }
}

// ------------------------------------------------------------------ comparability check
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

// ------------------------------------------------------------------ the marked-set audit
if (markedSample.length && REPO_WIDE) {
  const byMarkedName = new Map<string, { count: number; repos: Set<string> }>()
  for (const e of markedSample) {
    const key = `${e.label}\u0000${e.tgt}`
    let a = byMarkedName.get(key)
    if (!a) byMarkedName.set(key, (a = { count: 0, repos: new Set() }))
    a.count++
    a.repos.add(e.repo)
  }
  let refutable = 0
  const sampleRows: string[] = []
  for (const [key, a] of byMarkedName) {
    const tgt = key.split("\u0000")[1]
    const kinds = new Set<string>()
    for (const repo of a.repos) {
      const ks = projectSpaces.get(repo)
      if (!ks) continue
      for (const k of ks.kinds.get(tgt) ?? []) kinds.add(k)
    }
    if (kinds.size > 0) {
      refutable += a.count
      if (sampleRows.length < 10) sampleRows.push(`${tgt} [${[...kinds].join("|")}] x${a.count}`)
    }
  }
  console.log("")
  console.log(`MARKED-SET AUDIT (${markedSample.length} edges carrying an external marker, ${byMarkedName.size} distinct type+name)`)
  console.log(`  target IS declared in the project (the claim would be REFUTED at project scope): ${refutable} edges${refutable === 0 ? "  — no false claims" : ""}`)
  for (const s of sampleRows) console.log(`      ${s}`)
  // WHICH claims the rule VERIFIED, printed with the spelling that verified them: a path target
  // whose last `.` gives the rule a dotted "owner" is verified on a spelling that is not an
  // identifier, and that is a fact about the rule a lane should be able to see.
  const verified: string[] = []
  for (const e of markedSample) {
    const ks = sampleSpaceFor(e.repo)
    const c = classifyEdge(ks.decl, ks.kinds, e.tgt, e.claim)
    if (c.outcome === "externalVerified") verified.push(`${e.tgt}  (verifiedBy=${c.verifiedBy})`)
  }
  if (verified.length) {
    console.log(`  claims the rule VERIFIED: ${verified.length}`)
    for (const v of verified.slice(0, 10)) console.log(`      ${v}`)
  } else console.log("  claims the rule VERIFIED: 0")
}
