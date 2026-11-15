/**
 * THE INCOMING SPLIT — powershell. The gate's population, the gate's rule, and the evidence
 * that decides every unresolved edge's bucket.
 *
 * ## Why this file exists
 *
 * `script/m14/incoming-gate.ts powershell ps1 60` reads
 * `1192 ambiguous + 5877 unresolved of 9911 edges`, and what it prints of each class is a
 * 25-row WORKLIST SAMPLE. A lane asked to split 5,877 unresolved edges into "a declared
 * external exception" and "a defect" cannot do it from 25 rows, and must not guess the rest.
 *
 * So this census re-runs the SAME walk with the SAME rule — `classifyEdge`, `externalClaimOf`,
 * `emptyOutcomes`, `tally`, `EXTERNAL_KEYS` are IMPORTED from `script/m14/incoming-rule.ts`,
 * never copied, because two copies of a counting rule are two rules — and then asks of every
 * unresolved edge the questions that separate the buckets:
 *
 *   DECLARED IN THE PROJECT (whole corpus, not this run's sample)
 *       a declaration of this exact target exists in the same repository, in a file the
 *       sample did not include. The edge is IN-CORPUS and the lookup failed because of the
 *       sample's reach, not because the analyzer emitted a wrong name. This is the bucket a
 *       `--nf 0` run dissolves, and it is reported separately from a defect on purpose.
 *   DECLARED SOMEWHERE IN THE CORPUS, another project
 *       the name exists in the corpus but not in this edge's project. Production resolves
 *       `WHERE s.project_id = ?`, so this is a name collision across repositories and NOT a
 *       resolvable edge: it is nobody's declaration, for this edge.
 *   THE LEAF IS DECLARED (same project)
 *       the target is a compound spelling (`Foo.Bar`, `env:PATH`) whose LAST segment is a
 *       declaration of the project. That is the one shape that is a real identity defect:
 *       a declaration exists and the edge names it in a spelling no key can answer.
 *   NOTHING ANYWHERE
 *       no declaration in the corpus. The edge names something outside it — a cmdlet, a .NET
 *       type, a runtime variable — or it is broken, and the ONLY evidence that can separate
 *       those two is the shape reading plus whether the project declares the spelling.
 *
 * ## The mark simulation, which is the point
 *
 * Marking an edge with a key from `EXTERNAL_KEYS` is a CLAIM, and `verifyExternalClaim` checks
 * it against the project's own key space. So every candidate rule is run through the gate's
 * own classifier BEFORE it is shipped: for each rule the census prints how many edges the rule
 * would mark and how they would classify — `externalVerified`, `externalUnverified` (no
 * identifier-shaped owner for the arbiter to look up) and `externalRefuted` (the project DOES
 * publish the owner, counted AGAINST the lane). A rule with a nonzero refuted count is not
 * shipped, and that number is the reason.
 *
 * ## Comparability, stated rather than assumed
 *
 * Population discovery is the gate's: git checkouts under the corpus root, `git ls-files`, the
 * extension argument, the gate's 1 MB size cap, sorted, then a STRIDE sample. `--compare`
 * checks this census's totals against a captured `incoming-gate.ts --json` run of the same
 * command and REFUSES to print a split when they disagree, because a split of a different set
 * is not evidence about that set.
 *
 * ## Sharding
 *
 * `parser.parse()` is synchronous WASM and `src/ast/engine.ts` answers a hang with
 * `process.exit()`, so the walk forks shards; a dead shard's offending path is read out of the
 * child's stderr, recorded as EXCLUDED with its reason, and the shard re-runs without it. A
 * zero from a shard that died is not a measurement.
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/powershell/incoming-split.mts [--ext ps1] [--nf 60]
 *        [--all] [--out FILE] [--compare FILE] [--shard-size 120]
 *
 * `--all` parses the WHOLE admitted population (not only the stride sample) — required for the
 * "declared in the project" arm, since a sample cannot answer a question about a file it did
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
const EXT = (argOf("--ext") ?? "ps1").toLowerCase()
const NF = Number(argOf("--nf") ?? "60")
const OUT = argOf("--out")
const COMPARE = argOf("--compare")
const ALL_FILES = argv.includes("--all")
const SHARD_SIZE = Number(argOf("--shard-size") ?? "120") || 120

// --------------------------------------------------------------------------------------------
// discovery — the gate's rule, restated so this file's population is the gate's
// --------------------------------------------------------------------------------------------
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

// --------------------------------------------------------------------------------------------
// shard worker — parses a slice, returns the facts a split needs and nothing else
// --------------------------------------------------------------------------------------------
type Sym = { n: string; k: string; f: string; o: string | null; q: string }
type EdgeRec = {
  t: Type
  g: string
  s: string
  line: number
  md: Record<string, unknown>
}
type ShardResult = {
  files: { label: string; repo: string; ok: boolean; syms: Sym[]; edges: EdgeRec[] }[]
  bad: string[]
  /** JSON byte length of every relationship object this shard returned, and the same walk's
   *  counterfactual with `isExternalTarget` deleted — so the cost of the re-spelling is
   *  MEASURED on the shipped output rather than computed from a byte count. */
  payloadBytes: number
  payloadBytesWithoutArbiterKey: number
}

if (process.env.BB_PS_SPLIT_SHARD) {
  const slice: Admitted[] = JSON.parse(readFileSync(process.env.BB_PS_SPLIT_SHARD, "utf8"))
  const { parseFile } = await import("../../../../src/ast/pool-worker")
  const out: ShardResult = { files: [], bad: [], payloadBytes: 0, payloadBytesWithoutArbiterKey: 0 }
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
      const md = (x?.metadata ?? {}) as Record<string, unknown>
      // The re-spelling's byte cost, measured on the shipped relationship object: the whole
      // object's JSON length, and the same object with the arbiter key deleted.
      out.payloadBytes += JSON.stringify(x).length
      if (md.isExternalTarget !== undefined) {
        const { isExternalTarget, ...rest } = md
        void isExternalTarget
        out.payloadBytesWithoutArbiterKey += JSON.stringify({ ...x, metadata: rest }).length
      } else {
        out.payloadBytesWithoutArbiterKey += JSON.stringify(x).length
      }
      edges.push({ t, g, s: String(x?.source ?? ""), line: Number(x?.line_number ?? x?.lineNumber ?? 0), md })
    }
    const degraded = r.fallback === true || r.metadata?.analysisVersion === "2.0-basic-fallback"
    out.files.push({ label: `${f.repo}/${f.rel}`, repo: f.repo, ok: !degraded, syms, edges })
  }
  writeFileSync(`${process.env.BB_PS_SPLIT_SHARD}.out`, JSON.stringify(out))
  console.log(`shard ok: ${out.files.length} files, ${out.files.reduce((n, f) => n + f.edges.length, 0)} edges`)
  process.exit(0)
}

// --------------------------------------------------------------------------------------------
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "ps-split-"))
const excluded: { file: string; reason: string }[] = []
const shards: Admitted[][] = []
for (let i = 0; i < walk.length; i += SHARD_SIZE) shards.push(walk.slice(i, i + SHARD_SIZE))

const perFile: ShardResult["files"] = []
const shardErrors: string[] = []
let payloadBytes = 0
let payloadBytesWithoutArbiterKey = 0
let shardNo = 0
for (const shard of shards) {
  shardNo++
  let pending = shard
  for (let attempt = 0; attempt < 12 && pending.length > 0; attempt++) {
    const inPath = path.join(tmp, `shard-${shardNo}-${attempt}.json`)
    writeFileSync(inPath, JSON.stringify(pending))
    const r = spawnSync("npx", ["tsx", SELF], {
      env: { ...process.env, BB_PS_SPLIT_SHARD: inPath },
      encoding: "utf8", maxBuffer: 1024 * 1024 * 1024, timeout: 900000,
    })
    if (r.status === 0 && r.stdout && r.stdout.includes("shard ok:")) {
      const res: ShardResult = JSON.parse(readFileSync(`${inPath}.out`, "utf8"))
      perFile.push(...res.files)
      shardErrors.push(...res.bad)
      payloadBytes += res.payloadBytes ?? 0
      payloadBytesWithoutArbiterKey += res.payloadBytesWithoutArbiterKey ?? 0
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
  if (shardNo % 2 === 0) process.stderr.write(`  … ${shardNo}/${shards.length} shards\n`)
}
rmSync(tmp, { recursive: true, force: true })

// --------------------------------------------------------------------------------------------
// key spaces — name + qualifiedName, the gate's own two spellings per symbol
// --------------------------------------------------------------------------------------------
type KeySpace = {
  decl: Map<string, number>
  kinds: Map<string, Set<string>>
  /** for the ambiguity split: which declarations answer a key */
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
/** per-project key spaces; `sample` from the stride sample, `full` from the whole walk */
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

// --------------------------------------------------------------------------------------------
// classification — the gate's rule, both arms
// --------------------------------------------------------------------------------------------
type Rec = {
  t: Type
  g: string
  repo: string
  file: string
  s: string
  line: number
  md: Record<string, unknown>
  claim: ExternalClaim | null
  inSample: boolean
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

const sampleRows = new Map<Type, Outcomes & { edges: number }>()
const fullRows = new Map<Type, Outcomes & { edges: number }>()
for (const t of ALL_TYPES) {
  sampleRows.set(t, { ...emptyOutcomes(), edges: 0 })
  fullRows.set(t, { ...emptyOutcomes(), edges: 0 })
}
type Bag = { edges: number; resolved: number; amb: number; unresolved: number; extV: number; extU: number; extF: number; outcomes: Outcomes }
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
  t.resolved += o.resolved
  t.ambiguousByDecl += o.ambiguousByDecl
  t.ambiguousByKind += o.ambiguousByKind
  t.unresolved += o.unresolved
  t.markedExternal += o.markedExternal
  t.externalVerified += o.externalVerified
  t.externalVerifiedByOwner += o.externalVerifiedByOwner
  t.externalVerifiedByProjectFacts += o.externalVerifiedByProjectFacts
  t.externalUnverified += o.externalUnverified
  t.externalRefuted += o.externalRefuted
  t.bindingVerified += o.bindingVerified
  t.bindingRefuted += o.bindingRefuted
  t.bindingUnverified += o.bindingUnverified
  t.causeDeclared += o.causeDeclared
  t.causeRefuted += o.causeRefuted
}
const projectOutcomes = (r: Rec, space: Map<string, KeySpace>): Outcomes => {
  const sp = space.get(r.repo)
  const o = emptyOutcomes()
  tally(o, classify(r, sp), r.g, r.t)
  return o
}
const sampleTotals = bag()
const fullTotals = bag()
for (const r of recs) {
  const so = projectOutcomes(r, sampleProjects)
  const fo = projectOutcomes(r, fullProjects)
  if (r.inSample) {
    const row = sampleRows.get(r.t)!
    row.edges++
    const c = classify(r, sampleProjects.get(r.repo))
    tally(row, c, r.g, r.t)
    fold(sampleTotals, so, 1)
  }
  const frow = fullRows.get(r.t)!
  frow.edges++
  const fc = classify(r, fullProjects.get(r.repo))
  tally(frow, fc, r.g, r.t)
  fold(fullTotals, fo, 1)
}

// --------------------------------------------------------------------------------------------
// the unresolved split (gate arm: the stride sample against the sample's key space)
// --------------------------------------------------------------------------------------------
const unresolvedRecs = recs.filter((r) => r.inSample && classify(r, sampleProjects.get(r.repo)).outcome === "unresolved")

const isAsciiUpper = (c: number) => c >= 65 && c <= 90
const isAsciiLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
/** the analyzer's `cmdlet` reading, mirrored as a REPORT label only — the shipped rule reads
 *  the analyzer's own `metadata.externalVia`, never this. Char-code scan, no regex. */
const verbNounShape = (t: string): boolean => {
  if (!isAsciiUpper(t.charCodeAt(0))) return false
  for (let i = 1; i < t.length - 1; i++) {
    if (t.charCodeAt(i) === 45 && isAsciiUpper(t.charCodeAt(i + 1))) return true
  }
  return false
}
const shapeOf = (t: string): string => {
  const c0 = t.charCodeAt(0)
  if (c0 === 39 || c0 === 34) return "quoted"
  if (t.length === 1) return "single-char"
  let dot = false, slash = false, colon = false
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 46) dot = true
    else if (c === 47 || c === 92) slash = true
    else if (c === 58) colon = true
  }
  if (dot) return "dotted"
  if (slash) return "slash"
  if (colon) return "colon"
  if (verbNounShape(t)) return "verb-noun"
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
  t: Type
  g: string
  repo: string
  n: number
  shape: string
  declaredInProjectFull: number
  declaredInCorpusOther: number
  leafDeclaredInProject: number
  leafDeclaredCorpus: number
  mdKeys: string
  via: string | null
  samples: string[]
}
const buckets = new Map<string, Row>()
for (const r of unresolvedRecs) {
  const full = fullProjects.get(r.repo)
  const otherProjectDecl = fullPooled.decl.get(r.g) ?? 0
  const inProject = full?.decl.get(r.g) ?? 0
  const leaf = leafOf(r.g)
  const via = r.md.externalVia == null ? null : String(r.md.externalVia)
  const shape = shapeOf(r.g)
  const key = `${r.t}\u0000${shape}\u0000${via ?? "(unmarked)"}`
  let b = buckets.get(key)
  if (!b) {
    buckets.set(key, (b = {
      t: r.t, g: "", repo: "", n: 0, shape,
      declaredInProjectFull: 0, declaredInCorpusOther: 0,
      leafDeclaredInProject: 0, leafDeclaredCorpus: 0,
      mdKeys: keysOf(r.md).join("+") || "(no marker)", via,
      samples: [],
    }))
  }
  b.n++
  if (inProject > 0) b.declaredInProjectFull++
  else if (otherProjectDecl > 0) b.declaredInCorpusOther++
  if (leaf !== r.g) {
    if ((full?.decl.get(leaf) ?? 0) > 0) b.leafDeclaredInProject++
    else if ((fullPooled.decl.get(leaf) ?? 0) > 0) b.leafDeclaredCorpus++
  }
  if (b.samples.length < 6 && !b.samples.includes(r.g)) b.samples.push(r.g)
}

/** the same split at NAME level, so a repeated target is one row */
const byName = new Map<string, { t: Type; g: string; n: number; repos: Set<string> }>()
for (const r of unresolvedRecs) {
  const k = `${r.t}\u0000${r.g}`
  let a = byName.get(k)
  if (!a) byName.set(k, (a = { t: r.t, g: r.g, n: 0, repos: new Set() }))
  a.n++
  a.repos.add(r.repo)
}
const namesDeclaredInProject: string[] = []
const namesDeclaredElsewhereInCorpus: string[] = []
const namesNowhere: string[] = []
for (const a of byName.values()) {
  let inProject = 0
  for (const repo of a.repos) inProject += fullProjects.get(repo)?.decl.get(a.g) ?? 0
  if (inProject > 0) { namesDeclaredInProject.push(`${a.t} ${a.g} (${a.n})`); continue }
  const pooled = fullPooled.decl.get(a.g) ?? 0
  if (pooled > 0) namesDeclaredElsewhereInCorpus.push(`${a.t} ${a.g} (${a.n})`)
  else namesNowhere.push(`${a.t} ${a.g} (${a.n})`)
}
const unresolvedEdgeCounts = {
  declaredInProjectFull: (() => { let n = 0; for (const r of unresolvedRecs) { const f = fullProjects.get(r.repo); if ((f?.decl.get(r.g) ?? 0) > 0) n++ } return n })(),
  declaredInCorpusOtherProject: (() => { let n = 0; for (const r of unresolvedRecs) { const f = fullProjects.get(r.repo); if ((f?.decl.get(r.g) ?? 0) === 0 && (fullPooled.decl.get(r.g) ?? 0) > 0) n++ } return n })(),
  nowhere: (() => { let n = 0; for (const r of unresolvedRecs) { if ((fullPooled.decl.get(r.g) ?? 0) === 0) n++ } return n })(),
}

// --------------------------------------------------------------------------------------------
// the mark simulation — every candidate rule through the gate's own classifier
// --------------------------------------------------------------------------------------------
type MarkArm = { name: string; rule: (r: Rec) => boolean; why: string }
const readKeyPresent = (r: Rec, k: string) => r.md[k] === true
const MARKS: MarkArm[] = [
  {
    name: "ALL: every currently-unresolved edge",
    rule: () => true,
    why: "the broad rule the brief warns about: no language fact separates these, so it is measured as the ceiling, not proposed",
  },
  {
    name: "V1: analyzer's cmdlet reading (md.externalTarget + via=cmdlet)",
    rule: (r) => readKeyPresent(r, "externalTarget") && r.md.externalVia === "cmdlet",
    why: "the analyzer already states this reading; the shipped key is not in EXTERNAL_KEYS, so the gate reads nothing",
  },
  {
    name: "V2: analyzer's qualified reading (md.externalTarget + via=qualified)",
    rule: (r) => readKeyPresent(r, "externalTarget") && r.md.externalVia === "qualified",
    why: "same, for dotted/colon/path spellings",
  },
  {
    name: "V3: V1+V2 (every md.externalTarget edge)",
    rule: (r) => readKeyPresent(r, "externalTarget"),
    why: "the analyzer's whole existing externality reading, re-spelled with a key the arbiter reads",
  },
  {
    name: "V4: V3 ∪ command-position bare noDeclarationInFile (calls)",
    rule: (r) => readKeyPresent(r, "externalTarget") || (readKeyPresent(r, "noDeclarationInFile") && r.t === "calls"),
    why: "adds bare command names with no reading (a name the file declares nowhere, invoked as a command)",
  },
  {
    name: "V5: V3 ∪ Verb-Noun-shaped unmarked calls (project declares nothing)",
    rule: (r) => {
      if (readKeyPresent(r, "externalTarget")) return true
      if (r.t !== "calls") return false
      if ((fullProjects.get(r.repo)?.decl.get(r.g) ?? 0) > 0) return false
      return verbNounShape(r.g)
    },
    why: "narrower than V4: only the Verb-Noun COMMAND spelling, whose binding the PowerShell runtime performs against installed modules",
  },
  {
    name: "V6: V5 ∪ .NET type instantiates (md.externalTarget already covers it)",
    rule: (r) => {
      if (readKeyPresent(r, "externalTarget")) return true
      if (r.t !== "instantiates" && r.t !== "uses") return false
      if ((fullProjects.get(r.repo)?.decl.get(r.g) ?? 0) > 0) return false
      return verbNounShape(r.g)
    },
    why: "V5 widened to the type channels; kept as a separate arm so the delta is visible",
  },
  {
    name: "V7: V3 minus the refutable class (a `::` target whose arbiter owner has no dot)",
    rule: (r) => {
      if (!readKeyPresent(r, "externalTarget")) return false
      // The arbiter's owner is everything before the LAST dot; a `::` target whose owner is a
      // BARE identifier is the one shape that can collide with a declared name (measured: the
      // single refutation is `Test.User32::GetPlacement`, owner `Test`). Excluded here so the
      // CONSERVATIVE alternative is measured rather than argued.
      let hasDoubleColon = false
      for (let i = 1; i < r.g.length; i++) if (r.g.charCodeAt(i) === 58 && r.g.charCodeAt(i - 1) === 58) hasDoubleColon = true
      if (!hasDoubleColon) return true
      const owner = targetOwner(r.g)
      if (owner === null) return true
      for (let i = 0; i < owner.length; i++) if (owner.charCodeAt(i) === 46) return true
      return false
    },
    why: "the alternative a lane ships when it refuses to put a claim the arbiter may refute on any edge, at the cost of the edges that class carries",
  },
]
const markSim = MARKS.map((m) => {
  let marked = 0, verified = 0, unverified = 0, refuted = 0
  const refutedNames: string[] = []
  const unverifiedSamples: string[] = []
  for (const r of recs) {
    if (!r.inSample) continue
    const cur = classify(r, sampleProjects.get(r.repo))
    if (cur.outcome !== "unresolved") continue
    if (!m.rule(r)) continue
    marked++
    const sim = classifyEdge(
      sampleProjects.get(r.repo)?.decl ?? new Map(),
      sampleProjects.get(r.repo)?.kinds ?? new Map(),
      r.g,
      { kind: "owner" },
    )
    if (sim.outcome === "externalVerified") verified++
    else if (sim.outcome === "externalUnverified") {
      unverified++
      if (unverifiedSamples.length < 6) unverifiedSamples.push(`${r.t} ${r.g}`)
    } else {
      refuted++
      if (refutedNames.length < 12) refutedNames.push(`${r.t} ${r.g} (owner \`${targetOwner(r.g)}\`)`)
    }
  }
  return { name: m.name, why: m.why, marked, verified, unverified, refuted, refutedNames, unverifiedSamples }
})

// --------------------------------------------------------------------------------------------
// the MARKED set, audited at BOTH scopes — this is the after-state of a shipped re-spelling,
// so the question is not "what would marking do" but "what did the shipped marking do, and
// which of its refutations could a NARROWER guard have avoided". The arbiter's owner rule is
// applied here exactly as `incoming-rule.ts` applies it, and every refuted edge is named with
// the declaration that answered its owner.
// --------------------------------------------------------------------------------------------
type Refuted = {
  t: Type; g: string; file: string; owner: string | null
  /** the declaration in the SAME file that answers the owner, when there is one */
  ownerDeclaredInFile: boolean
  /** an owner that is itself qualified (`System.IO`) vs a bare single segment (`Test`) */
  ownerIsQualified: boolean
  hasDoubleColon: boolean
}
const fullRefuted: Refuted[] = []
const fileNames = new Map<string, Set<string>>()
for (const f of perFile) {
  let s = fileNames.get(f.label)
  if (!s) fileNames.set(f.label, (s = new Set()))
  for (const sym of f.syms) s.add(sym.n.toLowerCase())
}
let markedTotal = 0
let markedVerified = 0
let markedUnverified = 0
let markedRefuted = 0
/** marked edges the project's key space ANSWERS — `classifyEdge` never consults the claim on
 *  those (the count is read first), so the mark is inert there and the edge is `resolved` (or
 *  `ambiguous` when several declarations share the name). Kept as its own column because
 *  folding it into `refuted` — the first version of this audit did — reports 1,449 refutations
 *  where the arbiter reports 82. */
let markedAnsweredByProject = 0
/** THE NARROWING THAT WOULD ZERO THE REFUTATIONS, priced rather than argued: a rule that
 *  refused to mark where the arbiter looks up a BARE identifier owner would drop every one of
 *  these edges. `System.Version` (owner `System`) and `[Text.UTF8Encoding]` (owner `Text`) are
 *  the same shape and differ only in whether the project happens to publish that segment, so
 *  the rule cannot separate a true external from a colliding one — it drops both. Counted so
 *  the alternative has a number instead of an opinion. */
const bareOwnerClass = { edges: 0, verified: 0, refuted: 0, answeredByProject: 0 }
/** the complement: marked edges whose arbiter owner is itself QUALIFIED (`System.IO`). The
 *  "mark only what the arbiter answers against the target itself" narrowing drops the edges
 *  counted in `bareOwnerClass`, and this one is what the "owner must be multi-segment"
 *  narrowing KEEPS. Two candidate rules, one measurement. */
const qualifiedOwnerClass = { edges: 0, verified: 0, refuted: 0, answeredByProject: 0 }
const refutedByShape = { ownerBare: 0, ownerQualified: 0, doubleColonWithBareOwner: 0, ownerDeclaredInFile: 0 }
for (const r of recs) {
  if (r.md.isExternalTarget !== true) continue
  markedTotal++
  const c = classify(r, fullProjects.get(r.repo))
  const ownerOfEdge = targetOwner(r.g)
  const ownerIsBareIdentifier = (() => {
    if (ownerOfEdge === null || ownerOfEdge.length === 0) return false
    const c0 = ownerOfEdge.charCodeAt(0)
    if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95 || c0 === 36)) return false
    for (let i = 1; i < ownerOfEdge.length; i++) {
      const ch = ownerOfEdge.charCodeAt(i)
      const ok = (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57) || ch === 95 || ch === 36
      if (!ok) return false
    }
    return true
  })()
  if (ownerIsBareIdentifier) {
    bareOwnerClass.edges++
    if (c.outcome === "externalVerified") bareOwnerClass.verified++
    else if (c.outcome === "externalRefuted") bareOwnerClass.refuted++
    else if (c.outcome !== "externalUnverified") bareOwnerClass.answeredByProject++
  }
  if (ownerOfEdge !== null && !ownerIsBareIdentifier) {
    qualifiedOwnerClass.edges++
    if (c.outcome === "externalVerified") qualifiedOwnerClass.verified++
    else if (c.outcome === "externalRefuted") qualifiedOwnerClass.refuted++
    else if (c.outcome !== "externalUnverified") qualifiedOwnerClass.answeredByProject++
  }
  if (c.outcome === "externalVerified") markedVerified++
  else if (c.outcome === "externalUnverified") markedUnverified++
  else if (c.outcome === "externalRefuted") {
    markedRefuted++
    const owner = targetOwner(r.g)
    let ownerIsQualified = false
    if (owner !== null) for (let i = 0; i < owner.length; i++) if (owner.charCodeAt(i) === 46) ownerIsQualified = true
    let hasDoubleColon = false
    for (let i = 1; i < r.g.length; i++) if (r.g.charCodeAt(i) === 58 && r.g.charCodeAt(i - 1) === 58) hasDoubleColon = true
    const ownerInFile = owner !== null && (fileNames.get(r.file)?.has(owner.toLowerCase()) ?? false)
    if (ownerIsQualified) refutedByShape.ownerQualified++
    else refutedByShape.ownerBare++
    if (hasDoubleColon && !ownerIsQualified) refutedByShape.doubleColonWithBareOwner++
    if (ownerInFile) refutedByShape.ownerDeclaredInFile++
    if (fullRefuted.length < 200) {
      fullRefuted.push({ t: r.t, g: r.g, file: r.file, owner, ownerDeclaredInFile: ownerInFile, ownerIsQualified, hasDoubleColon })
    }
  } else {
    markedAnsweredByProject++
  }
}

// --------------------------------------------------------------------------------------------
// the ambiguity split (gate arm)
// --------------------------------------------------------------------------------------------
const ambRecs = recs.filter((r) => r.inSample && classify(r, sampleProjects.get(r.repo)).outcome !== "resolved" && classify(r, sampleProjects.get(r.repo)).decls > 1)
type Amb = {
  t: Type; g: string; decls: number; files: number; owners: number; kinds: number
  oneFileSameOwnerSameKind: number; oneFileSameOwnerDiffKind: number; oneFileDiffOwner: number; multiFile: number
}
const ambRows: Amb[] = []
const ambKindHistogram: Record<string, number> = Object.create(null)
const ambDetail: { t: Type; g: string; decls: number; scope: string; kindSig: string; declsDetail: { file: string; owner: string | null; kind: string }[] }[] = []
const ambDetailSeen = new Set<string>()
for (const r of ambRecs) {
  const ws = sampleProjects.get(r.repo)?.where.get(r.g) ?? []
  const files = new Set(ws.map((w) => w.file))
  const owners = new Set(ws.map((w) => `${w.file}\u0000${w.owner ?? ""}`))
  const kinds = new Set(ws.map((w) => w.kind))
  ambRows.push({
    t: r.t, g: r.g, decls: ws.length, files: files.size, owners: owners.size, kinds: kinds.size,
    oneFileSameOwnerSameKind: files.size === 1 && owners.size === 1 && kinds.size === 1 ? 1 : 0,
    oneFileSameOwnerDiffKind: files.size === 1 && owners.size === 1 && kinds.size > 1 ? 1 : 0,
    oneFileDiffOwner: files.size === 1 && owners.size > 1 ? 1 : 0,
    multiFile: files.size > 1 ? 1 : 0,
  })
  // WHY a name is ambiguous is a different question per collision, and the answer is the
  // declarations themselves: their KIND set, and the distinct (file, owner) scopes. The two
  // signatures are what separate "one binding published twice" from "two files' locals that
  // share a spelling", and those have different owners.
  const kindSig = [...new Set(ws.map((w) => w.kind))].sort().join("|")
  const scopeSig = `${files.size} file(s) · ${owners.size} owner-scope(s) · ${kinds.size} kind(s)`
  ambKindHistogram[kindSig] = (ambKindHistogram[kindSig] ?? 0) + 1
  if (ambDetail.length < 40 && !ambDetailSeen.has(r.g)) {
    ambDetailSeen.add(r.g)
    ambDetail.push({ t: r.t, g: r.g, decls: ws.length, scope: scopeSig, kindSig, declsDetail: ws.slice(0, 6) })
  }
}
const ambAgg = {
  edges: ambRows.length,
  distinctNames: new Set(ambRows.map((a) => `${a.t}\u0000${a.g}`)).size,
  oneFileSameOwnerDiffKind: ambRows.reduce((n, a) => n + a.oneFileSameOwnerDiffKind, 0),
  oneFileDiffOwner: ambRows.reduce((n, a) => n + a.oneFileDiffOwner, 0),
  oneFileSameOwnerSameKind: ambRows.reduce((n, a) => n + a.oneFileSameOwnerSameKind, 0),
  multiFile: ambRows.reduce((n, a) => n + a.multiFile, 0),
  kindPairHistogram: ambKindHistogram,
  topNames: [...ambRows].sort((a, b) => b.decls - a.decls).slice(0, 20),
}

// --------------------------------------------------------------------------------------------
// report
// --------------------------------------------------------------------------------------------
const showBag = (label: string, b: Bag) =>
  `${label.padEnd(8)} edges=${String(b.edges).padStart(6)} resolved=${String(b.resolved).padStart(6)} ` +
  `amb=${String(b.amb).padStart(5)} unresolved=${String(b.unresolved).padStart(5)} ` +
  `extV=${b.extV} extU=${b.extU} extF=${b.extF}`

console.log(`INCOMING SPLIT — powershell .${EXT}`)
// The revision every number here is about. Digest, not a version string, because the
// programme's measurements are compared by analyzer revision and the version field has not
// moved for four waves.
const sha16 = (p: string): string => {
  try {
    return execFileSync("sha256sum", [p], { encoding: "utf8" }).slice(0, 16)
  } catch {
    return "(unavailable)"
  }
}
const REPO_ROOT = path.resolve(path.dirname(SELF), "..", "..", "..", "..")
console.log(`analyzer digest: ${sha16(path.join(REPO_ROOT, "src/ast/real-powershell-analyzer.ts"))}` +
  `   incoming-rule digest: ${sha16(path.join(REPO_ROOT, "script/m14/incoming-rule.ts"))}`)
console.log(`population: ${sample.length} sampled of ${corpusTotal} tracked .${EXT} files in ${repoCount} repos` +
  `  (excluded: absent=${absent} overCap(1MB)=${overCap})`)
console.log(`walk: ${walk.length} file(s) parsed by ANALYSIS arm (${ALL_FILES ? "--all" : "sample only"})` +
  `; shard errors=${shardErrors.length}; excluded=${excluded.length}; files with output=${perFile.filter((f) => f.ok).length}`)
for (const e of excluded) console.log(`  EXCLUDED ${e.file} — ${e.reason}`)
for (const e of shardErrors.slice(0, 10)) console.log(`  shard error: ${e}`)
console.log()
console.log(showBag("SAMPLE", sampleTotals))
console.log(showBag("FULL", fullTotals))
console.log(`SAMPLE VERDICT: ${sampleTotals.amb + sampleTotals.unresolved + sampleTotals.extF === 0 ? "PASS" : "FAIL"} — ` +
  `${sampleTotals.amb} ambiguous + ${sampleTotals.unresolved} unresolved of ${sampleTotals.edges} edges`)
console.log()
console.log("PER TYPE (sample arm, project scope):")
for (const t of ALL_TYPES) {
  const r = sampleRows.get(t)!
  if (r.edges === 0) continue
  console.log(`  ${t.padEnd(13)} edges=${String(r.edges).padStart(5)} resolved=${String(r.resolved).padStart(5)} ` +
    `amb=${String(r.ambiguousByDecl).padStart(5)} unresolved=${String(r.unresolved).padStart(5)}`)
}
console.log()
console.log("UNRESOLVED SPLIT (sample arm, whole-corpus declaration truth):")
console.log(`  edges=${unresolvedEdgeCounts.declaredInProjectFull + unresolvedEdgeCounts.declaredInCorpusOtherProject + unresolvedEdgeCounts.nowhere}` +
  `  declaredInProjectFull=${unresolvedEdgeCounts.declaredInProjectFull}` +
  `  declaredInCorpusOtherProject=${unresolvedEdgeCounts.declaredInCorpusOtherProject}` +
  `  nowhere=${unresolvedEdgeCounts.nowhere}`)
console.log(`  distinct targets: declaredInProjectFull=${namesDeclaredInProject.length}` +
  ` declaredElsewhereInCorpus=${namesDeclaredElsewhereInCorpus.length} nowhere=${namesNowhere.length}`)
console.log()
console.log("UNRESOLVED BY (type × shape × analyzer reading):")
const bucketRows = [...buckets.values()].sort((a, b) => b.n - a.n)
for (const b of bucketRows) {
  console.log(`  ${String(b.n).padStart(5)}  ${b.t.padEnd(13)} ${b.shape.padEnd(11)} via=${String(b.via).padEnd(10)} md=${b.mdKeys}`)
  console.log(`         inProjectFull=${b.declaredInProjectFull} elsewhereInCorpus=${b.declaredInCorpusOther} ` +
    `leafInProject=${b.leafDeclaredInProject} leafInCorpus=${b.leafDeclaredCorpus}  e.g. ${b.samples.join(", ")}`)
}
console.log()
console.log("MARK SIMULATION (each arm applied to the sample's unresolved set, classified by the gate's rule):")
for (const m of markSim) {
  console.log(`  ${m.name}`)
  console.log(`      marked=${m.marked}  externalVerified=${m.verified}  externalUnverified=${m.unverified}  externalREFUTED=${m.refuted}`)
  if (m.refuted) console.log(`      refuted e.g.: ${m.refutedNames.join(" | ")}`)
  if (m.unverified) console.log(`      unverified e.g.: ${m.unverifiedSamples.join(", ")}`)
}
console.log()
console.log(`PAYLOAD: relationships JSON ${payloadBytes} B over this walk; the same objects without the` +
  ` \`isExternalTarget\` key ${payloadBytesWithoutArbiterKey} B — the re-spelling costs` +
  ` ${payloadBytes - payloadBytesWithoutArbiterKey} B (${(((payloadBytes - payloadBytesWithoutArbiterKey) / Math.max(1, payloadBytesWithoutArbiterKey)) * 100).toFixed(3)}%)`)
console.log()
console.log(`MARKED SET (the shipped re-spelling, audited against the WHOLE-corpus key space):` +
  ` marked=${markedTotal} verified=${markedVerified} unverifiable=${markedUnverified} refuted=${markedRefuted}` +
  ` answeredByProject_resolvedOrAmbiguous=${markedAnsweredByProject}`)
console.log(`  the "no bare owner" narrowing would instead drop ${bareOwnerClass.edges} edge(s): ` +
  `${bareOwnerClass.verified} verified LOST, ${bareOwnerClass.refuted} refutation(s) avoided, ` +
  `${bareOwnerClass.answeredByProject} that the project answers anyway`)
console.log(`  the "owner must be multi-segment" narrowing would instead drop only the ` +
  `${bareOwnerClass.edges} bare-owner edge(s) above and KEEP ${qualifiedOwnerClass.edges} ` +
  `qualified-owner edge(s) (${qualifiedOwnerClass.verified} verified, ${qualifiedOwnerClass.refuted} refuted) — ` +
  `empirically refutation-free HERE, but not structurally: a project can publish a dotted qualified name`)
console.log(`  refutations by shape: ${JSON.stringify(refutedByShape)}`)
for (const r of fullRefuted.slice(0, 15)) {
  console.log(`    ${r.t.padEnd(12)} ${r.g}   [${r.file}] owner=${JSON.stringify(r.owner)}` +
    ` ownerQualified=${r.ownerIsQualified} :: =${r.hasDoubleColon} ownerDeclaredInFile=${r.ownerDeclaredInFile}`)
}
console.log()
console.log("AMBIGUITY SPLIT (sample arm, project scope):")
console.log(`  ${JSON.stringify({ ...ambAgg, topNames: undefined, kindPairHistogram: undefined })}`)
console.log(`  KIND signatures of the colliding declarations (edges): ${JSON.stringify(ambKindHistogram)}`)
for (const a of ambDetail.slice(0, 12)) {
  console.log(`    ${a.t.padEnd(12)} ${a.g.padEnd(18)} ${a.decls} decls · ${a.scope} · kinds ${a.kindSig}`)
  for (const d of a.declsDetail.slice(0, 3)) console.log(`          ${d.file} owner=${JSON.stringify(d.owner)} kind=${d.kind}`)
}
for (const a of ambAgg.topNames) console.log(`    ${a.t.padEnd(13)} ${String(a.decls).padStart(3)} decls in ${a.files} file(s) ${a.owners} owner-scope(s) ${a.kinds} kind(s)  ${a.g}`)

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
      analyzer: sha16(path.join(REPO_ROOT, "src/ast/real-powershell-analyzer.ts")),
      incomingRule: sha16(path.join(REPO_ROOT, "script/m14/incoming-rule.ts")),
    },
    population: { sampled: sample.length, corpusTotal, repos: repoCount, absent, overCap, walk: walk.length, excluded, shardErrors },
    payload: { relationshipsJsonBytes: payloadBytes, withoutArbiterKey: payloadBytesWithoutArbiterKey, delta: payloadBytes - payloadBytesWithoutArbiterKey },
    sampleTotals, fullTotals,
    perTypeSample: Object.fromEntries([...sampleRows.entries()].map(([k, v]) => [k, { ...v, ambiguousNames: undefined, unresolvedNames: undefined, refutedNames: undefined, causeNames: undefined }])),
    unresolved: {
      ...unresolvedEdgeCounts,
      namesDeclaredInProject: namesDeclaredInProject.slice(0, 200),
      namesDeclaredElsewhereInCorpus: namesDeclaredElsewhereInCorpus.slice(0, 200),
      namesNowhere: namesNowhere.slice(0, 200),
      buckets: bucketRows,
    },
    markSim,
    markedAudit: { markedTotal, markedVerified, markedUnverified, refuted: markedRefuted, answeredByProject: markedAnsweredByProject, bareOwnerNarrowing: bareOwnerClass, qualifiedOwnerClass, refutedByShape, refutedList: fullRefuted },
    ambiguity: { ...ambAgg, detail: ambDetail },
  }, null, 2))
}
