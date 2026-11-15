/**
 * THE INCOMING SPLIT — lua. The gate's population, the gate's rule, and the evidence that
 * decides every unresolved edge's bucket and every external claim's fate.
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-gate.ts lua lua 60` reads `1305 ambiguous + 2222 unresolved of 5415
 * edges` and prints 25 rows per class. A lane asked to split 2,222 edges, to explain 86
 * external claims and to characterise 1,305 ambiguous ones cannot do it from 25 rows, and must
 * not guess the rest.
 *
 * So this census re-runs the SAME walk with the SAME rule — `classifyEdge`, `externalClaimOf`,
 * `emptyOutcomes`, `tally`, `EXTERNAL_KEYS` are IMPORTED from `script/m14/incoming-rule.ts`,
 * never copied, because two copies of a counting rule are two rules — and then answers, per
 * edge, the questions the buckets turn on:
 *
 *   THE EXTERNAL CLAIMS (the gate's `markedExternal` column, and its `ext?` column)
 *     every edge carrying a marker key, its target, its marker keys, and how the arbiter
 *     classifies it at BOTH scopes: verified (the target itself, or its owner, is published
 *     nowhere), unverifiable (no identifier-shaped name to look up — a module path, a URI, a
 *     `Foo.Bar` whose owner the rule refuses), or REFUTED (the project publishes the name that
 *     was looked up). A claim that cannot be checked is not a defect; a claim the project
 *     REFUTES is, and this file names every one with the declaration that answered it.
 *
 *   THE UNRESOLVED SPLIT
 *     `declaredInProjectFull` — a declaration of this exact target exists in the same
 *     repository, in a file the stride sample did not include: the edge is IN-CORPUS and the
 *     sample's reach is the whole explanation (a `--nf 0` run dissolves it).
 *     `declaredInCorpusOtherProject` — the name exists in the corpus but in another project;
 *     production resolves `WHERE s.project_id = ?`, so this is a cross-repo name collision and
 *     not a resolvable edge for this one.
 *     `nowhere` — no declaration anywhere: a stdlib member, a C module, a require path, a
 *     runtime global, or a broken name. The ONLY evidence that separates those is the shape
 *     reading plus the analyzer's own metadata.
 *
 *   THE MARK SIMULATION — every candidate marking rule is run through the gate's own
 *     classifier BEFORE it is shipped, and a rule with a nonzero refuted count is not shipped.
 *
 *   THE AMBIGUITY SPLIT — why a target names more than one declaration: across files, across
 *     owners in one file, or across KINDS in one owner. Those have different owners and only
 *     the last is even a candidate for repair.
 *
 * ## Comparability
 *
 * Population discovery is the gate's (git checkouts under the corpus root, `git ls-files`, the
 * extension argument, the gate's 1 MB cap, sorted, then a STRIDE sample). `--compare` checks
 * this census's totals against a captured `incoming-gate.ts --json` run of the same command and
 * REFUSES to print a split when they disagree, because a split of a different set is not
 * evidence about that set.
 *
 * ## Sharding
 *
 * `parser.parse()` is synchronous WASM and `src/ast/engine.ts` answers a hang with
 * `process.exit()`, so the walk forks shards; a dead shard's offending path is read out of the
 * child's stderr, recorded as EXCLUDED with its reason, and the shard re-runs without it.
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/lua/incoming-split.mts [--ext lua] [--nf 60] [--all]
 *        [--out FILE] [--compare FILE] [--shard-size 150]
 *
 * `--all` parses the WHOLE admitted population (3,250 files), which is what the
 * "declared in the project" arm needs: a sample cannot answer a question about a file it did
 * not read. Read-only.
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  classifyEdge, externalClaimOf, emptyOutcomes, tally, EXTERNAL_KEYS, targetOwner,
} from "../../../../script/m14/incoming-rule"
import type { Outcomes, ExternalClaim } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SELF = path.resolve(process.argv[1])
const SIZE_CAP = 1024 * 1024
const ALL_TYPES = [
  "calls", "extends", "implements", "uses", "imports",
  "exports", "contains", "references", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const EXT = (argOf("--ext") ?? "lua").toLowerCase()
const NF = Number(argOf("--nf") ?? "60")
const OUT = argOf("--out")
const COMPARE = argOf("--compare")
const ALL_FILES = argv.includes("--all")
const SHARD_SIZE = Number(argOf("--shard-size") ?? "150") || 150

// ---------------------------------------------------------------------------------------------
// discovery — the gate's rule
// ---------------------------------------------------------------------------------------------
type Admitted = { abs: string; repo: string; rel: string }
function discover(): { found: Admitted[]; repos: number; absent: number; overCap: number } {
  const found: Admitted[] = []
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
      } catch {
        absent++
        continue
      }
      found.push({ abs, repo: name, rel })
      repos.add(name)
    }
  }
  found.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
  return { found, repos: repos.size, absent, overCap }
}

// ---------------------------------------------------------------------------------------------
// shard worker
// ---------------------------------------------------------------------------------------------
type Sym = { n: string; k: string; f: string; o: string | null; q: string }
type EdgeRec = { t: Type; g: string; s: string; line: number; md: Record<string, unknown> }
type ShardResult = {
  files: { label: string; repo: string; ok: boolean; syms: Sym[]; edges: EdgeRec[] }[]
  bad: string[]
}

if (process.env.BB_LUA_SPLIT_SHARD) {
  const slice: Admitted[] = JSON.parse(readFileSync(process.env.BB_LUA_SPLIT_SHARD, "utf8"))
  const { parseFile } = await import("../../../../src/ast/pool-worker")
  const out: ShardResult = { files: [], bad: [] }
  for (const f of slice) {
    let r: any
    try {
      r = await parseFile(f.abs, f.repo, { projectRoot: f.repo } as any)
    } catch (e: any) {
      out.bad.push(`${f.repo}/${f.rel} :: parseFile threw ${String(e?.message ?? e)}`)
      out.files.push({ label: `${f.repo}/${f.rel}`, repo: f.repo, ok: false, syms: [], edges: [] })
      continue
    }
    if (!r) {
      out.bad.push(`${f.repo}/${f.rel} :: parseFile returned nothing`)
      out.files.push({ label: `${f.repo}/${f.rel}`, repo: f.repo, ok: false, syms: [], edges: [] })
      continue
    }
    const syms: Sym[] = []
    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const n = String(s?.name ?? "")
      if (n.length === 0) continue
      syms.push({
        n,
        k: String(s?.kind ?? ""),
        f: `${f.repo}/${f.rel}`,
        o: s?.ownerName == null ? null : String(s.ownerName),
        q: String(s?.qualifiedName ?? ""),
      })
    }
    const edges: EdgeRec[] = []
    for (const x of Array.isArray(r.relationships) ? r.relationships : []) {
      const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const g = String(x?.target ?? x?.to ?? x?.toSymbol ?? "")
      if (g.length === 0) continue
      edges.push({
        t, g, s: String(x?.source ?? ""),
        line: Number(x?.line_number ?? x?.lineNumber ?? 0),
        md: (x?.metadata ?? {}) as Record<string, unknown>,
      })
    }
    const degraded = r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback"
    out.files.push({ label: `${f.repo}/${f.rel}`, repo: f.repo, ok: !degraded, syms, edges })
  }
  writeFileSync(`${process.env.BB_LUA_SPLIT_SHARD}.out`, JSON.stringify(out))
  console.log(`shard ok: ${out.files.length} files, ${out.files.reduce((n, f) => n + f.edges.length, 0)} edges`)
  process.exit(0)
}

// ---------------------------------------------------------------------------------------------
const { found, repos: repoCount, absent, overCap } = discover()
const corpusTotal = found.length
const strideSample = (list: Admitted[], n: number): Admitted[] => {
  if (n <= 0 || list.length <= n) return list
  const stride = Math.max(1, Math.floor(list.length / n))
  const picked: Admitted[] = []
  for (let i = 0; i < list.length && picked.length < n; i += stride) picked.push(list[i])
  return picked
}
const sample = strideSample(found, NF)
const sampleLabels = new Set(sample.map((f) => `${f.repo}/${f.rel}`))
const walk = ALL_FILES ? found : sample

const tmp = mkdtempSync(path.join(os.tmpdir(), "lua-split-"))
const excluded: { file: string; reason: string }[] = []
const shards: Admitted[][] = []
for (let i = 0; i < walk.length; i += SHARD_SIZE) shards.push(walk.slice(i, i + SHARD_SIZE))

const perFile: ShardResult["files"] = []
const shardErrors: string[] = []
let shardNo = 0
for (const shard of shards) {
  shardNo++
  let pending = shard
  for (let attempt = 0; attempt < 12 && pending.length > 0; attempt++) {
    const inPath = path.join(tmp, `shard-${shardNo}-${attempt}.json`)
    writeFileSync(inPath, JSON.stringify(pending))
    const r = spawnSync("npx", ["tsx", SELF], {
      env: { ...process.env, BB_LUA_SPLIT_SHARD: inPath },
      encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, timeout: 900000,
    })
    if (r.status === 0 && r.stdout && r.stdout.includes("shard ok:")) {
      const res: ShardResult = JSON.parse(readFileSync(`${inPath}.out`, "utf8"))
      perFile.push(...res.files)
      shardErrors.push(...res.bad)
      pending = []
      break
    }
    const m = /\[BB-HANG\].*? on (.+?) — exiting/.exec(`${r.stderr ?? ""}`)
    const offender = m ? m[1] : null
    const idx = offender ? pending.findIndex((f) => f.abs === offender) : pending.length - 1
    if (idx < 0) {
      shardErrors.push(`shard ${shardNo} died and the offending file is not in this shard: ${(r.stderr ?? "").slice(0, 300)}`)
      pending = []
      break
    }
    const bad = pending[idx]
    excluded.push({
      file: `${bad.repo}/${bad.rel}`,
      reason: offender
        ? "engine [BB-HANG]: parser.parse() exceeded 120 s and self-destructed the process"
        : "shard child died with no [BB-HANG] line; last file of the shard dropped to make progress",
    })
    pending = pending.slice(0, idx).concat(pending.slice(idx + 1))
  }
  if (shardNo % 5 === 0) process.stderr.write(`  … ${shardNo}/${shards.length} shards\n`)
}
rmSync(tmp, { recursive: true, force: true })

// ---------------------------------------------------------------------------------------------
// key spaces
// ---------------------------------------------------------------------------------------------
type KeySpace = {
  decl: Map<string, number>
  kinds: Map<string, Set<string>>
  where: Map<string, { file: string; owner: string | null; kind: string }[]>
}
const newSpace = (): KeySpace => ({ decl: new Map(), kinds: new Map(), where: new Map() })
const addKey = (sp: KeySpace, key: string, kind: string, file: string, owner: string | null) => {
  sp.decl.set(key, (sp.decl.get(key) ?? 0) + 1)
  let ks = sp.kinds.get(key)
  if (!ks) sp.kinds.set(key, (ks = new Set()))
  ks.add(kind)
  let ws = sp.where.get(key)
  if (!ws) sp.where.set(key, (ws = []))
  ws.push({ file, owner, kind })
}
const sampleProjects = new Map<string, KeySpace>()
const fullProjects = new Map<string, KeySpace>()
const fullPooled = newSpace()
const spaceIn = (m: Map<string, KeySpace>, repo: string): KeySpace => {
  let sp = m.get(repo)
  if (!sp) m.set(repo, (sp = newSpace()))
  return sp
}
for (const f of perFile) {
  if (!f.ok) continue
  const inSample = sampleLabels.has(f.label)
  for (const s of f.syms) {
    if (inSample) addKey(spaceIn(sampleProjects, f.repo), s.n, s.k, f.label, s.o)
    addKey(spaceIn(fullProjects, f.repo), s.n, s.k, f.label, s.o)
    addKey(fullPooled, s.n, s.k, f.label, s.o)
    if (s.q.length > 0 && s.q !== s.n) {
      if (inSample) addKey(spaceIn(sampleProjects, f.repo), s.q, s.k, f.label, s.o)
      addKey(spaceIn(fullProjects, f.repo), s.q, s.k, f.label, s.o)
      addKey(fullPooled, s.q, s.k, f.label, s.o)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------------------------
type Rec = {
  t: Type; g: string; repo: string; file: string; s: string; line: number
  md: Record<string, unknown>; claim: ExternalClaim | null; inSample: boolean
}
const recs: Rec[] = []
for (const f of perFile) {
  if (!f.ok) continue
  for (const e of f.edges) {
    recs.push({
      t: e.t, g: e.g, repo: f.repo, file: f.label, s: e.s, line: e.line, md: e.md,
      claim: externalClaimOf({ metadata: e.md }), inSample: sampleLabels.has(f.label),
    })
  }
}
const classify = (r: Rec, sp: KeySpace | undefined) =>
  classifyEdge(sp?.decl ?? new Map(), sp?.kinds ?? new Map(), r.g, r.claim)

// ---------------------------------------------------------------------------------------------
// `--dump FILE` — ADDITIVE. The printed report answers "how many"; a question about WHICH
// receivers and targets a residual class is made of needs the records themselves, and re-walking
// the corpus to ask it a second time is how two runs of one lane come to be compared as one. This
// writes the set this run classified: every edge with its metadata, and every symbol with its
// `qualifiedName`, so the question that decides whether publishing a qualifier could EVER resolve
// an edge here — "does a qualified alias ever name a different leaf from the symbol's own name" —
// is answered from the same walk as the counts.
// ---------------------------------------------------------------------------------------------
const DUMP = argOf("--dump")
if (DUMP) {
  writeFileSync(DUMP, JSON.stringify({
    edges: recs.map((r) => [r.t, r.g, r.repo, r.file, r.s, r.line, r.inSample ? 1 : 0, r.md]),
    syms: perFile.filter((f) => f.ok).flatMap((f) => f.syms.map((s) => [s.n, s.q, s.k, s.o, f.label, f.repo])),
  }))
  console.log(`dump: ${DUMP} — ${recs.length} edge(s), ${perFile.filter((f) => f.ok).reduce((n, f) => n + f.syms.length, 0)} symbol(s)`)
}

type Bag = {
  edges: number; resolved: number; amb: number; unresolved: number
  extV: number; extU: number; extF: number; outcomes: Outcomes
}
const bag = (): Bag => ({ edges: 0, resolved: 0, amb: 0, unresolved: 0, extV: 0, extU: 0, extF: 0, outcomes: emptyOutcomes() })
const fold = (b: Bag, o: Outcomes, edges: number) => {
  b.edges += edges
  b.resolved += o.resolved
  b.amb += o.ambiguousByDecl
  b.unresolved += o.unresolved
  b.extV += o.externalVerified
  b.extU += o.externalUnverified
  b.extF += o.externalRefuted
  const t = b.outcomes
  for (const k of [
    "resolved", "ambiguousByDecl", "ambiguousByKind", "unresolved", "markedExternal",
    "externalVerified", "externalVerifiedByOwner", "externalVerifiedByProjectFacts",
    "externalUnverified", "externalRefuted", "bindingVerified", "bindingRefuted",
    "bindingUnverified", "causeDeclared", "causeRefuted",
  ] as const) (t as any)[k] += (o as any)[k]
}
const sampleRows = new Map<Type, Outcomes & { edges: number }>()
const fullRows = new Map<Type, Outcomes & { edges: number }>()
for (const t of ALL_TYPES) {
  sampleRows.set(t, { ...emptyOutcomes(), edges: 0 })
  fullRows.set(t, { ...emptyOutcomes(), edges: 0 })
}
const sampleTotals = bag()
const fullTotals = bag()
for (const r of recs) {
  const so = emptyOutcomes()
  tally(so, classify(r, sampleProjects.get(r.repo)), r.g, r.t)
  const fo = emptyOutcomes()
  tally(fo, classify(r, fullProjects.get(r.repo)), r.g, r.t)
  if (r.inSample) {
    const row = sampleRows.get(r.t)!
    row.edges++
    tally(row, classify(r, sampleProjects.get(r.repo)), r.g, r.t)
    fold(sampleTotals, so, 1)
  }
  const frow = fullRows.get(r.t)!
  frow.edges++
  tally(frow, classify(r, fullProjects.get(r.repo)), r.g, r.t)
  fold(fullTotals, fo, 1)
}

// ---------------------------------------------------------------------------------------------
// THE EXTERNAL CLAIMS — every marked edge, and what the arbiter makes of it
// ---------------------------------------------------------------------------------------------
type ClaimRow = {
  t: Type; g: string; file: string; line: number; keys: string
  sampleOutcome: string; fullOutcome: string
  owner: string | null
  /** the target itself is a plain identifier, so the arbiter checks the TARGET */
  targetIsIdentifier: boolean
}
const claimRows: ClaimRow[] = []
const claimCounts = { total: 0, sampleVerified: 0, sampleUnverified: 0, sampleRefuted: 0, fullVerified: 0, fullUnverified: 0, fullRefuted: 0 }
const refutedDetail: { g: string; t: Type; file: string; owner: string | null; answering: string[] }[] = []
const isIdentifier = (s: string): boolean => {
  if (s.length === 0) return false
  const c0 = s.charCodeAt(0)
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95)) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) return false
  }
  return true
}
for (const r of recs) {
  const keys = EXTERNAL_KEYS.filter((k) => r.md[k] === true || (Array.isArray(r.md[k]) && (r.md[k] as unknown[]).length > 0))
  if (keys.length === 0) continue
  claimCounts.total++
  const so = classify(r, sampleProjects.get(r.repo)).outcome
  const fo = classify(r, fullProjects.get(r.repo)).outcome
  if (so === "externalVerified") claimCounts.sampleVerified++
  else if (so === "externalUnverified") claimCounts.sampleUnverified++
  else if (so === "externalRefuted") claimCounts.sampleRefuted++
  if (fo === "externalVerified") claimCounts.fullVerified++
  else if (fo === "externalUnverified") claimCounts.fullUnverified++
  else if (fo === "externalRefuted") {
    claimCounts.fullRefuted++
    const owner = targetOwner(r.g)
    const answering = owner !== null ? (fullProjects.get(r.repo)?.where.get(owner) ?? []).slice(0, 3).map((x) => `${x.file} (${x.kind})`) : []
    if (refutedDetail.length < 40) refutedDetail.push({ g: r.g, t: r.t, file: r.file, owner, answering })
  }
  if (claimRows.length < 400) {
    claimRows.push({
      t: r.t, g: r.g, file: r.file, line: r.line, keys: keys.join("+"),
      sampleOutcome: so, fullOutcome: fo, owner: targetOwner(r.g), targetIsIdentifier: isIdentifier(r.g),
    })
  }
}
/** the marker-key census over the WHOLE marked set (not the 400-row sample) */
const claimKeyHistogram = (() => {
  const m: Record<string, number> = Object.create(null)
  for (const r of recs) {
    const keys = EXTERNAL_KEYS.filter((k) => r.md[k] === true || (Array.isArray(r.md[k]) && (r.md[k] as unknown[]).length > 0))
    if (keys.length === 0) continue
    const sig = keys.join("+")
    m[sig] = (m[sig] ?? 0) + 1
  }
  return m
})()

// ---------------------------------------------------------------------------------------------
// THE UNRESOLVED SPLIT
// ---------------------------------------------------------------------------------------------
const unresolvedRecs = recs.filter((r) => r.inSample && classify(r, sampleProjects.get(r.repo)).outcome === "unresolved")
const isAsciiUpper = (c: number) => c >= 65 && c <= 90
const shapeOf = (t: string): string => {
  const c0 = t.charCodeAt(0)
  if (c0 === 39 || c0 === 34) return "quoted"
  if (t.length === 1) return "single-char"
  let dot = false, slash = false, colon = false, hyphen = false
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 46) dot = true
    else if (c === 47 || c === 92) slash = true
    else if (c === 58) colon = true
    else if (c === 45) hyphen = true
  }
  if (dot) return "dotted"
  if (slash) return "slash"
  if (colon) return "colon"
  if (hyphen) return "hyphen"
  if (isAsciiUpper(t.charCodeAt(0))) return "Upper"
  return "bare"
}
const leafOf = (t: string): string => {
  const i = t.lastIndexOf(".")
  return i > 0 && i < t.length - 1 ? t.slice(i + 1) : t
}
const keysOf = (md: Record<string, unknown>): string[] => {
  const out = Object.keys(md).filter((k) => k !== "evidenceClass" && md[k] !== false && md[k] != null)
  out.sort()
  return out
}
type Row = {
  t: Type; shape: string; via: string | null; n: number
  declaredInProjectFull: number; declaredInCorpusOther: number
  leafDeclaredInProject: number; mdKeys: string; samples: string[]
}
const buckets = new Map<string, Row>()
for (const r of unresolvedRecs) {
  const full = fullProjects.get(r.repo)
  const inProject = full?.decl.get(r.g) ?? 0
  const otherProjectDecl = fullPooled.decl.get(r.g) ?? 0
  const leaf = leafOf(r.g)
  const shape = shapeOf(r.g)
  const key = `${r.t}\u0000${shape}\u0000${keysOf(r.md).join("+") || "(no marker)"}`
  let b = buckets.get(key)
  if (!b) {
    buckets.set(key, (b = {
      t: r.t, shape, via: null, n: 0, declaredInProjectFull: 0, declaredInCorpusOther: 0,
      leafDeclaredInProject: 0, mdKeys: keysOf(r.md).join("+") || "(no marker)", samples: [],
    }))
  }
  b.n++
  if (inProject > 0) b.declaredInProjectFull++
  else if (otherProjectDecl > 0) b.declaredInCorpusOther++
  if (leaf !== r.g && (full?.decl.get(leaf) ?? 0) > 0) b.leafDeclaredInProject++
  if (b.samples.length < 6 && !b.samples.includes(r.g)) b.samples.push(r.g)
}
const unresolvedEdgeCounts = {
  declaredInProjectFull: unresolvedRecs.filter((r) => (fullProjects.get(r.repo)?.decl.get(r.g) ?? 0) > 0).length,
  declaredInCorpusOtherProject: unresolvedRecs.filter((r) => (fullProjects.get(r.repo)?.decl.get(r.g) ?? 0) === 0 && (fullPooled.decl.get(r.g) ?? 0) > 0).length,
  nowhere: unresolvedRecs.filter((r) => (fullPooled.decl.get(r.g) ?? 0) === 0).length,
  /** WHERE THE IN-PROJECT EDGES LAND at a complete key space: `classifyEdge` reads the count
   *  first, so decls === 1 becomes `resolved` and decls > 1 becomes `ambiguous`. A sample-scope
   *  reading calls all of them unresolved; this is the split the full run would show. */
  inProjectUnique_wouldResolve: unresolvedRecs.filter((r) => (fullProjects.get(r.repo)?.decl.get(r.g) ?? 0) === 1).length,
  inProjectColliding_wouldBeAmbiguous: unresolvedRecs.filter((r) => (fullProjects.get(r.repo)?.decl.get(r.g) ?? 0) > 1).length,
}
const byName = new Map<string, { t: Type; g: string; n: number; repos: Set<string> }>()
for (const r of unresolvedRecs) {
  const k = `${r.t}\u0000${r.g}`
  let a = byName.get(k)
  if (!a) byName.set(k, (a = { t: r.t, g: r.g, n: 0, repos: new Set() }))
  a.n++
  a.repos.add(r.repo)
}
const namesDeclaredInProject: string[] = []
const namesNowhere: string[] = []
for (const a of byName.values()) {
  let inProject = 0
  for (const repo of a.repos) inProject += fullProjects.get(repo)?.decl.get(a.g) ?? 0
  if (inProject > 0) namesDeclaredInProject.push(`${a.t} ${a.g} (${a.n})`)
  else if ((fullPooled.decl.get(a.g) ?? 0) === 0) namesNowhere.push(`${a.t} ${a.g} (${a.n})`)
}

// ---------------------------------------------------------------------------------------------
// MARK SIMULATION — candidate rules through the arbiter's own classifier
// ---------------------------------------------------------------------------------------------
type MarkArm = { name: string; rule: (r: Rec) => boolean; why: string }
const readKey = (r: Rec, k: string) => r.md[k] === true
const markOf = (r: Rec, space: Map<string, KeySpace>) =>
  classifyEdge(space.get(r.repo)?.decl ?? new Map(), space.get(r.repo)?.kinds ?? new Map(), r.g, { kind: "owner" })
const LUA_STDLIB_RECEIVERS = new Set(["string", "table", "io", "os", "math", "coroutine", "utf8", "debug", "package", "bit32"])
const MARK_ARMS: MarkArm[] = [
  {
    name: "ALL: every currently-unresolved edge marked external",
    rule: () => true,
    why: "the ceiling, not a proposal: it is what 'mark the column' would mean and it is measured so the cost of breadth is a number",
  },
  {
    name: "M1: bare identifier target the project declares nowhere (command/global position)",
    rule: (r) => isIdentifier(r.g) && (fullProjects.get(r.repo)?.decl.get(r.g) ?? 0) === 0,
    why: "the arbiter verifies a bare identifier THROUGH THE TARGET (0 declarations -> verified), and a target the project declares is excluded by construction — refutation-free, but it claims every undefined global as external",
  },
  {
    name: "M2: M1 restricted to calls (a bare name INVOKED is a runtime binding)",
    rule: (r) => r.t === "calls" && isIdentifier(r.g) && (fullProjects.get(r.repo)?.decl.get(r.g) ?? 0) === 0,
    why: "narrower than M1: a call to a name nothing declares is bound at run time, a READ of one may be a field of a value",
  },
  {
    name: "M3: stdlib-receiver member reads (the shipped rule, re-spelled on the residual)",
    rule: (r) => LUA_STDLIB_RECEIVERS.has(String(r.md.externalReceiver ?? "")) || r.md.external === true,
    why: "what the analyzer already marks; here it measures what is LEFT after its own guard",
  },
  {
    name: "M4: require/module path imports (module-shaped targets)",
    rule: (r) => r.t === "imports" && r.g.includes("."),
    why: "lua module paths are the lane's other named external class; the classb-origin split says some name corpus files",
  },
]
const markSim = MARK_ARMS.map((m) => {
  let marked = 0, verified = 0, unverified = 0, refuted = 0
  const refutedNames: string[] = []
  const unverifiedSamples: string[] = []
  for (const r of recs) {
    if (!r.inSample) continue
    if (classify(r, sampleProjects.get(r.repo)).outcome !== "unresolved") continue
    if (!m.rule(r)) continue
    marked++
    const sim = markOf(r, sampleProjects)
    if (sim.outcome === "externalVerified") verified++
    else if (sim.outcome === "externalUnverified") {
      unverified++
      if (unverifiedSamples.length < 5) unverifiedSamples.push(`${r.t} ${r.g}`)
    } else if (sim.outcome === "externalRefuted") {
      refuted++
      if (refutedNames.length < 10) refutedNames.push(`${r.t} ${r.g} (owner \`${targetOwner(r.g)}\`)`)
    }
  }
  return { name: m.name, why: m.why, marked, verified, unverified, refuted, refutedNames, unverifiedSamples }
})

// ---------------------------------------------------------------------------------------------
// AMBIGUITY SPLIT
// ---------------------------------------------------------------------------------------------
const ambRecs = recs.filter((r) => r.inSample && classify(r, sampleProjects.get(r.repo)).decls > 1)
const ambKindHistogram: Record<string, number> = Object.create(null)
const ambDetail: { t: Type; g: string; decls: number; files: number; owners: number; kindSig: string; receiver: boolean }[] = []
/** the analyzer's own marker signature on an ambiguous edge — `receiver` present means the edge
 *  was published from a MEMBER read (`M.foo`), absent means a bare name (`foo`). The split is
 *  what separates "two modules' fields share a name" from "two locals share a name". */
const ambMarkerHistogram: Record<string, number> = Object.create(null)
const ambSeen = new Set<string>()
let ambMultiFile = 0, ambOneFileDiffOwner = 0, ambOneFileSameOwnerDiffKind = 0, ambOneFileSameOwnerSameKind = 0
for (const r of ambRecs) {
  const ws = sampleProjects.get(r.repo)?.where.get(r.g) ?? []
  const files = new Set(ws.map((w) => w.file))
  const owners = new Set(ws.map((w) => `${w.file}\u0000${w.owner ?? ""}`))
  const kinds = new Set(ws.map((w) => w.kind))
  const kindSig = [...kinds].sort().join("|")
  ambKindHistogram[kindSig] = (ambKindHistogram[kindSig] ?? 0) + 1
  if (files.size > 1) ambMultiFile++
  else if (owners.size > 1) ambOneFileDiffOwner++
  else if (kinds.size > 1) ambOneFileSameOwnerDiffKind++
  else ambOneFileSameOwnerSameKind++
  if (ambDetail.length < 40 && !ambSeen.has(r.g)) {
    ambSeen.add(r.g)
    ambDetail.push({ t: r.t, g: r.g, decls: ws.length, files: files.size, owners: owners.size, kindSig, receiver: r.md.receiver !== undefined })
  }
  {
    const sig = Object.keys(r.md).filter((k) => k !== "evidenceClass" && r.md[k] !== false && r.md[k] != null).sort().join("+")
    ambMarkerHistogram[sig] = (ambMarkerHistogram[sig] ?? 0) + 1
  }
}
const ambAgg = {
  edges: ambRecs.length,
  distinctNames: new Set(ambRecs.map((r) => `${r.t}\u0000${r.g}`)).size,
  multiFile: ambMultiFile,
  oneFileDiffOwner: ambOneFileDiffOwner,
  oneFileSameOwnerDiffKind: ambOneFileSameOwnerDiffKind,
  oneFileSameOwnerSameKind: ambOneFileSameOwnerSameKind,
  kindHistogram: ambKindHistogram,
  markerHistogram: ambMarkerHistogram,
  detail: ambDetail,
}

// ---------------------------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------------------------
const sha16 = (p: string): string => {
  try {
    return execFileSync("sha256sum", [p], { encoding: "utf8" }).slice(0, 16)
  } catch {
    return "(unavailable)"
  }
}
const REPO_ROOT = path.resolve(path.dirname(SELF), "..", "..", "..", "..")
const showBag = (label: string, b: Bag) =>
  `${label.padEnd(8)} edges=${String(b.edges).padStart(6)} resolved=${String(b.resolved).padStart(6)} ` +
  `amb=${String(b.amb).padStart(5)} unresolved=${String(b.unresolved).padStart(5)} ` +
  `extV=${b.extV} extU=${b.extU} extF=${b.extF}`

console.log(`INCOMING SPLIT — lua .${EXT}`)
console.log(`analyzer digest: ${sha16(path.join(REPO_ROOT, "src/ast/real-lua-analyzer.ts"))}` +
  `   incoming-rule digest: ${sha16(path.join(REPO_ROOT, "script/m14/incoming-rule.ts"))}`)
console.log(`population: ${sample.length} sampled of ${corpusTotal} tracked .${EXT} files in ${repoCount} repos` +
  `  (excluded: absent=${absent} overCap(1MB)=${overCap})`)
console.log(`walk: ${walk.length} file(s) parsed (${ALL_FILES ? "--all" : "sample only"}); shard errors=${shardErrors.length}; excluded=${excluded.length}`)
for (const e of excluded) console.log(`  EXCLUDED ${e.file} — ${e.reason}`)
for (const e of shardErrors.slice(0, 8)) console.log(`  shard error: ${e}`)
console.log()
console.log(showBag("SAMPLE", sampleTotals))
console.log(showBag("FULL", fullTotals))
console.log(`SAMPLE VERDICT: ${sampleTotals.amb + sampleTotals.unresolved + sampleTotals.extF === 0 ? "PASS" : "FAIL"} — ` +
  `${sampleTotals.amb} ambiguous + ${sampleTotals.unresolved} unresolved of ${sampleTotals.edges} edges`)
console.log()
console.log("PER TYPE — FULL ARM, whole-corpus key space, every parsed edge (the type table):")
for (const t of ALL_TYPES) {
  const r = fullRows.get(t)!
  if (r.edges === 0) continue
  console.log(`  ${t.padEnd(13)} edges=${String(r.edges).padStart(6)} resolved=${String(r.resolved).padStart(5)} ` +
    `amb=${String(r.ambiguousByDecl).padStart(6)} unresolved=${String(r.unresolved).padStart(6)} ` +
    `extV=${r.externalVerified} extU=${r.externalUnverified} extF=${r.externalRefuted}`)
}
console.log()
console.log("EXTERNAL CLAIMS (every marked edge, at both scopes):")
console.log(`  total=${claimCounts.total}  sample: verified=${claimCounts.sampleVerified} unverifiable=${claimCounts.sampleUnverified} REFUTED=${claimCounts.sampleRefuted}` +
  `  |  whole-corpus: verified=${claimCounts.fullVerified} unverifiable=${claimCounts.fullUnverified} REFUTED=${claimCounts.fullRefuted}`)
console.log(`  marker keys (whole marked set): ${JSON.stringify(claimKeyHistogram)}`)
for (const c of claimRows.slice(0, 20)) {
  console.log(`    ${c.t.padEnd(12)} ${c.g.padEnd(28)} [${c.file}:${c.line}] keys=${c.keys} owner=${JSON.stringify(c.owner)} identTarget=${c.targetIsIdentifier}` +
    ` sample=${c.sampleOutcome} corpus=${c.fullOutcome}`)
}
if (refutedDetail.length) {
  console.log("  REFUTED CLAIMS AND THE DECLARATION THAT ANSWERED THEM:")
  for (const d of refutedDetail) console.log(`    ${d.t} ${d.g} [${d.file}] owner=${JSON.stringify(d.owner)} answered by ${d.answering.join(", ")}`)
}
console.log()
console.log("UNRESOLVED SPLIT (sample arm, whole-corpus declaration truth):")
console.log(`  edges=${unresolvedEdgeCounts.declaredInProjectFull + unresolvedEdgeCounts.declaredInCorpusOtherProject + unresolvedEdgeCounts.nowhere}` +
  `  declaredInProjectFull=${unresolvedEdgeCounts.declaredInProjectFull}` +
  `  declaredInCorpusOtherProject=${unresolvedEdgeCounts.declaredInCorpusOtherProject}` +
  `  nowhere=${unresolvedEdgeCounts.nowhere}`)
console.log(`  distinct targets: declaredInProjectFull=${namesDeclaredInProject.length} nowhere=${namesNowhere.length}`)
console.log()
console.log("UNRESOLVED BY (type × shape × markers):")
for (const b of [...buckets.values()].sort((a, b) => b.n - a.n)) {
  console.log(`  ${String(b.n).padStart(5)}  ${b.t.padEnd(13)} ${b.shape.padEnd(11)} md=${b.mdKeys}`)
  console.log(`         inProjectFull=${b.declaredInProjectFull} elsewhereInCorpus=${b.declaredInCorpusOther} leafInProject=${b.leafDeclaredInProject}  e.g. ${b.samples.join(", ")}`)
}
console.log()
console.log("MARK SIMULATION (candidate rules through the arbiter's own classifier, sample scope):")
for (const m of markSim) {
  console.log(`  ${m.name}`)
  console.log(`      marked=${m.marked}  externalVerified=${m.verified}  externalUnverified=${m.unverified}  externalREFUTED=${m.refuted}`)
  if (m.refuted) console.log(`      refuted e.g.: ${m.refutedNames.join(" | ")}`)
  if (m.unverified) console.log(`      unverified e.g.: ${m.unverifiedSamples.join(", ")}`)
}
console.log()
console.log("AMBIGUITY SPLIT (sample arm, project scope):")
console.log(`  ${JSON.stringify({ ...ambAgg, detail: undefined })}`)
console.log(`  marker signatures of the ambiguous edges: ${JSON.stringify(ambMarkerHistogram)}`)
for (const a of ambDetail.slice(0, 12)) {
  console.log(`    ${a.t.padEnd(12)} ${a.g.padEnd(20)} ${a.decls} decls · ${a.files} file(s) · ${a.owners} owner-scope(s) · kinds ${a.kindSig} · receiver=${a.receiver}`)
}

if (COMPARE) {
  const g = JSON.parse(readFileSync(COMPARE, "utf8"))
  const gt = g.totals
  const same =
    gt.resolved === sampleTotals.resolved &&
    gt.ambiguousByDecl === sampleTotals.amb &&
    gt.unresolved === sampleTotals.unresolved &&
    gt.externalVerified === sampleTotals.extV &&
    gt.externalUnverified === sampleTotals.extU &&
    gt.externalRefuted === sampleTotals.extF
  console.log()
  console.log(`COMPARE ${COMPARE}: gate=[${gt.resolved} resolved, ${gt.ambiguousByDecl} amb, ${gt.unresolved} unres, ` +
    `${gt.externalVerified} extV, ${gt.externalUnverified} extU, ${gt.externalRefuted} extF]  ` +
    `census=[${sampleTotals.resolved}, ${sampleTotals.amb}, ${sampleTotals.unresolved}, ${sampleTotals.extV}, ${sampleTotals.extU}, ${sampleTotals.extF}]  ` +
    `${same ? "AGREE" : "DISAGREE — this census is not measuring the gate's set"}`)
  if (!same) process.exitCode = 1
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    ext: EXT, nf: NF, allFiles: ALL_FILES,
    digest: {
      analyzer: sha16(path.join(REPO_ROOT, "src/ast/real-lua-analyzer.ts")),
      incomingRule: sha16(path.join(REPO_ROOT, "script/m14/incoming-rule.ts")),
    },
    population: { sampled: sample.length, corpusTotal, repos: repoCount, absent, overCap, walk: walk.length, excluded, shardErrors },
    sampleTotals, fullTotals,
    perTypeSample: Object.fromEntries([...sampleRows.entries()].map(([k, v]) => [k, v])),
    perTypeFull: Object.fromEntries([...fullRows.entries()].map(([k, v]) => [k, v])),
    externalClaims: { counts: claimCounts, keyHistogram: claimKeyHistogram, rows: claimRows, refuted: refutedDetail },
    unresolved: {
      ...unresolvedEdgeCounts,
      namesDeclaredInProject: namesDeclaredInProject.slice(0, 200),
      namesNowhere: namesNowhere.slice(0, 200),
      buckets: [...buckets.values()],
    },
    markSim,
    ambiguity: ambAgg,
  }, null, 2))
}
