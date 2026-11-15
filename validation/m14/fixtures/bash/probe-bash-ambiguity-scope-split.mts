/**
 * THE BASH SCOPE-SPLIT — the gate's 41,931 ambiguous edges, split by WHERE the name is declared,
 * so the ONE candidate rule's ceiling is a measured number before anything is written.
 *
 * ## Why this file exists, and how it differs from its three predecessors
 *
 * The lane already has ambiguity instruments, and they answer a DIFFERENT question:
 *
 *   `probe-bash-ambiguity-closure-whole.mts`  asks whether the edge's OWN PUBLISHED FIELDS
 *       re-discover exactly one declaration among the candidates the edge's own FILE declares
 *       more than once. Answer at 600 files: **0 still open** — every such edge either closes from
 *       `targetLine`/`targetKind`/`overridesLine` or carries `targetResolution: "ambiguousInFile"`.
 *   `probe-bash-declined-decomposition.mts`   asks whether those declines were FORCED by bash's
 *       scope chain or CHOSEN by a rule that saw an answer and did not publish it.
 *   `probe-bash-ambiguity-split.mts`          asks the same at 600 files with three buckets (S/M/X).
 *
 * **None of them measures the set the gate fails on.** `incoming-gate.ts bash sh 0` counts
 * declarations per BARE NAME across the file's whole PROJECT — 41,931 ambiguous of 112,823 — and
 * a name can be declared once in each of nine files while the edge's own file declares it not at
 * all. That is a SCOPE question, not a published-field question, and it decides whether the
 * candidate fix (a file-scoped `qualifiedName`, the css-D15 shape) has any ceiling here at all.
 *
 * ## The classes, and which side of the ceiling each falls on
 *
 *   DUP-EMISSION     the same edge published twice for one node — a defect, not an ambiguity
 *   SAME-FILE-ONE    the edge's own file declares the name exactly ONCE -> a file-scoped target
 *                    naming that declaration resolves it -> **inside the ceiling**
 *   SAME-FILE-MULTI  the edge's own file declares it 2+ times -> needs the line as well (the
 *                    closure probe measures whether the fields already carry it) -> separate
 *   CROSS-FILE-ONLY  the edge's own file declares it NOT AT ALL; other files do -> which one the
 *                    shell binds is decided by which file was SOURCED at runtime, which no
 *                    per-file analyzer can see -> **outside the ceiling**
 *
 * The fleet's qualification fixes have measured ceilings of 100% (php `calls`), 1.7% (julia
 * `uses`), 1.0% (julia `references`), 0.6% (julia `calls`) and ZERO (xml twins). Bash's is not
 * borrowed from any of them.
 *
 * ## Rule and population imported, never copied
 *
 * `classifyEdge`, `externalClaimOf`, `emptyOutcomes`, `tally` come from
 * `script/m14/incoming-rule.ts`; the population rule (git checkouts, `git ls-files`, extension,
 * 1 MB cap, sorted, stride) matches the gate's, and `--compare <gate.json>` REFUSES to present
 * the split as evidence about a gate run whose totals it does not reproduce.
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/bash/probe-bash-ambiguity-scope-split.mts [--ext sh] [--nf 0]
 *        [--compare <gate.json>]
 *
 * Read-only.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { classifyEdge, externalClaimOf, emptyOutcomes, tally } from "../../../../script/m14/incoming-rule"
import type { Outcomes } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : undefined
}
// THE LANE'S DECLARED POPULATION IS `sh,bash,zsh` (residual-gate.ts and incoming-gate.ts
// both map bash to all three) — NOT `.sh` alone, which is what this lane's spec recorded
// (112,823 edges against the gate's 148,816). A comma list is accepted so the split can be
// run on the declared population, and the totals are comparable with the gate's.
const EXTS = (flag("ext") ?? "sh,bash,zsh").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean)
const NF = Number(flag("nf") ?? "0")
// THE SHARDED ROUTE, mirroring clean-ontology-census.ts's `index % N` rule on the sorted admitted list.
// Needed because a sequential census of a large draw silently falls back past its guard's depth
// (markdown-lane measured the collapse at ~file 9,000 and a 2.23x under-count); a lane whose sharded and
// sequential totals agree is clean, and one whose do not has a denominator that moves.
const SHARD = Number(flag("shard") ?? "-1")
const SHARDS = Number(flag("shards") ?? "1")
const COMPARE = flag("compare")

type Type = "calls" | "uses" | "contains" | "imports" | "references" | "exports" | "overrides" | "extends" | "implements" | "instantiates"
const ALL_TYPES: Type[] = ["calls", "uses", "contains", "imports", "references", "exports", "overrides", "extends", "implements", "instantiates"]

type KeySpace = { decl: Map<string, number>; kinds: Map<string, Set<string>> }
const newKeySpace = (): KeySpace => ({ decl: new Map(), kinds: new Map() })
const addSymbol = (ks: KeySpace, name: string, kind: string): void => {
  ks.decl.set(name, (ks.decl.get(name) ?? 0) + 1)
  let s = ks.kinds.get(name)
  if (!s) ks.kinds.set(name, (s = new Set()))
  s.add(kind)
}
const addSymbolWithAlias = (ks: KeySpace, name: string, qname: string, kind: string): void => {
  addSymbol(ks, name, kind)
  if (qname.length > 0 && qname !== name) addSymbol(ks, qname, kind)
}
const repoOf = (f: string): string => path.relative(CR, f).split(path.sep)[0]

// ------------------------------------------------------------------ the gate's discovery rule
const found: string[] = []
const repos = new Set<string>()
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean) } catch { continue }
  repos.add(entry)
  for (const rel of tracked) {
    if (!EXTS.some((x) => rel.toLowerCase().endsWith(`.${x}`))) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 1024 * 1024) continue } catch { continue }
    found.push(abs)
  }
}
found.sort()
const stride = NF > 0 ? Math.max(1, Math.floor(found.length / NF)) : 1
const files = (NF > 0 ? found.filter((_, i) => i % stride === 0).slice(0, NF) : found)
  .filter((_, i) => SHARD < 0 || i % SHARDS === SHARD)

// ------------------------------------------------------------------ phase 1: the sampled walk
type Pending = { label: Type; tgt: string; claim: ReturnType<typeof externalClaimOf>; repo: string; file: string; line: number;
  /** THE TWO FIELDS A CONSUMER ACTUALLY READS to pick a declaration among several in one file. If a
   *  SAME-FILE-MULTI edge carries neither, the edge is NOT determinate and the ruling that says
   *  "the lane already published the answer" is refuted by that edge. */
  hasTargetLine: boolean
  hasTargetResolution: boolean
  /** THE FIELD THIS TYPE'S OWN RULE USES. `overrides` runs to the PRIOR declaration, so its binding is
   *  `overridesLine` — not `targetLine`. The first version of this falsifier checked only
   *  `targetLine`/`targetResolution`, read 85 `overrides` edges as unbindable, and was wrong: all three
   *  it named carry `overridesLine` (53 / 327 / 490). A falsifier must check the field the RULE says,
   *  per type, or it refutes a ruling that holds. */
  hasOverridesLine: boolean
  /** the paths this file SOURCES — the only bounded rule that could reach a CROSS-FILE-ONLY target. */
  sources: string[]
  /** Of those, the ones emitted at TOP-LEVEL scope (`source` field == the script name, i.e. not inside a
   *  function) and AT OR BEFORE this edge's line. The Lead's question: how many CROSS-FILE-ONLY edges
   *  have a source that is UNCONDITIONAL IN SCOPE AND ORDER? That is a different population from the
   *  class as a whole, and nobody had counted it.
   *  LIMITATION, stated because it bounds the claim: a `source` inside a top-level `if` has the script as
   *  its source too, so this counts "not inside a function" and NOT "not inside a conditional". */
  topLevelSourcesBefore: string[]
  /** BD5: the edge was emitted from a tree-sitter ERROR region. Measured below, because a word
   *  inside a quoted flag string is not a command and a false `calls` edge is a defect the
   *  ambiguity columns cannot show. */
  errRecovery: boolean }
const pending: Pending[] = []
/** file -> the paths it sources, filled before its edges are pushed. */
const fileSources = new Map<string, string[]>()
/** file -> its sources WITH the emitting scope and line, so "top-level and before the edge" is checkable. */
const fileSourcesTop = new Map<string, { path: string; line: number }[]>()
/** repo|name -> the files declaring it (already built). The closure below walks `fileSources`. */
const sourcesClosure = new Map<string, Set<string>>()
/** Every file a given file reaches through `source`, to ANY depth, memoised. */
function closureOf(file: string, seen = new Set<string>()): Set<string> {
  const cached = sourcesClosure.get(file)
  if (cached !== undefined) return cached
  const out = new Set<string>()
  const stack = [...(fileSources.get(file) ?? [])]
  while (stack.length > 0) {
    const raw = stack.pop()!
    const abs = raw.startsWith("/") ? raw : path.resolve(path.dirname(file), raw.replace(/^\.\//, ""))
    if (seen.has(abs)) continue
    seen.add(abs)
    if (out.has(abs)) continue
    out.add(abs)
    for (const nxt of fileSources.get(abs) ?? []) stack.push(nxt)
  }
  sourcesClosure.set(file, out)
  return out
}
const localCounts = new Map<string, Map<string, number>>()
const sampleSpaces = new Map<string, KeySpace>()
let parsed = 0, failed = 0, degraded = 0, fallbackFiles = 0, fallbackRows = 0
for (const f of files) {
  let r: any
  try { r = await parseFile(f, repoOf(f), { projectRoot: repoOf(f) } as any) } catch { failed++; continue }
  if (!r) { failed++; continue }
  parsed++
  if (r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback") degraded++
    if (r.fallback === true || String(r.metadata?.analysisVersion ?? "").includes("fallback")) fallbackFiles++
  const repo = repoOf(f)
  let ks = sampleSpaces.get(repo)
  if (!ks) sampleSpaces.set(repo, (ks = newKeySpace()))
  const local = new Map<string, number>()
  localCounts.set(f, local)
  for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
    const name = String(s?.name ?? "")
    if (name.length === 0) continue
    local.set(name, (local.get(name) ?? 0) + 1)
    addSymbolWithAlias(ks, name, String(s?.qualifiedName ?? ""), String(s?.kind ?? ""))
  }
  // THE FILE'S OWN SOURCE IMPORTS, read from the analyzer's own edges (`isSourceImport` /
  // `isSourceDependency`), because a bounded CROSS-FILE rule can only reach a target the file
  // actually pulls in.
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const md = (rel?.metadata ?? {}) as any
    if (md.isSourceImport === true || md.isSourceDependency === true) {
      const t = String(rel?.target ?? "")
      if (t.length > 0) {
        let list = fileSources.get(f)
        if (!list) fileSources.set(f, (list = []))
        list.push(t)
        // TOP-LEVEL = the emitting scope is the script itself, not a function.
        if (String(rel?.source ?? "") === String(r?.metadata?.scriptName ?? rel?.source ?? "")) {
          let tl = fileSourcesTop.get(f)
          if (!tl) fileSourcesTop.set(f, (tl = []))
          tl.push({ path: t, line: Number(rel?.line_number ?? 0) })
        }
      }
    }
  }
  for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
    const label = String(rel?.type ?? rel?.relationshipType ?? "") as Type
    if (!ALL_TYPES.includes(label)) continue
    const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
    if (tgt.length === 0) continue
    if (String((rel as any)?.metadata?.method ?? "") === "regex") fallbackRows++
    pending.push({ label, tgt, claim: externalClaimOf(rel), repo, file: f, line: Number(rel?.line_number ?? 0),
      hasTargetLine: typeof (rel?.metadata as any)?.targetLine === "number",
      hasTargetResolution: typeof (rel?.metadata as any)?.targetResolution === "string",
      hasOverridesLine: typeof (rel?.metadata as any)?.overridesLine === "number",
      sources: fileSources.get(f) ?? [],
      topLevelSourcesBefore: (fileSourcesTop.get(f) ?? []).filter((x) => x.line <= Number(rel?.line_number ?? 0)).map((x) => x.path),
      errRecovery: (rel?.metadata as Record<string, unknown> | undefined)?.commandInErrorRecovery === true })
  }
}

// ------------------------------------------------------------------ phase 2: the project key space
const projectSpaces = new Map<string, KeySpace>()
/** repo|name -> the SET of files declaring it: only file COUNT distinguishes the two classes. */
const declaringFiles = new Map<string, Set<string>>()
{
  const sampleRepos = new Set(files.map(repoOf))
  for (const f of found) {
    const repo = repoOf(f)
    if (!sampleRepos.has(repo)) continue
    let r: any
    try { r = await parseFile(f, repo, { projectRoot: repo } as any) } catch { continue }
    if (!r) continue
    let ks = projectSpaces.get(repo)
    if (!ks) projectSpaces.set(repo, (ks = newKeySpace()))
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      addSymbolWithAlias(ks, name, String(s?.qualifiedName ?? ""), String(s?.kind ?? ""))
      const key = `${repo}|${name}`
      let set = declaringFiles.get(key)
      if (!set) declaringFiles.set(key, (set = new Set()))
      set.add(f)
    }
  }
}

// ------------------------------------------------------------------ phase 3: classify + split
type Row = Outcomes & { edges: number }
const rows = new Map<Type, Row>()
for (const t of ALL_TYPES) rows.set(t, { ...emptyOutcomes(), edges: 0 })
const CL = ["DUP-EMISSION", "SAME-FILE-ONE", "SAME-FILE-MULTI", "CROSS-FILE-ONLY"] as const
const byClass = new Map<string, { edges: number; targets: Set<string> }>()
for (const c of CL) byClass.set(c, { edges: 0, targets: new Set() })
const byClassType = new Map<string, Map<Type, number>>()
const crossFileShape = new Map<number, number>()
const crossFileTargets = new Map<string, number>()
const seen = new Set<string>()
let ambiguous = 0
for (const e of pending) {
  const ks = projectSpaces.get(e.repo) ?? newKeySpace()
  // `containsLike` FOR `contains` ONLY — the gate's own call. Production's `resolveContainsTargetStmt`
  // is `... ORDER BY (s.file_id = ?) DESC ... LIMIT 1`, so a `contains` edge has no "N candidates"
  // state: with at least one declaration in the project it BINDS, and the collision is reported as
  // a flag (`boundAmongCollision`, the gate's `ofWhich`) rather than as ambiguity. Omitting this
  // flag is what made the first two runs of this probe read 59,107 ambiguous against the gate's
  // 42,392 — a difference of exactly the 16,715 `contains` collisions, which is how the omission
  // was found.
  const c = classifyEdge(ks.decl, ks.kinds, e.tgt, e.claim, undefined, e.label === "contains")
  const row = rows.get(e.label)!
  row.edges++
  tally(row, c, e.tgt, e.label)
  // THE OUTCOME VALUES, not the tally field names: `classifyEdge` returns `ambDeclOnly` /
  // `ambBoth`, while `ambiguousByDecl` / `ambiguousByKind` are the FIELDS `tally` writes them
  // into. The first run of this probe filtered on the field names and therefore counted ZERO
  // ambiguous edges while the gate counted 42,392 — a bug caught by the probe's own totals
  // disagreeing with the gate's on the same edge count (148,816 matched, ambiguity did not).
  if (c.outcome !== "ambDeclOnly" && c.outcome !== "ambBoth") continue
  ambiguous++
  const dupKey = `${e.file}|${e.line}|${e.label}|${e.tgt}`
  const isDup = seen.has(dupKey)
  seen.add(dupKey)
  const local = localCounts.get(e.file)?.get(e.tgt) ?? 0
  const cls = isDup ? "DUP-EMISSION" : local >= 2 ? "SAME-FILE-MULTI" : local === 1 ? "SAME-FILE-ONE" : "CROSS-FILE-ONLY"
  const b = byClass.get(cls)!
  b.edges++
  b.targets.add(e.tgt)
  let bt = byClassType.get(cls)
  if (!bt) byClassType.set(cls, (bt = new Map()))
  bt.set(e.label, (bt.get(e.label) ?? 0) + 1)
  if (cls === "CROSS-FILE-ONLY") {
    const n = declaringFiles.get(`${e.repo}|${e.tgt}`)?.size ?? 0
    crossFileShape.set(n, (crossFileShape.get(n) ?? 0) + 1)
    crossFileTargets.set(e.tgt, (crossFileTargets.get(e.tgt) ?? 0) + 1)
  }
}

// ------------------------------------------------------------------ the extQ decomposition
//
// THE CLAIM THE LANE MAKES, SPLIT BY WHAT THE TARGET ACTUALLY IS. The lane's only claim site is
// `{isExternal: true, externalEvidence: "pathInvokedCommand"}` (real-bash-analyzer.ts:2706), and
// the arbiter returns `externalUnverified` for every one of them because `pathLikeTarget` refuses
// a path — a column that BLOCKS A PASS. There is a CHECKABLE claim for the same edge when the path
// names a file the project contains (`projectFile`, verified against the admitted file list), so
// the ceiling of that alternative is measured here before anything is written: for each marked
// edge, is the path relative to the edge's own file, does it EXIST on disk, and is it INSIDE the
// project (the `.git` walk)?
import { existsSync } from "node:fs"
const extqShape = new Map<string, number>()
const extqShapeValues = (): number => [...extqShape.values()].reduce((a, b) => a + b, 0)
let extqRelative = 0, extqAbsolute = 0, extqOther = 0
let extqExists = 0, extqInsideProject = 0
const extqExamples: string[] = []
const projectRootOf = (f: string): string | null => {
  let dir = path.dirname(path.resolve(f))
  for (let i = 0; i < 64; i++) {
    if (existsSync(path.join(dir, ".git"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
for (const e of pending) {
  if (e.claim === null) continue
  const t = e.tgt
  // THE MARKER PREDICATE IS includes("/") (real-bash-analyzer.ts:2705), so the shape classes follow
  // THAT test rather than startsWith("./"). The first version labelled anything without a ./ or ../
  // prefix "bare (no separator)" and skipped the existence check on it, which silently excluded 169
  // marked edges that DO carry a separator (dir/file.sh) and deserve the same question. A label that
  // decides whether a measurement runs must be the rule own predicate.
  const hasSlash = t.includes("/")
  const abs = t.startsWith("/")
  const dotRel = t.startsWith("./") || t.startsWith("../")
  const shape = abs ? "absolute (/...)" : dotRel ? "dot-relative (./ or ../)" : hasSlash ? "relative, no ./ prefix (dir/file)" : "bare identifier (NO separator - not markable by the rule)"
  extqShape.set(shape, (extqShape.get(shape) ?? 0) + 1)
  if (abs) extqAbsolute++
  else if (dotRel) extqRelative++
  else if (hasSlash) extqOther++
  if (!hasSlash) continue
  const resolved = path.resolve(path.dirname(e.file), t)
  if (!existsSync(resolved)) continue
  extqExists++
  const root = projectRootOf(e.file)
  const inside = root !== null && !path.relative(root, resolved).startsWith("..")
  if (inside) extqInsideProject++
  else if (extqExamples.length < 4) extqExamples.push(`${path.relative(CR, e.file)} -> ${t} (exists, OUTSIDE the project root)`)
}

// ------------------------------------------------------------------ false calls from ERROR recovery
//
// THREE EDGES THE CLOSURE PROBE COULD NOT CLOSE, and the source says why. `-[calls]-> name` at
// kubernetes/cluster/gce/util.sh:3829 sits on `--filter="(name ~ ...)"` and `-[calls]-> key` at
// Paket/completion/paket-completion.zsh:1486 sits on `local key` — neither is a command word. All
// three carry `metadata.commandInErrorRecovery: true`, so the BD5 recovered-region guard is
// emitting a CALL for a word inside a quoted string or a declaration. A false call edge is a
// defect the ambiguity columns hide (it lands in `unresolved`, where it looks like an external
// program), so the population is counted here rather than inferred from three examples.
const errRows = new Map<string, number>()
const errExamples: string[] = []
for (const e of pending) {
  if (!e.errRecovery) continue
  const ks = projectSpaces.get(e.repo) ?? newKeySpace()
  const c = classifyEdge(ks.decl, ks.kinds, e.tgt, e.claim, undefined, e.label === "contains")
  const k = `${e.label}/${c.outcome}`
  errRows.set(k, (errRows.get(k) ?? 0) + 1)
  if (errExamples.length < 5) errExamples.push(`${path.relative(CR, e.file)}:${e.line} -[${e.label}]-> ${e.tgt}`)
}

// ------------------------------------------------------------------ print
const sum = (f: (r: Row) => number): number => [...rows.values()].reduce((n, r) => n + f(r), 0)
const total = sum((r) => r.edges)
const res = sum((r) => r.resolved)
const unres = sum((r) => r.unresolved)
console.log(`PROBE-BASH-AMBIGUITY-SCOPE-SPLIT  lang=bash ext=${EXTS.map((x) => "." + x).join(",")} nf=${NF} shard=${SHARD < 0 ? "(none)" : SHARD + "/" + SHARDS}`)
console.log(`SHARD-LINE shard=${SHARD < 0 ? "none" : SHARD} files=${files.length} parsed=${parsed} failed=${failed} FALLBACK-FILES=${fallbackFiles} FALLBACK-ROWS=${fallbackRows} degrees=${sum((r) => r.edges)}`)
console.log(`  population ${files.length} of ${found.length} tracked ${EXTS.map((x) => "." + x).join("/")} files in ${repos.size} repos; parsed=${parsed} failed=${failed} degraded=${degraded}`)
console.log(`  PROJECT SCOPE totals: edges=${total} resolved=${res} resolvedAmongCollision=${sum((r) => r.resolvedAmongCollision)} ambiguousByDecl=${sum((r) => r.ambiguousByDecl)} ambiguousByKind=${sum((r) => r.ambiguousByKind)} unresolved=${unres}`)
console.log(`    of the resolved, ${sum((r) => r.resolvedAmongCollision)} sit on a name with MORE THAN ONE declaration in the project (the gate's ofWhich column)`)
console.log(`    external* columns: markedExternal=${sum((r) => r.markedExternal)} verified=${sum((r) => r.externalVerified)} unverified=${sum((r) => r.externalUnverified)} refuted=${sum((r) => r.externalRefuted)}`)
if (COMPARE) {
  try {
    const g = JSON.parse(readFileSync(COMPARE, "utf8"))
    const gt = g?.table1?.TOTAL ?? g?.TOTAL ?? g?.totals ?? null
    const gAmb = gt ? Number(gt.ambiguous ?? gt.ambiguousByDecl ?? 0) + Number(gt.ambiguousByKind ?? 0) : NaN
    if (!gt || Number(gt.edges) !== total || gAmb !== ambiguous || Number(gt.unresolved) !== unres) {
      console.log(`  *** COMPARE REFUSED: does NOT reproduce ${COMPARE} (gate edges=${gt?.edges} amb=${gAmb} unres=${gt?.unresolved}) — the split is NOT evidence about that run`)
      process.exitCode = 2
    } else console.log(`  compare: REPRODUCES the gate run exactly (edges=${gt.edges} amb=${gAmb} unres=${gt.unresolved})`)
  } catch (err) {
    console.log(`  *** COMPARE FAILED to read ${COMPARE}: ${String(err)}`)
    process.exitCode = 2
  }
}
console.log("")
console.log(`THE ${ambiguous} AMBIGUOUS EDGES, SPLIT BY WHERE THE NAME IS DECLARED`)
for (const c of CL) {
  const b = byClass.get(c)!
  const pct = ambiguous > 0 ? ((b.edges / ambiguous) * 100).toFixed(1) : "0.0"
  const per = [...(byClassType.get(c) ?? new Map<Type, number>())].sort((x, y) => y[1] - x[1]).map(([t, n]) => `${t}:${n}`).join(" ")
  console.log(`  ${c.padEnd(16)} ${String(b.edges).padStart(7)}  ${pct.padStart(5)}%  targets ${String(b.targets.size).padStart(5)}  ${per}`)
}
const ceiling = byClass.get("SAME-FILE-ONE")!.edges
const withLine = byClass.get("SAME-FILE-MULTI")!.edges
console.log("")
// ---------------------------------------------------------------- the two classes' own questions
//
// SAME-FILE-MULTI — RULE OR REFUTE. The lane publishes `targetLine`/`targetResolution` on an edge whose
// own file declares the name more than once, which is the claim that a CONSUMER can pick
// deterministically. The falsifier is one query: an edge in this class carrying NEITHER field is an edge
// with no answer on it, and it refutes the ruling.
const multiNoBinding: string[] = []
let multiWithLine = 0, multiWithDecline = 0, multiBare = 0, multiBound = 0
// CROSS-FILE-ONLY — the ceiling of the only bounded rule (the file's own `source`). A target the file
// pulls in is reachable in principle; one it never sources is decided by RUNTIME order.
let crossReachableBySource = 0
// THE LEVER BELOW THE BOUNDARY, PRICED. Two bounded rules exist under the runtime-order boundary, and
// BOTH are unsound — this is where that is measured rather than asserted:
//   (a) TRANSITIVE SOURCING CLOSURE: the target is declared in a file this file reaches through `source`
//       at ANY depth. Unsound because `source` is CONDITIONAL (inside an `if`) and ORDER-dependent, so a
//       reached file's declarations are not necessarily in effect at the edge.
//   (b) SOLE-DECLARING-FILE: the project declares the name in exactly ONE file. Unsound for a different
//       reason: "the project declares it once" does not mean THIS file has it in scope — the declaring
//       file may never be sourced on this path at all.
let crossInClosure = 0, crossSoleDeclaringFile = 0
let crossUnconditionalSource = 0
const unconditionalExamples: string[] = []
const crossExamples: string[] = []
for (const e of pending) {
  const ks = projectSpaces.get(e.repo) ?? newKeySpace()
  const c = classifyEdge(ks.decl, ks.kinds, e.tgt, e.claim, undefined, e.label === "contains")
  if (c.outcome !== "ambDeclOnly" && c.outcome !== "ambBoth") continue
  const local = localCounts.get(e.file)?.get(e.tgt) ?? 0
  if (local >= 2) {
    // PER-TYPE, because the lane's rules differ by type: `overrides` binds through `overridesLine`
    // (the prior declaration), everything else through `targetLine`/`targetResolution`.
    const usable = e.label === "overrides" ? e.hasOverridesLine : (e.hasTargetLine || e.hasTargetResolution)
    if (e.hasTargetLine) multiWithLine++
    else if (e.hasTargetResolution) multiWithDecline++
    if (usable) multiBound++
    else { multiBare++; if (multiNoBinding.length < 5) multiNoBinding.push(`${path.relative(CR, e.file)}:${e.line} -[${e.label}]-> ${e.tgt}`) }
  } else if (local === 0) {
    const declaring = declaringFiles.get(`${e.repo}|${e.tgt}`) ?? new Set<string>()
    const reachable = e.sources.some((src) => {
      const bare = src.replace(/^\.\//, "")
      for (const df of declaring) {
        if (df === path.resolve(path.dirname(e.file), src)) return true
        if (df.endsWith("/" + bare)) return true
      }
      return false
    })
    if (reachable) { crossReachableBySource++; if (crossExamples.length < 4) crossExamples.push(`${path.relative(CR, e.file)}:${e.line} -[${e.label}]-> ${e.tgt} (its file sources it)`) }
    // (a) the transitive closure
    if (declaring.size > 0 && [...closureOf(e.file)].some((tf) => declaring.has(tf))) crossInClosure++
    // (b) exactly one file in the project declares it
    if (declaring.size === 1) crossSoleDeclaringFile++
    // (c) THE UNCONDITIONAL-IN-SCOPE-AND-ORDER SOURCE: a top-level `source` at or before this edge whose
    //     file declares the target. This is the population the Lead asked for and the only bounded rule
    //     below the boundary that does not depend on a runtime call path.
    const uncond = e.topLevelSourcesBefore.some((src) => {
      const abs = path.resolve(path.dirname(e.file), src.replace(/^\.\//, ""))
      for (const df of declaring) {
        if (df === abs) return true
        if (df.endsWith("/" + src.replace(/^\.\//, ""))) return true
      }
      return false
    })
    if (uncond) { crossUnconditionalSource++; if (unconditionalExamples.length < 4) unconditionalExamples.push(`${path.relative(CR, e.file)}:${e.line} -[${e.label}]-> ${e.tgt}`) }
  }
}
console.log("")
console.log("SAME-FILE-MULTI — the ruling's falsifier, RUN (does every edge carry an answer a consumer can use?)")
console.log(`  with targetLine ${multiWithLine} · with the explicit decline (targetResolution) ${multiWithDecline} · with overridesLine ${multiBound - multiWithLine - multiWithDecline} · with a USABLE field for their type ${multiBound} · with NEITHER ${multiBare}`)
for (const x of multiNoBinding) console.log(`     ${x}`)
console.log(`  ${multiBare === 0 ? "FALSIFIER DID NOT FIRE: every SAME-FILE-MULTI edge carries a usable binding or an explicit decline — the class is a CONTRACT, not a defect" : "FALSIFIER FIRED: " + multiBare + " edge(s) carry no answer — the ruling is refuted for those"}`)
console.log("")
console.log("CROSS-FILE-ONLY — the CEILING of the only bounded rule (the file's own `source`)")
console.log(`  ambiguous edges whose target is declared in a file THIS file sources: ${crossReachableBySource}`)
for (const x of crossExamples) console.log(`     ${x}`)
console.log(`  LEVER (a) transitive sourcing closure (ANY depth): ${crossInClosure} edges — UNSOUND: \`source\` is conditional and order-dependent`)
console.log(`  LEVER (b) the project declares the name in exactly ONE file: ${crossSoleDeclaringFile} edges — UNSOUND: a sole declaration elsewhere does not put it in THIS file's scope`)
console.log(`  LEVER (c) an UNCONDITIONAL-IN-SCOPE-AND-ORDER top-level source declares it: ${crossUnconditionalSource} edges`)
for (const x of unconditionalExamples) console.log(`     ${x}`)
console.log("  the rest are decided by SOURCING ORDER at runtime: which definition is in effect depends on which")
console.log("  `source` ran first on the path that reached this line, which a per-file analyzer cannot see")
console.log("")
console.log("CEILING of a css-D15-style rule (file-scoped qualifiedName + respell a target the edge's own file declares):")
console.log(`  SAME-FILE-ONE  ${String(ceiling).padStart(7)} edges — resolvable by the file-scoped spelling alone`)
console.log(`  SAME-FILE-MULTI${String(withLine).padStart(7)} edges — need the LINE as well; the lane's closure probe measured whether the published fields already carry it`)
console.log(`  -> ceiling ${ceiling + withLine} of ${ambiguous} ambiguous (${ambiguous > 0 ? (((ceiling + withLine) / ambiguous) * 100).toFixed(1) : "0.0"}%), ${total > 0 ? (((ceiling + withLine) / total) * 100).toFixed(2) : "0.00"}% of all ${total} edges`)
console.log(`  CROSS-FILE-ONLY ${byClass.get("CROSS-FILE-ONLY")!.edges} edges (${byClass.get("CROSS-FILE-ONLY")!.targets.size} targets) are OUTSIDE it: the name is declared only in files the edge's own file does not see, and which one the shell binds is decided by SOURCING at runtime.`)
console.log(`  declaring FILES per cross-file target: ${[...crossFileShape.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}: ${v}`).join(" · ")}`)
const top = [...crossFileTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
if (top.length) console.log(`  top cross-file targets: ${top.map(([t, n]) => `${t} (${n})`).join(" · ")}`)
console.log("")
console.log("")
{
  const errTotal = [...errRows.values()].reduce((a, b) => a + b, 0)
  console.log(`CALLS EMITTED FROM A RECOVERED ERROR REGION (metadata.commandInErrorRecovery) — ${errTotal} edges`)
  for (const [k, v] of [...errRows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${k.padEnd(28)} ${v}`)
  for (const x of errExamples) console.log(`     ${x}`)
}
console.log("")
console.log(`THE CLAIM THE LANE MAKES (${[...extqShape.values()].reduce((a, b) => a + b, 0)} marked edges, all from the one pathInvokedCommand site)`)
for (const [k, v] of [...extqShape.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(24)} ${v}`)
console.log(`  of the RELATIVE ones (${extqRelative}): path exists on disk ${extqExists}, of those INSIDE the project root ${extqInsideProject}`)
console.log(`  -> CEILING of a \`projectFile\` claim (the checkable claim the arbiter VERIFIES against the admitted file list): ${extqInsideProject} of ${extqShapeValues()} marked edges could carry one; the absolute ones (${extqAbsolute}) can never — a system path is not an admitted project file.`)
for (const x of extqExamples) console.log(`     ${x}`)
console.log("")
// THE PARTITION THE OWNER ASKED FOR: every edge in a (type x column) bucket, buckets summing to the
// instrument's total — a partition that does not close is a residual with somewhere to hide.
console.log("")
console.log("PARTITION BY TYPE x COLUMN (must sum to edges; every bucket named, nothing miscellaneous)")
let psum = 0
for (const [label, r] of [...rows.entries()].sort((a, b) => b[1].edges - a[1].edges)) {
  if (r.edges === 0) continue
  const parts = [
    `resolved ${r.resolved}`,
    `resolvedAmongCollision ${r.resolvedAmongCollision}`,
    `amb ${r.ambiguousByDecl}`,
    `unres ${r.unresolved}`,
    `extOK ${r.externalVerified}`,
    `ext? ${r.externalUnverified}`,
    `extFAIL ${r.externalRefuted}`,
    `bind/cause ${r.bindingVerified + r.bindingRefuted + r.bindingUnverified + r.causeDeclared + r.causeRefuted}`,
  ].filter((x) => !x.endsWith(" 0"))
  console.log(`  ${String(label).padEnd(13)} edges ${String(r.edges).padStart(7)} · ${parts.join(" · ")}`)
  psum += r.edges
}
console.log(`  ${"SUM".padEnd(13)} edges ${String(psum).padStart(7)} · instrument total ${total} · ${psum === total ? "CLOSES EXACTLY" : "DOES NOT CLOSE — " + (total - psum) + " unaccounted"}`)
console.log("")
console.log(`READING: ${ceiling + withLine === 0 ? "the candidate rule has NO ceiling here — zero ambiguous edges are resolvable by a file-scoped spelling" : `a file-scoped spelling could resolve at most ${ceiling + withLine} of ${ambiguous} ambiguous edges; ${byClass.get("CROSS-FILE-ONLY")!.edges} are the inherent class`}`)
