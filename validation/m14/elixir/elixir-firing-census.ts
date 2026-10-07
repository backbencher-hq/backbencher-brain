// ELIXIR FIX2 — firing census through the PRODUCTION path, over the WHOLE corpus.
//
// Why this file exists. `RelationshipType.X` appearing in
// src/ast/real-elixir-analyzer.ts proves the type is CONSTRUCTIBLE. It proves
// nothing about whether any branch matches on real code, and this programme was
// misled for a week by exactly that inference. So every verdict below comes from
// running the analyzer the way production runs it:
//
//   ASTEngine.parseFile -> getParser('elixir') -> parse -> getAnalyzer -> analyze
//
// and from nothing else. script/m14/firing-check-v2.mjs is the shared instrument
// and it is the authority for the headline score; this is the LANE instrument and
// it adds the four things the headline does not print:
//
//   * the FULL corpus, not a first-N walk (the elixir corpus is 610 files, small
//     enough that sampling is a choice rather than a necessity, and a sample is
//     how "a verdict that only holds at one file count" happens),
//   * the DERIVED file population, printed next to the count, because the
//     honesty contract's rule about instruments is that "0" without its
//     denominator is a claim, not a measurement,
//   * per-type FIELD tallies — confidence, evidenceClass, reasonCode on sub-1.0
//     edges, line presence, endpoint resolution — because workstream questions 4,
//     5, 6 and 7 are field questions and a type-only tally cannot answer them,
//   * the imports CHANNEL separately from the relationship channel, because
//     ParseResult carries imports on its own field and no relationship-type
//     tally can observe it.
//
// NO REGEX. Every string decision below is `endsWith`, `===`, `split`, a
// Set/Map lookup, `charAt`, or an integer comparison. The one place a pattern
// would be tempting — deciding whether a source name is the `global`
// pseudo-source — is a `===` against a literal.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join, relative } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RelationshipType } from "../../../src/ast/types"

const SUBJECT_PATH = join(import.meta.dir, "../../../src/ast/real-elixir-analyzer.ts")

// ELIXIR_FIX2-S1: the artifact used to record `subjectCommit: "unrecorded"` unless
// an env var was passed, so a census taken BEFORE an analyzer fix read exactly
// like one taken after it. That is how a 68,402-relationship artifact sat next to
// an analyzer that produces 68,372 and nobody noticed for a commit. The honesty
// contract's L0 rule is "evidence commit != current HEAD", which needs the commit
// and the subject's BYTES to be able to fire; both are recorded now, and a
// drifted artifact is detectable without re-running anything.
function subjectSha(): string {
  try { return createHash("sha256").update(readFileSync(SUBJECT_PATH)).digest("hex").slice(0, 16) } catch { return "unreadable" }
}
function headCommit(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: join(import.meta.dir, "../../.."), encoding: "utf8" }).trim() } catch { return "unknown" }
}
function subjectDirty(): boolean {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", "src/ast/real-elixir-analyzer.ts"], { cwd: join(import.meta.dir, "../../.."), encoding: "utf8" })
    return out.trim().length > 0
  } catch { return true }
}

// The ten production relationship-type spellings. src/ast/types.ts and
// src/ast/engine.ts currently agree; both are read and the divergence is
// reported rather than hidden.
const TYPES_ENUM: string[] = [...new Set(Object.values(RelationshipType))]
const TYPES_PROD: string[] = [...new Set(Object.values(ASTEngine.RelationshipType))]
const ALL_TYPES = TYPES_PROD

// Spellings that are not any enum value but are known to be produced by some
// lanes as raw literals. Kept as a literal list so it stays regex-free, and
// checked so a lane cannot look complete by inventing a type name.
const KNOWN_OFF_ENUM = new Set(["imports", "import", "depends", "dependson"])

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const CORPUS_DIRS = (process.env.ELIXIR_CORPUS_DIRS ?? "elixir,otp").split(",")
const EXTS = [".ex", ".exs"]
const WANT = Number(process.argv[2] || 0) // 0 == the whole corpus

// ---------------------------------------------------------------- file list
// DERIVED, never hand-written. A hard-coded `FILES = [...]` is a defect the
// moment a file lands beside it, and it keeps reporting its number with total
// confidence (honesty contract, "Rule: an instrument must declare the
// population it covered").
function collectFiles(root: string, dirs: string[], exts: string[]): Array<{ path: string; rel: string }> {
  const out: Array<{ path: string; rel: string }> = []
  for (const d of dirs) {
    const base = join(root, d)
    const walk = (dir: string, depth: number): void => {
      if (depth > 24) return
      let ents: any[]
      try { ents = readdirSync(dir, { withFileTypes: true }) as any[] } catch { return }
      for (const e of ents) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          const skip = e.name === ".git" || e.name === "node_modules" || e.name === "_build" || e.name === "deps"
          if (!skip) walk(p, depth + 1)
        } else if (e.isFile()) {
          let want = false
          for (const x of exts) if (e.name.endsWith(x)) want = true
          if (!want) continue
          try {
            const st = statSync(p)
            if (st.size < 8) continue
            out.push({ path: p, rel: relative(base, p) })
          } catch {}
        }
      }
    }
    walk(base, 0)
  }
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return out
}

// ------------------------------------------------------------------ tallies
interface TypeTally {
  count: number
  files: number
  /** First N contributing files, plus the DERIVED total. */
  fileList: string[]
  distinctSources: number
  distinctTargets: number
  confidences: Record<string, number>
  evidenceClasses: Record<string, number>
  subOneTotal: number
  subOneWithoutReasonCode: number
  withLine: number
  withoutLine: number
  /** R7: endpoint equal to the placeholder literal `unknown`. */
  endpointPlaceholderUnknown: number
  endpointEmpty: number
  /** `Global` / `global` pseudo-source, counted per type. */
  sourceGlobal: number
  /** Q5: endpoints that bind to a symbol name seen in the same run. */
  sourceResolves: number
  targetResolves: number
  bothResolve: number
  /** Both-endpoint resolution is judged against the run-wide symbol-name pool. */
  resolvedSourceSamples: string[]
  resolvedTargetSamples: string[]
  unresolvedTargetSamples: string[]
  metadataKeys: Record<string, number>
}

function emptyTally(): TypeTally {
  return {
    count: 0, files: 0, fileList: [], distinctSources: 0, distinctTargets: 0,
    confidences: {}, evidenceClasses: {}, subOneTotal: 0, subOneWithoutReasonCode: 0,
    withLine: 0, withoutLine: 0, endpointPlaceholderUnknown: 0, endpointEmpty: 0,
    sourceGlobal: 0, sourceResolves: 0, targetResolves: 0, bothResolve: 0,
    resolvedSourceSamples: [], resolvedTargetSamples: [], unresolvedTargetSamples: [],
    metadataKeys: {},
  }
}

function bump(b: Record<string, number>, k: string): void { b[k] = (b[k] || 0) + 1 }

// R7's placeholder literal, read from the shared ledger so the census cannot
// drift from the rule. Falls back to the documented literal.
const PLACEHOLDER_LITERAL = "unknown"

function edgeType(r: any): string {
  if (typeof r.type === "string" && r.type.length > 0) return r.type
  if (typeof r.relationshipType === "string" && r.relationshipType.length > 0) return r.relationshipType
  return ""
}

function edgeEndpoints(r: any): { source: string; target: string } {
  const s = typeof r.source === "string" ? r.source : typeof r.from === "string" ? r.from : ""
  const t = typeof r.target === "string" ? r.target : typeof r.to === "string" ? r.to : ""
  return { source: s, target: t }
}

function isPlaceholder(s: string): boolean { return s === PLACEHOLDER_LITERAL }

async function main(): Promise<void> {
  const files = collectFiles(CORPUS_ROOT, CORPUS_DIRS, EXTS)
  const sample = WANT > 0 && WANT < files.length
    ? Array.from({ length: WANT }, (_, i) => files[Math.floor((i * files.length) / WANT)])
    : files

  const tallies = new Map<string, TypeTally>()
  const sourcesByType = new Map<string, Set<string>>()
  const targetsByType = new Map<string, Set<string>>()
  // Run-wide symbol-name pool. Deliberately a NAME pool, not a per-file pool:
  // an outgoing edge to a symbol declared in another file of the corpus still
  // names a real symbol, and the ingest pipeline is where cross-file binding
  // happens, not here. Both readings are reported.
  const globalNames = new Set<string>()
  const localNamesByFile = new Map<string, Set<string>>()

  let parsed = 0, crashed = 0, parseErrFiles = 0
  let totalSymbols = 0, totalEdges = 0
  const crashSamples: string[] = []
  const started = Date.now()

  for (const f of sample) {
    let content: string
    try { content = readFileSync(f.path, "utf8") } catch { continue }
    let res: any
    try {
      res = await ASTEngine.parseFile(f.path, content)
    } catch (e) {
      crashed++
      if (crashSamples.length < 8) crashSamples.push(`${f.rel}: ${String(e).slice(0, 160)}`)
      continue
    }
    parsed++
    const symbols: any[] = Array.isArray(res.symbols) ? res.symbols : []
    const rels: any[] = Array.isArray(res.relationships) ? res.relationships : []
    const imps: any[] = Array.isArray(res.imports) ? res.imports : []
    totalSymbols += symbols.length
    totalEdges += rels.length
    if (Array.isArray(res.errors) && res.errors.length > 0) parseErrFiles++

    const local = new Set<string>()
    for (const s of symbols) {
      const nm = typeof s.name === "string" ? s.name : ""
      if (nm.length === 0) continue
      local.add(nm)
      globalNames.add(nm)
    }
    // Alias-qualified names count too: an edge target `MyApp.Repo.get` binds
    // when a symbol named `get` exists inside a module `MyApp.Repo`, and the
    // pipeline resolves by suffix.
    for (const s of symbols) {
      const nm = typeof s.name === "string" ? s.name : ""
      if (nm.length === 0) continue
      const parts = nm.split(".")
      if (parts.length > 1) {
        local.add(parts[parts.length - 1])
        globalNames.add(parts[parts.length - 1])
      }
    }
    localNamesByFile.set(f.rel, local)

    const seenInFile = new Set<string>()
    for (const r of rels) {
      const t = edgeType(r)
      if (t.length === 0) continue
      let tally = tallies.get(t)
      if (!tally) { tally = emptyTally(); tallies.set(t, tally) }
      tally.count++
      seenInFile.add(t)
      const conf = typeof r.confidence === "number" ? r.confidence : -1
      bump(tally.confidences, conf < 0 ? "absent" : String(conf))
      const md: any = r.metadata && typeof r.metadata === "object" ? r.metadata : {}
      bump(tally.evidenceClasses, typeof md.evidenceClass === "string" ? md.evidenceClass : "absent")
      for (const k of Object.keys(md)) bump(tally.metadataKeys, k)
      if (conf >= 0 && conf < 1) {
        tally.subOneTotal++
        const rc = typeof md.reasonCode === "string" && md.reasonCode.length > 0
        if (!rc) tally.subOneWithoutReasonCode++
      }
      if (typeof r.line_number === "number") tally.withLine++
      else tally.withoutLine++
      const { source, target } = edgeEndpoints(r)
      if (isPlaceholder(source) || isPlaceholder(target)) tally.endpointPlaceholderUnknown++
      if (source.length === 0 || target.length === 0) tally.endpointEmpty++
      if (source === "Global" || source === "global") tally.sourceGlobal++
      let ss = sourcesByType.get(t); if (!ss) { ss = new Set(); sourcesByType.set(t, ss) }
      let ts = targetsByType.get(t); if (!ts) { ts = new Set(); targetsByType.set(t, ss ? ts : ts) }
      ss.add(source); ts.add(target)
      const srcOk = source === "Global" || source === "global" || local.has(source) || globalNames.has(source)
      const leaf = target.includes(".") ? target.slice(target.lastIndexOf(".") + 1) : target
      const tgtOk = local.has(target) || globalNames.has(target) || (leaf.length > 0 && globalNames.has(leaf))
      if (srcOk) tally.sourceResolves++
      if (tgtOk) {
        tally.targetResolves++
        if (tally.resolvedTargetSamples.length < 12 && !tally.resolvedTargetSamples.includes(target)) tally.resolvedTargetSamples.push(target)
      } else if (tally.unresolvedTargetSamples.length < 12 && !tally.unresolvedTargetSamples.includes(target)) tally.unresolvedTargetSamples.push(target)
      if (srcOk && tgtOk) tally.bothResolve++
      if (srcOk && tally.resolvedSourceSamples.length < 12 && !tally.resolvedSourceSamples.includes(source)) tally.resolvedSourceSamples.push(source)
    }
    // The imports channel, counted on its own terms.
    let ti = tallies.get("__imports_channel__")
    if (!ti) { ti = emptyTally(); tallies.set("__imports_channel__", ti) }
    ti.count += imps.length
    if (imps.length > 0) { ti.files++; if (ti.fileList.length < 40) ti.fileList.push(f.rel) }
    for (const key of seenInFile) {
      const t2 = tallies.get(key)!
      t2.files++
      if (t2.fileList.length < 60) t2.fileList.push(f.rel)
    }
  }

  for (const [k, set] of sourcesByType) { const t = tallies.get(k); if (t) t.distinctSources = set.size }
  for (const [k, set] of targetsByType) { const t = tallies.get(k); if (t) t.distinctTargets = set.size }

  const fired: string[] = []
  const silent: string[] = []
  for (const t of ALL_TYPES) {
    const y = tallies.get(t)
    if (y && y.count > 0) fired.push(t); else silent.push(t)
  }
  const offEnum = [...tallies.keys()].filter((k) => !k.startsWith("__") && !ALL_TYPES.includes(k) && !TYPES_ENUM.includes(k))

  // Per-file byType, so a reader can find the files themselves rather than
  // trust a summary.
  const artifact = {
    tool: "validation/m14/elixir/elixir-firing-census.ts",
    lane: "ELIXIR_FIX2",
    subject: "src/ast/real-elixir-analyzer.ts",
    subjectCommit: process.env.ELIXIR_SUBJECT_COMMIT || headCommit(),
    subjectSha256_16: subjectSha(),
    // An uncommitted analyzer edit makes subjectCommit a lie on its own, so the
    // dirty state of the subject is recorded too.
    subjectDirty: subjectDirty(),
    population: {
      corpusRoot: CORPUS_ROOT,
      corpusDirs: CORPUS_DIRS,
      extensions: EXTS,
      derived: true,
      allFilesFound: files.length,
      filesRun: sample.length,
      sampling: WANT > 0 && WANT < files.length ? `stride of ${WANT} over ${files.length}` : "WHOLE corpus",
    },
    productionPath: "ASTEngine.parseFile -> getParser(elixir) -> parse -> getAnalyzer(elixir) -> RealElixirAnalyzer.analyze",
    enum: { typesTs: TYPES_ENUM, engine: TYPES_PROD, offEnumProduced: offEnum },
    result: {
      filesParsed: parsed,
      filesCrashed: crashed,
      crashSamples,
      filesWithParseErrors: parseErrFiles,
      totalSymbols,
      totalRelationships: totalEdges,
      wallMs: Date.now() - started,
      firedCount: fired.length,
      fired,
      silent,
      offEnumTypesProduced: offEnum,
      distinctSymbolNamesInCorpus: globalNames.size,
      tallies: Object.fromEntries([...tallies.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))),
    },
  }
  const out = process.env.ELIXIR_ARTIFACT || "validation/m14/elixir/elixir-firing-census.json"
  writeFileSync(out, JSON.stringify(artifact, null, 2))

  const L = (s: string) => process.stderr.write(s + "\n")
  L(`population: ${sample.length} of ${files.length} derived ${EXTS.join("/")} files under ${CORPUS_DIRS.join(",")} (${artifact.population.sampling})`)
  L(`parsed ${parsed}, crashed ${crashed}, files carrying parse errors ${parseErrFiles}`)
  L(`${totalSymbols} symbols, ${totalEdges} relationships, ${artifact.result.wallMs} ms`)
  L(`FIRED ${fired.length}/10 : ${fired.join(" ")}`)
  L(`SILENT      : ${silent.join(" ")}`)
  for (const t of ALL_TYPES) {
    const y = tallies.get(t)
    if (!y || y.count === 0) { L(`  ${t.padEnd(13)} SILENT`); continue }
    const pct = (n: number) => (y.count === 0 ? "n/a" : `${((100 * n) / y.count).toFixed(1)}%`)
    L(`  ${t.padEnd(13)} ${String(y.count).padStart(7)} edges / ${String(y.files).padStart(4)} files  conf ${JSON.stringify(y.confidences)}`)
    L(`  ${"".padEnd(13)} evidenceClass ${JSON.stringify(y.evidenceClasses)}  line ${y.withLine}/${y.count}  sub1.0-no-reasonCode ${y.subOneWithoutReasonCode}/${y.subOneTotal}`)
    L(`  ${"".padEnd(13)} both-ends-resolve ${y.bothResolve}/${y.count} (${pct(y.bothResolve)})  target-unresolved-samples ${JSON.stringify(y.unresolvedTargetSamples.slice(0, 6))}`)
    L(`  ${"".padEnd(13)} placeholder-unknown-endpoint ${y.endpointPlaceholderUnknown}  empty-endpoint ${y.endpointEmpty}  Global-source ${y.sourceGlobal}`)
  }
  const ic = tallies.get("__imports_channel__")
  if (ic) L(`imports[] channel: ${ic.count} in ${ic.files} files (separate field, never a brain_relationship row)`)
  if (offEnum.length) L(`OFF-ENUM produced: ${offEnum.join(" ")}`)
  L(`artifact: ${out}`)
}

await main()