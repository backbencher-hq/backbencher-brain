/**
 * MARKDOWN WHOLE-CORPUS CENSUS — production `parseFile` over EVERY admitted markdown
 * file, sharded so one process death cannot destroy the measurement.
 *
 * ## Why this exists rather than a bigger `--sample` on `ontology-census.ts`
 *
 * `script/m14/ontology-coverage-gate.ts markdown` cannot report this lane's verdict on
 * this corpus. Two runs, both killed by the SHARED self-destruct at
 * `src/ast/engine.ts:1411` — `[BB-HANG] parser stuck 120s` — partway through its parse
 * phase, before the verdict table is printed. The process exits 1 having said nothing
 * about any type, so the run yields no verdict at all.
 *
 * The hang is not a property of a file. Run 1 trapped on
 * `Grace/sdk/generated/matrix/openapi-generator/rust/docs/DiffDto.md`,
 * `cats-effect/docs/std/deferred.md` and two `dart-sdk` READMEs; run 2 trapped on
 * `FsToolkit.ErrorHandling/gitbook/validation/{ofChoice,mapErrors}.md` and a different
 * `Grace` OpenAPI page. Zero overlap, and every one of those six parses alone in
 * 60–2,678 ms. What is measured here is therefore a population, and the population is
 * what has to survive: each shard is its own process, so a shard that hangs costs
 * `--shards` files instead of all 15,234, and the loss is REPORTED as a number rather
 * than being invisible.
 *
 * `ontology-census.ts` and this script measure overlapping things and differ in two
 * ways that matter, so both are kept and neither supersedes the other:
 *
 *   - POPULATION. `ontology-census.ts` admits by EXTENSION (`\.(md|markdown)$`, 12,729
 *     files). This admits by the ROUTER — `detectLanguageFromPath(abs, text) === "markdown"`,
 *     which is what the arbiter admits on and reads 15,234 — so the two counts are
 *     populations, not a discrepancy. Both are printed.
 *   - SHARDING. One process here, `--shards` children. Eight-way concurrency INSIDE a
 *     shard is kept because that is what production does.
 *
 * Every number it prints comes from `parseFile` (`src/ast/pool-worker.ts`), never from
 * `analyze()`. Per shard it tallies, per the workstream's six questions:
 *
 *   - relationship type -> count, files, per-repo counts, example files
 *   - `SymbolKind` values, and any kind outside the shared enum (reported, not tolerated)
 *   - symbols with an empty name (standing rule: none)
 *   - endpoints equal to the literal `unknown` (rule R7: none)
 *   - endpoint resolution per type at two tiers, file-local and corpus-wide, kept apart
 *     because they answer different questions for this lane (see `ontology-census.ts`)
 *   - confidence histogram and the sub-0.7 heuristic count per type (honesty contract §4)
 *   - `metadata.evidenceClass` and `metadata.role` histograms per type
 *
 * Resolution at the CORPUS tier is computed in the parent from the per-file name sets the
 * shards return, so it is a whole-corpus number and not a per-shard number added up.
 *
 * A shard's payload goes to a FILE, never to stdout: the parent reads the name sets of
 * every shard first (the corpus tier needs the whole population before any edge can be
 * resolved against it), then reads the tallies. Two files per shard, so that ordering
 * costs a second read of a small file rather than a second PARSE.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/markdown/whole-corpus-census.ts \
 *     [--shards 16] [--resume] [--out validation/m60/markdown/whole-corpus-census.json]
 */
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELF = path.join(HERE, "whole-corpus-census.ts")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SHARDS = Math.max(1, Number(arg("shards", "16")))
const OUT = arg("out", "")
/** Child mode. The parent passes an explicit shard index; nothing else spawns a shard. */
const SHARD_INDEX = argv.indexOf("--shard")
const IS_CHILD = SHARD_INDEX >= 0
const CHILD_SHARDS = Number(argv[SHARD_INDEX + 1] ?? "1")
const CHILD_INDEX = Number(argv[SHARD_INDEX + 2] ?? "0")
const SHARD_DIR = arg("shard-dir", "")
/** Opt-in: reuse a shard payload on disk iff it was measured over this population. */
const RESUME = argv.includes("--resume")

/** Every value `ASTEngine.SymbolKind` can take, read off the shared enum rather than
 *  copied from a doc. A kind outside this set is reported, not tolerated. */
const SYMBOL_KINDS = new Set([
  "function", "class", "variable", "constant", "interface", "enum", "enum_member",
  "type", "import", "export", "method", "property", "constructor", "namespace",
  "module", "event", "delegate", "macro", "trait", "struct", "impl", "actor",
  "union", "mixin", "extension", "instance",
])

/** The 10 ontology types, so a type with ZERO edges gets a row rather than vanishing. */
const ONTOLOGY_TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates",
] as const

/** Non-symbol endpoints this lane publishes, counted apart from a dangling endpoint.
 *  `document` is the analyzer's `DOC` container: a top-level fact has no heading owner. */
const SOURCE_MARKERS = new Set(["document"])

// ─────────────────────────────────────────────────────────── corpus (router admission)
type FileRec = { repo: string; dir: string; rel: string; abs: string }
const all: FileRec[] = []
const repoCommits: Record<string, string> = {}
const repoPopulation: Record<string, number> = {}
let admittedByExtension = 0
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  try { repoCommits[e] = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { repoCommits[e] = "unknown" }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  let admitted = 0
  for (const rel of tracked) {
    if (!/\.(md|markdown)$/i.test(rel)) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    admittedByExtension++
    // The arbiter's admission test: the ROUTER decides, not the extension.
    if (detectLanguageFromPath(abs, text) !== "markdown") continue
    admitted++
    all.push({ repo: e, dir, rel, abs })
  }
  if (admitted > 0) repoPopulation[e] = admitted
}

/** Deterministic order: by repo then path. No sampling, so no seed is needed and there
 *  is no draw to publish — the population IS the corpus, and `populationHash` names it. */
all.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))
const key = (f: FileRec) => `${f.repo}/${f.rel}`
const populationHash = createHash("sha256").update(all.map(key).join("\n")).digest("hex")

// ─────────────────────────────────────────────────────────── one shard's tallies
type EdgeRec = { t: string; src: string; tgt: string; f: number }
type ShardOut = {
  shard: number
  shards: number
  assigned: number
  parsed: number
  parseFailures: number
  parseFailureFiles: string[]
  /** files where production `parseFile` returned `fallback: true` — see the note below */
  fallbackFiles: string[]
  fallbackRelationships: number
  fallbackSymbols: number
  symbols: number
  relationships: number
  /** name sets per shard-local file index, for the parent's corpus-tier resolution */
  fileNames: string[][]
  edgeRecs: EdgeRec[]
  kinds: Record<string, number>
  unknownKinds: Record<string, number>
  emptyNameSymbols: string[]
  unknownEndpoints: string[]
  filesParsed: string[]
  perRepoFiles: Record<string, number>
  typeCount: Record<string, number>
  typeRepo: Record<string, Record<string, number>>
  typeExamples: Record<string, string[]>
  typeFileSet: Record<string, string[]>
  confidence: Record<string, Record<string, number>>
  evidenceClass: Record<string, Record<string, number>>
  role: Record<string, Record<string, number>>
  heuristicUnder07: Record<string, number>
  lineNumbered: Record<string, number>
  fileLocal: Record<string, { srcMarker: number; srcOk: number; srcDangling: number; tgtOk: number; tgtDangling: number; bothOk: number }>
  tookMs: number
}

async function runShard(index: number, shards: number, assigned: FileRec[]): Promise<ShardOut> {
  const t0 = Date.now()
  const out: ShardOut = {
    shard: index, shards, assigned: assigned.length, parsed: 0, parseFailures: 0,
    parseFailureFiles: [], fallbackFiles: [], fallbackRelationships: 0, fallbackSymbols: 0,
    symbols: 0, relationships: 0, fileNames: [], edgeRecs: [],
    kinds: {}, unknownKinds: {}, emptyNameSymbols: [], unknownEndpoints: [],
    filesParsed: [], perRepoFiles: {},
    typeCount: {}, typeRepo: {}, typeExamples: {}, typeFileSet: {},
    confidence: {}, evidenceClass: {}, role: {}, heuristicUnder07: {}, lineNumbered: {},
    fileLocal: {}, tookMs: 0,
  }
  const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1 }
  const filesSeen = new Set<string>()

  let cursor = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++
      if (i >= assigned.length) return
      const f = assigned[i]
      let r: any
      try { r = await parseFile(f.abs, f.dir) } catch { out.parseFailures++; if (out.parseFailureFiles.length < 12) out.parseFailureFiles.push(key(f)); continue }
      const fi = out.fileNames.length
      out.fileNames.push([])
      out.filesParsed.push(key(f))
      out.parsed++
      out.perRepoFiles[f.repo] = (out.perRepoFiles[f.repo] ?? 0) + 1
      // `fallback: true` means `parseFile` did NOT run the analyzer. It reached
      // `extractFallback` (`src/ast/pool-worker.ts:266`), whose symbols carry no `kind`
      // and whose `calls` / `instantiates` edges are a regex read of the file's TEXT — for
      // a markdown document that text is fenced code in someone else's language. Those
      // edges are attributed to this lane's files by the production entry point and are
      // NOT this lane's output, so they are counted here rather than left to be inferred
      // later from the kind-less symbols they arrive with.
      const degraded = r.fallback === true
      if (degraded) {
        out.fallbackFiles.push(key(f))
        out.fallbackRelationships += (r.relationships ?? []).length
        out.fallbackSymbols += (r.symbols ?? []).length
      }
      const symbols: any[] = r.symbols ?? []
      const names = new Set<string>()
      for (const s of symbols) {
        out.symbols++
        const nm = typeof s.name === "string" ? s.name : ""
        const k = typeof s.kind === "string" ? s.kind : String(s.kind ?? "")
        bump(out.kinds, k)
        if (!SYMBOL_KINDS.has(k)) bump(out.unknownKinds, k)
        if (nm.length === 0 && out.emptyNameSymbols.length < 40) out.emptyNameSymbols.push(`${key(f)}@${s.range?.startLine ?? 0}`)
        if (nm) names.add(nm)
      }
      out.fileNames[fi] = [...names]
      for (const e of r.relationships ?? []) {
        out.relationships++
        const t = String(e.type ?? e.relationshipType ?? "")
        bump(out.typeCount, t)
        if (!out.typeRepo[t]) out.typeRepo[t] = {}
        bump(out.typeRepo[t], f.repo)
        if (!filesSeen.has(`${t}\u0000${key(f)}`)) {
          filesSeen.add(`${t}\u0000${key(f)}`)
          if (!out.typeFileSet[t]) out.typeFileSet[t] = []
          out.typeFileSet[t].push(key(f))
          if (!out.typeExamples[t]) out.typeExamples[t] = []
          if (out.typeExamples[t].length < 4) out.typeExamples[t].push(key(f))
        }
        const src = String(e.source ?? "")
        const tgt = String(e.target ?? "")
        if ((src === "unknown" || tgt === "unknown") && out.unknownEndpoints.length < 40) {
          out.unknownEndpoints.push(`${t} ${src} -> ${tgt} @ ${key(f)} [${names.has(src) || names.has(tgt) ? "declared in this file" : "PLACEHOLDER"}]`)
        }
        out.edgeRecs.push({ t, src, tgt, f: fi })
        const fl = (out.fileLocal[t] ??= { srcMarker: 0, srcOk: 0, srcDangling: 0, tgtOk: 0, tgtDangling: 0, bothOk: 0 })
        const isMarker = SOURCE_MARKERS.has(src)
        if (isMarker) fl.srcMarker++
        else if (names.has(src)) fl.srcOk++
        else fl.srcDangling++
        if (names.has(tgt)) fl.tgtOk++
        else fl.tgtDangling++
        if (names.has(tgt) && (isMarker || names.has(src))) fl.bothOk++
        const conf = typeof e.confidence === "number" ? e.confidence : 1
        if (!out.confidence[t]) out.confidence[t] = {}
        bump(out.confidence[t], String(conf))
        if (conf < 0.7) bump(out.heuristicUnder07, t)
        const md = e.metadata ?? {}
        const ec = String(md.evidenceClass ?? "(absent)")
        if (!out.evidenceClass[t]) out.evidenceClass[t] = {}
        bump(out.evidenceClass[t], ec)
        const ro = String(md.role ?? "(absent)")
        if (!out.role[t]) out.role[t] = {}
        bump(out.role[t], ro)
        if (typeof e.line_number === "number" && e.line_number > 0) bump(out.lineNumbered, t)
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()))
  out.tookMs = Date.now() - t0
  return out
}

// ─────────────────────────────────────────────────────────── child mode
if (IS_CHILD) {
  if (!SHARD_DIR) {
    console.error("--shard requires --shard-dir")
    process.exit(2)
  }
  const mine = all.filter((_, i) => i % CHILD_SHARDS === CHILD_INDEX)
  const o = await runShard(CHILD_INDEX, CHILD_SHARDS, mine)
  mkdirSync(SHARD_DIR, { recursive: true })
  // Two files, so the parent can learn the whole population's names before it resolves a
  // single edge. `edgeRecs` carries the shard-local file index `f`; the parent re-bases
  // it when it appends, because the order shards finish in is not the order they were
  // spawned in when one is LOST.
  writeFileSync(path.join(SHARD_DIR, `${CHILD_INDEX}.names.json`), JSON.stringify(o.fileNames))
  // `populationSha256` is what makes `--resume` safe: a tally left by a run over a
  // DIFFERENT corpus, or a different shard count, is refused rather than merged.
  writeFileSync(
    path.join(SHARD_DIR, `${CHILD_INDEX}.tally.json`),
    JSON.stringify({ ...o, fileNames: undefined, populationSha256: populationHash }),
  )
  console.log(`@@DONE@@ shard ${CHILD_INDEX}: ${o.assigned} assigned, ${o.parsed} parsed, ${o.parseFailures} parse failures, ${o.relationships} relationships, ${(o.tookMs / 1000).toFixed(1)}s`)
  process.exit(0)
}

// ─────────────────────────────────────────────────────────── parent mode
console.log(`markdown whole-corpus census`)
console.log(`corpus ${CR}`)
console.log(`admitted by EXTENSION .md/.markdown: ${admittedByExtension}`)
console.log(`admitted by ROUTER (detectLanguageFromPath === "markdown"): ${all.length} across ${Object.keys(repoPopulation).length} repos`)
console.log(`population sha256=${populationHash.slice(0, 16)}  shards=${SHARDS}  workers/shard=8`)
console.log("")

const shardDir = SHARD_DIR || path.join(OUT ? path.dirname(path.resolve(OUT)) : HERE, ".whole-corpus-shards")
const shards: ShardOut[] = []
const lostShards: number[] = []
const reusedShards: number[] = []
for (let s = 0; s < SHARDS; s++) {
  const mine = all.filter((_, i) => i % SHARDS === s)
  if (mine.length === 0) continue
  // `--resume` is opt-in. Off by default, so the default path is a census that parses
  // everything it reports. On, a shard whose payload is on disk FOR THIS POPULATION and
  // THIS SHARD COUNT is reused instead of re-parsed, and counted as reused — a resumed
  // census must not be able to present itself as a single uninterrupted one. This run's
  // first attempt was cut by the harness timeout after 23 of 24 shards, and re-parsing
  // 16,000 files to recover one shard is not a measurement, it is a waste.
  if (RESUME) {
    const p = path.join(shardDir, `${s}.tally.json`)
    try {
      const prev = JSON.parse(readFileSync(p, "utf8")) as ShardOut & { populationSha256?: string }
      if (prev.populationSha256 === populationHash && prev.shards === SHARDS && Array.isArray(prev.edgeRecs)) {
        shards.push(prev)
        reusedShards.push(s)
        console.log(`shard ${s}: REUSED ${prev.assigned} assigned, ${prev.parsed} parsed, ${prev.relationships} relationships, ${(prev.tookMs / 1000).toFixed(1)}s`)
        continue
      }
      console.log(`shard ${s}: stale payload on disk, re-running`)
    } catch {
      console.log(`shard ${s}: no reusable payload, running`)
    }
  }
  const r = spawnSync(
    process.execPath,
    ["--import", "tsx", SELF, "--shard", String(SHARDS), String(s), "--shard-dir", shardDir],
    { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, cwd: path.resolve(HERE, "../../../..") },
  )
  const done = (r.stdout ?? "").split("\n").find((l) => l.startsWith("@@DONE@@"))
  if (r.status !== 0 || !done) {
    // A shard that hit the shared 120s self-destruct exits 1 with no payload. Recorded,
    // not hidden: this is the whole reason the census is sharded.
    lostShards.push(s)
    const err = ((r.stderr ?? "").split("\n").filter((l) => /BB-HANG|BB-PARSE-ERR/.test(l)).slice(-3)).join(" | ")
    console.log(`shard ${s}: LOST (exit ${r.status}, ${mine.length} files)${err ? ` ${err}` : ""}`)
    continue
  }
  console.log(done.replace("@@DONE@@ ", ""))
  const tally = JSON.parse(readFileSync(path.join(shardDir, `${s}.tally.json`), "utf8")) as ShardOut
  shards.push(tally)
}

// ─────────────────────────────────────────────────────────── merge
const allTypes = [...new Set([...ONTOLOGY_TYPES, ...shards.flatMap((s) => Object.keys(s.typeCount))])] as string[]
const kinds: Record<string, number> = {}
const unknownKinds: Record<string, number> = {}
const add = (dst: Record<string, number>, src: Record<string, number>) => {
  for (const [k, v] of Object.entries(src)) dst[k] = (dst[k] ?? 0) + v
}
const perRepoFiles: Record<string, number> = {}
for (const s of shards) {
  add(kinds, s.kinds); add(unknownKinds, s.unknownKinds); add(perRepoFiles, s.perRepoFiles)
}

const fileNames: string[][] = []
const corpusNames = new Set<string>()
// Names first, across every shard that survived: the corpus tier cannot be computed
// until the whole population's names are known, which is why the child wrote them apart.
for (const s of shards) {
  const names: string[][] = JSON.parse(readFileSync(path.join(shardDir, `${s.shard}.names.json`), "utf8"))
  for (const ns of names) {
    fileNames.push(ns)
    for (const n of ns) corpusNames.add(n)
  }
}

const typeCount: Record<string, number> = {}
const typeRepo: Record<string, Record<string, number>> = {}
const typeFiles = new Map<string, Set<string>>()
const typeExamples: Record<string, string[]> = {}
const confidence: Record<string, Record<string, number>> = {}
const evidenceClass: Record<string, Record<string, number>> = {}
const role: Record<string, Record<string, number>> = {}
const heuristicUnder07: Record<string, number> = {}
const lineNumbered: Record<string, number> = {}
const fileLocal: Record<string, { srcMarker: number; srcOk: number; srcDangling: number; tgtOk: number; tgtDangling: number; bothOk: number }> = {}
const corpusTier = new Map<string, { srcOk: number; tgtOk: number; bothOk: number }>()
const unknownEndpoints: string[] = []
const emptyNameSymbols: string[] = []
const allEdges: EdgeRec[] = []
for (const s of shards) {
  add(typeCount, s.typeCount)
  for (const [t, m] of Object.entries(s.typeRepo)) {
    typeRepo[t] = typeRepo[t] ?? {}
    add(typeRepo[t], m)
  }
  for (const [t, fs] of Object.entries(s.typeFileSet)) {
    const set = typeFiles.get(t) ?? new Set<string>()
    for (const f of fs) set.add(f)
    typeFiles.set(t, set)
  }
  for (const [t, ex] of Object.entries(s.typeExamples)) {
    typeExamples[t] = [...new Set([...(typeExamples[t] ?? []), ...ex])].slice(0, 4)
  }
  for (const m of [s.confidence, s.evidenceClass, s.role] as Record<string, Record<string, number>>[]) {
    for (const [t, inner] of Object.entries(m)) {
      const target = m === s.confidence ? confidence : m === s.evidenceClass ? evidenceClass : role
      target[t] = target[t] ?? {}
      add(target[t], inner)
    }
  }
  add(heuristicUnder07, s.heuristicUnder07)
  add(lineNumbered, s.lineNumbered)
  for (const [t, fl] of Object.entries(s.fileLocal)) {
    const dst = (fileLocal[t] ??= { srcMarker: 0, srcOk: 0, srcDangling: 0, tgtOk: 0, tgtDangling: 0, bothOk: 0 })
    dst.srcMarker += fl.srcMarker; dst.srcOk += fl.srcOk; dst.srcDangling += fl.srcDangling
    dst.tgtOk += fl.tgtOk; dst.tgtDangling += fl.tgtDangling; dst.bothOk += fl.bothOk
  }
  unknownEndpoints.push(...s.unknownEndpoints)
  emptyNameSymbols.push(...s.emptyNameSymbols)
  // `edgeRecs[].f` is the shard-local file index and is NOT read here: the file-local
  // tier was computed in the child, and the corpus tier needs only the two names. So
  // the merged edge list needs no re-basing, and a LOST shard cannot shift an index.
  for (const e of s.edgeRecs) allEdges.push({ t: e.t, src: e.src, tgt: e.tgt, f: e.f })
}
for (const e of allEdges) {
  const c = corpusTier.get(e.t) ?? { srcOk: 0, tgtOk: 0, bothOk: 0 }
  const sOK = corpusNames.has(e.src)
  const tOK = corpusNames.has(e.tgt)
  if (sOK) c.srcOk++
  if (tOK) c.tgtOk++
  if (sOK && tOK) c.bothOk++
  corpusTier.set(e.t, c)
}

// ─────────────────────────────────────────────────────────── report
const pct = (n: number, d: number) => (d > 0 ? ((100 * n) / d).toFixed(1) : "n/a")
const fallbackFiles = shards.flatMap((s) => s.fallbackFiles)
const fallbackSymbolsTotal = shards.reduce((a, s) => a + s.fallbackSymbols, 0)
const fallbackRelsTotal = shards.reduce((a, s) => a + s.fallbackRelationships, 0)
const totalSymbols = shards.reduce((a, s) => a + s.symbols, 0)
const totalRels = shards.reduce((a, s) => a + s.relationships, 0)
const totalParsed = shards.reduce((a, s) => a + s.parsed, 0)
const totalFailures = shards.reduce((a, s) => a + s.parseFailures, 0)
const lostFiles = lostShards.reduce((a, s) => a + all.filter((_, i) => i % SHARDS === s).length, 0)

const out: Record<string, unknown> = {
  instrument: "markdown whole-corpus census (validation/m14/fixtures/markdown/whole-corpus-census.ts)",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  corpusRoot: CR,
  population: {
    admissionTest: 'detectLanguageFromPath(abs, text) === "markdown" — the arbiter\'s test',
    admittedByExtension: admittedByExtension,
    admittedByRouter: all.length,
    reposWithMarkdown: Object.keys(repoPopulation).length,
    repoPopulation,
    repoCommits,
    populationSha256: populationHash,
  },
  sharding: {
    shards: SHARDS,
    workersPerShard: 8,
    lostShards,
    reusedShards,
    resumed: RESUME,
    resumeNote:
      "reusedShards were parsed by an EARLIER invocation of this same script over the same populationSha256 with the same shard count; the payload is the file on disk, not a re-parse. Empty means one uninterrupted invocation parsed every shard.",
    lostShardFiles: lostFiles,
    why: "src/ast/engine.ts:1411 kills the whole process after 120s on one file, so an unsharded census of this corpus reports nothing. Two arbiter runs died there. See docs/analyzers/markdown.md.",
  },
  parsed: totalParsed,
  parseFailures: totalFailures,
  parseFailureExamples: shards.flatMap((s) => s.parseFailureFiles).slice(0, 12),
  degradedParse: {
    what: "files where production `parseFile` returned `fallback: true`, i.e. did NOT run real-markdown-analyzer.ts",
    producer: "src/ast/pool-worker.ts extractFallback() — regex over the file TEXT, symbols with no `kind`, `calls`/`instantiates` at confidence 0.5/0.6, every source the literal \"this\"",
    files: fallbackFiles.length,
    filesPct: `${((fallbackFiles.length / Math.max(1, totalParsed)) * 100).toFixed(4)}%`,
    symbols: fallbackSymbolsTotal,
    relationships: fallbackRelsTotal,
    examples: fallbackFiles.slice(0, 12),
    why: "extractFallback returns `errors: []`, so a degraded parse is indistinguishable from a clean one by anything that reads `errors`. Counted here from the `fallback` flag itself, not inferred.",
  },
  filesParsed: totalParsed,
  symbols: totalSymbols,
  relationships: totalRels,
  filesPerRepo: perRepoFiles,
  symbolKinds: Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1])),
  kindsOutsideSharedSymbolKind: unknownKinds,
  emptyNameSymbols: emptyNameSymbols.length,
  emptyNameExamples: emptyNameSymbols.slice(0, 10),
  unknownEndpoints: unknownEndpoints.length,
  unknownEndpointExamples: unknownEndpoints.slice(0, 10),
  types: undefined as unknown as Record<string, unknown>,
}
// `out.types` is reached through `Record<string, unknown>`, where a non-null assertion
// narrows to `{}` and refuses the index. A local of the right type is the fix.
const typesOut: Record<string, unknown> = {}
out.types = typesOut
for (const t of allTypes) {
  const fl = fileLocal[t] ?? { srcMarker: 0, srcOk: 0, srcDangling: 0, tgtOk: 0, tgtDangling: 0, bothOk: 0 }
  const ct = corpusTier.get(t) ?? { srcOk: 0, tgtOk: 0, bothOk: 0 }
  typesOut[t] = {
    count: typeCount[t] ?? 0,
    files: typeFiles.get(t)?.size ?? 0,
    perRepo: typeRepo[t] ?? {},
    exampleFiles: typeExamples[t] ?? [],
    resolution: {
      fileLocal: {
        bothEnds: `${fl.bothOk} (${pct(fl.bothOk, typeCount[t] ?? 0)}%)`,
        sourceMarker: fl.srcMarker,
        sourceResolved: fl.srcOk,
        sourceDangling: fl.srcDangling,
        targetResolved: fl.tgtOk,
        targetDangling: fl.tgtDangling,
      },
      corpusWide: {
        bothEnds: `${ct.bothOk} (${pct(ct.bothOk, typeCount[t] ?? 0)}%)`,
        sourceResolved: ct.srcOk,
        targetResolved: ct.tgtOk,
      },
    },
    confidence: confidence[t] ?? {},
    heuristicUnder07: heuristicUnder07[t] ?? 0,
    heuristicPct: `${pct(heuristicUnder07[t] ?? 0, typeCount[t] ?? 0)}%`,
    evidenceClass: evidenceClass[t] ?? {},
    role: role[t] ?? {},
    lineNumbered: `${lineNumbered[t] ?? 0} (${pct(lineNumbered[t] ?? 0, typeCount[t] ?? 0)}%)`,
  }
}

const line = (s: string) => console.log(s)
line("")
line(
  `shards completed ${shards.length}/${SHARDS} (${reusedShards.length} reused from a prior invocation over the same population), files lost to a shard death ${lostFiles}`,
)
line(`parsed ${totalParsed}, parse failures ${totalFailures}, symbols ${totalSymbols}, relationships ${totalRels}`)
line("")
line(`symbol kinds: ${Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ")}`)
line(`kinds outside the shared SymbolKind: ${Object.keys(unknownKinds).length === 0 ? "none" : JSON.stringify(unknownKinds)}`)
line(`symbols with an empty name: ${emptyNameSymbols.length}`)
line(
  `files that took the SHARED regex fallback instead of the analyzer: ${fallbackFiles.length} (${((fallbackFiles.length / Math.max(1, totalParsed)) * 100).toFixed(4)}% of ${totalParsed}), carrying ${fallbackSymbolsTotal} kind-less symbols and ${fallbackRelsTotal} relationships`,
)
line(`endpoints equal to the literal 'unknown': ${unknownEndpoints.length}`)
line("")
line(`${"type".padEnd(14)}${"count".padStart(9)}${"files".padStart(7)}  ${"both/file".padEnd(11)}${"both/corpus".padEnd(12)}${"heur<0.7".padStart(9)}  evidenceClass`)
for (const t of allTypes) {
  const fl = fileLocal[t] ?? { bothOk: 0 }
  const ct = corpusTier.get(t) ?? { bothOk: 0 }
  const n = typeCount[t] ?? 0
  const ec = Object.entries(evidenceClass[t] ?? {}).map(([k, v]) => `${k}=${v}`).join(",") || "-"
  line(
    `${t.padEnd(14)}${String(n).padStart(9)}${String(typeFiles.get(t)?.size ?? 0).padStart(7)}  ` +
    `${`${pct(fl.bothOk, n)}%`.padEnd(11)}${`${pct(ct.bothOk, n)}%`.padEnd(12)}${String(heuristicUnder07[t] ?? 0).padStart(9)}  ${ec}`,
  )
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
  line(`\nwrote ${OUT}`)
}
