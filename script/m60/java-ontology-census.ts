/**
 * JAVA ONTOLOGY CENSUS — the per-type EMITTED measurement the ontology workstream
 * demands: production `parseFile`, a COUNT, and the FILES.
 *
 * ## Why it reads `parseFile` and not `analyze`
 *
 * `analyze` is the analyzer; `parseFile` is what a user gets. Between them sit
 * engine-level passes (`filterNoiseRelationships`, the 1 MB structural-fallback
 * cliff, the encoding decode). A type measured on `analyze` can read as present
 * and be dead in production — the failure mode bash's #277 records, where the
 * analyzer emitted 23 import edges and the production path delivered 2. So every
 * count below is what `parseFile` returned.
 *
 * ## Why the corpus is SHARDED
 *
 * `ASTEngine.parseFile` arms a 120 s self-destruct timer around the synchronous
 * `parser.parse()` (engine.ts:1409) and calls `process.exit(1)` when it fires.
 * That timer is wall-time armed on an event loop this harness shares across N
 * workers, so at high concurrency over 3,275 files the loop can be starved long
 * enough to trip a timer for a file that parses in 14 ms on its own (measured:
 * `FilteredMapTest.java`, 963 B, 14 ms standalone under BOTH grammars). The
 * instrument must not lose the corpus to its own concurrency, so the file set is
 * cut into fixed shards and one shard is one process. A shard that dies is
 * re-runnable in isolation and the loss is visible rather than silent.
 *
 * ## Three modes, one table
 *
 *   # one shard's raw edges + per-file symbol namespace
 *   npx tsx script/m60/java-ontology-census.ts --shard=0/11 validation/m60/results/java-ontology-shards/s0.json
 *   # whole corpus in one process (small corpora, fixture runs)
 *   npx tsx script/m60/java-ontology-census.ts validation/m60/results/java-ontology-census.json
 *   # concatenate shards and print the adjudicated table — no second corpus scan
 *   npx tsx script/m60/java-ontology-census.ts --merge validation/m60/results/java-ontology-census.json
 *
 * `buildReport` is exported so a second consumer cannot grow a second, disagreeing
 * table from the same artifact.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

/**
 * The ontology's ten types, in the SERIALISED spelling an ANALYZER emits.
 *
 * Two spellings of the import label exist in this repository and they are not the
 * same thing. `src/ast/types.ts:69` declares `Imports = "brain_import"`, which is
 * also the name of the `brain_import` TABLE. `src/ast/engine.ts:454` — the
 * namespace every analyzer imports as `ASTEngine.RelationshipType` — declares
 * `Imports = "imports"`. An analyzer therefore emits the string `"imports"`, and a
 * census that watches only `"brain_import"` measures a permanent, silent zero for
 * every lane that has closed this gap. Both are listed here and folded to one row,
 * so the row is right whichever spelling a future change adopts.
 */
export const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
export type Wire = (typeof ALL_TYPES)[number]

/** Wire spellings folded onto one ontology row, in the order they are matched. */
const WIRE_ALIASES: Record<string, Wire> = {
  imports: "imports",
  brain_import: "imports",
}
export function wireOf(v: string): Wire | null {
  const t = WIRE_ALIASES[v] ?? v
  return (ALL_TYPES as readonly string[]).includes(t) ? (t as Wire) : null
}

/** The ontology gate's own spelling, so the two tables read side by side. */
export const GATE_NAME: Record<Wire, string> = {
  calls: "calls", uses: "uses", contains: "contains", imports: "imports",
  references: "references", exports: "exports", extends: "extends",
  implements: "implements", overrides: "overrides", instantiates: "instantiates",
}

export type Edge = {
  wire: Wire
  file: string
  source: string
  target: string
  confidence: number
  evidenceClass: string
  metaRelType: string
  line?: number
}
export type PerFile = {
  file: string; symbols: number; rels: number; imports: number
  exports: number; errors: number; fallback: boolean
}
export type Totals = {
  symbols: number; importInfo: number; exportInfo: number
  errorNodes: number; ontologyEdges: number
}

/* ---------------------------------------------------------------- corpus */
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (process.env.BB_JAVA_REPOS ?? "java-lib,java-sample").split(",").map((s) => s.trim()).filter(Boolean)
/** Workers in ONE process — a correctness knob here, not a throughput knob. */
const CONCURRENCY = Number(process.env.BB_JAVA_CENSUS_WORKERS ?? "3")
const SHARD_DIR = path.join("validation", "m60", "results", "java-ontology-shards")

function trackedJavaFiles(): { files: Array<{ repo: string; dir: string; rel: string; abs: string }>; revisions: Record<string, string> } {
  const files: Array<{ repo: string; dir: string; rel: string; abs: string }> = []
  const revisions: Record<string, string> = {}
  for (const repo of REPOS) {
    const dir = path.join(CR, repo)
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.java"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
      revisions[repo] = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
      files.push({ repo, dir, rel, abs })
    }
  }
  // Deterministic order at the pinned revision, so a re-run measures the same set.
  files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : a.repo + a.rel > b.repo + b.rel ? 1 : 0))
  return { files, revisions }
}

/* ---------------------------------------------------------------- report */
export function buildReport(edges: Edge[], symbolNames: Set<string>) {
  /* Q2 — fires: does a branch that can never match still show up as 0 here? */
  const rows = ALL_TYPES.map((wire) => {
    const mine = edges.filter((e) => e.wire === wire)
    const fileSet = new Set(mine.map((e) => e.file))
    const confidence: Record<string, number> = {}
    const evidenceClass: Record<string, number> = {}
    const metaRelationshipType: Record<string, number> = {}
    const perRepo: Record<string, number> = {}
    let below07 = 0, unlined = 0, emptySource = 0, emptyTarget = 0
    for (const e of mine) {
      const ck = String(e.confidence)
      confidence[ck] = (confidence[ck] ?? 0) + 1
      if (e.confidence < 0.7) below07++
      evidenceClass[e.evidenceClass] = (evidenceClass[e.evidenceClass] ?? 0) + 1
      metaRelationshipType[e.metaRelType] = (metaRelationshipType[e.metaRelType] ?? 0) + 1
      const repo = e.file.split("/")[0]
      perRepo[repo] = (perRepo[repo] ?? 0) + 1
      if (e.line === undefined) unlined++
      if (!e.source.trim()) emptySource++
      if (!e.target.trim()) emptyTarget++
    }
    return {
      wire, gateName: GATE_NAME[wire],
      edges: mine.length, files: fileSet.size,
      filesWithType: [...fileSet].sort().slice(0, 8),
      perRepo, confidence, below07, evidenceClass, metaRelationshipType,
      unlined, emptySource, emptyTarget,
    }
  })

  /* Q5 — resolved. An endpoint RESOLVES when its LEAF names a symbol the corpus
     declares. Java endpoints carry signatures (`run(java.util.List)`) and
     qualifications (`java.util.List`), so the comparison strips the argument
     list and takes the last dot segment — the same standard the CSS 66.8% figure
     is quoted against, and the strongest available without a type checker.
     Both-ends is the figure the workstream asks for; neither-ends is listed
     separately because that is where a fabricated edge would live. */
  const leafOf = (v: string): string => {
    const cut = v.indexOf("(")
    const base = cut === -1 ? v : v.slice(0, cut)
    const parts = base.split(".")
    return parts[parts.length - 1] ?? base
  }
  const resolution = ALL_TYPES.map((wire) => {
    const mine = edges.filter((e) => e.wire === wire)
    if (!mine.length) return { wire, n: 0 }
    let both = 0, sourceOnly = 0, targetOnly = 0, neitherEnds = 0
    const unresolvedTargets: Record<string, number> = {}
    const unresolvedSources: Record<string, number> = {}
    for (const e of mine) {
      const sl = leafOf(e.source), gl = leafOf(e.target)
      const sok = !!sl.trim() && symbolNames.has(sl)
      const gok = !!gl.trim() && symbolNames.has(gl)
      if (sok && gok) both++
      else if (sok) sourceOnly++
      else if (gok) targetOnly++
      else {
        neitherEnds++
        unresolvedTargets[gl] = (unresolvedTargets[gl] ?? 0) + 1
        unresolvedSources[sl] = (unresolvedSources[sl] ?? 0) + 1
      }
    }
    const pct = (n: number) => +((100 * n) / mine.length).toFixed(1)
    const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 12)
    return {
      wire, n: mine.length,
      bothEnds: both, bothEndsPct: pct(both),
      sourceOnly, targetOnly, neitherEnds, neitherEndsPct: pct(neitherEnds),
      topUnresolvedTargets: top(unresolvedTargets),
      topUnresolvedSources: top(unresolvedSources),
    }
  })

  /* Q6 / R7 — hygiene. Standing rule R7: no unknown symbol, no empty name, no
     placeholder literal as an edge endpoint. The placeholder list is the family
     list — a string a consumer would read as a real target and the analyzer
     invented. */
  const PLACEHOLDERS = ["", "global", "root", "unknown", "(expr)", "self", "<unknown>", "undefined", "null"]
  const hygiene = ALL_TYPES.map((wire) => {
    const mine = edges.filter((e) => e.wire === wire)
    const placeholderEndpoints: Record<string, number> = {}
    let emptyEndpoint = 0
    for (const e of mine) {
      for (const [side, v] of [["source", e.source], ["target", e.target]] as const) {
        const k = v.trim()
        if (!k) { emptyEndpoint++; continue }
        if (PLACEHOLDERS.includes(k)) placeholderEndpoints[`${side}=${JSON.stringify(k)}`] = (placeholderEndpoints[`${side}=${JSON.stringify(k)}`] ?? 0) + 1
      }
    }
    return { wire, n: mine.length, emptyEndpoint, placeholderEndpoints }
  })

  return { rows, resolution, hygiene }
}

/**
 * Q4/Q5 — what an endpoint resolves TO, not merely whether it resolves.
 *
 * Java's labels do not agree on what a `source` is. A `contains` edge's source
 * is an owner TYPE; a `declared_type` `references` edge's source is the owning
 * TYPE; a `cast_target` `references` edge's source is `parentContext.name` at the
 * cast, and a method declaration pushes a scope NAMED AFTER THE METHOD, so that
 * edge's source is a METHOD. Both ship under one label, so a per-type
 * both-ends percentage silently mixes two populations. This measures the split.
 *
 * The kind set is the union over the whole corpus, because a name can be declared
 * as both a type and a field; a hit on either kind counts as resolved.
 */
export function endpointKindBreakdown(edges: Edge[], kindsByName: Map<string, Set<string>>) {
  const leafOf = (v: string): string => {
    const cut = v.indexOf("(")
    const base = cut === -1 ? v : v.slice(0, cut)
    const parts = base.split(".")
    return parts[parts.length - 1] ?? base
  }
  const shape = (kinds?: Set<string>): string => {
    if (!kinds || kinds.size === 0) return "UNRESOLVED"
    return [...kinds].sort().join("+")
  }
  const out: Array<Record<string, unknown>> = []
  for (const wire of ALL_TYPES) {
    const mine = edges.filter((e) => e.wire === wire)
    if (!mine.length) { out.push({ wire, n: 0 }); continue }
    const srcKinds: Record<string, number> = {}
    const tgtKinds: Record<string, number> = {}
    const metaKinds: Record<string, number> = {}
    for (const e of mine) {
      const sk = shape(kindsByName.get(leafOf(e.source)))
      const tk = shape(kindsByName.get(leafOf(e.target)))
      srcKinds[sk] = (srcKinds[sk] ?? 0) + 1
      tgtKinds[tk] = (tgtKinds[tk] ?? 0) + 1
      const mk = `${sk} -> ${tk}`
      metaKinds[mk] = (metaKinds[mk] ?? 0) + 1
    }
    out.push({ wire, n: mine.length, sourceKind: srcKinds, targetKind: tgtKinds, shape: metaKinds })
  }
  return out
}

export function printReport(input: {
  edges: Edge[]; symbolNames: Set<string>; totals: Totals; perFile: PerFile[]
  corpus: { repos: string[]; revisions: Record<string, string>; trackedJavaFiles: number; measuredFiles: number; parseFail: number; fallback: number }
  shards?: string[]
  endpointKinds?: Array<Record<string, unknown>>
}) {
  const { edges, symbolNames, totals, perFile, corpus } = input
  const { rows, resolution, hygiene } = buildReport(edges, symbolNames)
  const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
  console.log(`java ontology census — corpus ${corpus.measuredFiles} files of ${corpus.trackedJavaFiles} tracked across ${corpus.repos.join(", ")}`)
  console.log(`revisions: ${JSON.stringify(corpus.revisions)}`)
  if (input.shards) console.log(`shards merged: ${input.shards.length}`)
  console.log(`parse failures ${corpus.parseFail}; structural fallback (parseFile returned a fallback) ${corpus.fallback}`)
  console.log(`symbols ${totals.symbols}; ImportInfo ${totals.importInfo}; ExportInfo ${totals.exportInfo}; ERROR/MISSING nodes ${totals.errorNodes}; relationships (10 ontology types) ${totals.ontologyEdges}`)
  console.log("")
  console.log(`${w("type", 13)}${w("wire", 14)}${w("edges", 10)}${w("files", 8)}${w("<0.7", 7)}${w("unlined", 9)}evidenceClass`)
  console.log("-".repeat(120))
  for (const r of rows) {
    console.log(`${w(GATE_NAME[r.wire], 13)}${w(r.wire, 14)}${w(String(r.edges), 10)}${w(String(r.files), 8)}${w(String(r.below07), 7)}${w(String(r.unlined), 9)}${JSON.stringify(r.evidenceClass)}`)
  }
  console.log("")
  console.log(`${w("type", 13)}${w("both-ends", 11)}${w("bothPct", 9)}${w("neither", 9)}${w("neitherPct", 11)}top unresolved targets`)
  console.log("-".repeat(120))
  for (const r of resolution) {
    if (!r.n) { console.log(`${w(String(r.wire), 13)}0`); continue }
    console.log(`${w(String(r.wire), 13)}${w(String(r.bothEnds), 11)}${w(String(r.bothEndsPct) + "%", 9)}${w(String(r.neitherEnds), 9)}${w(String(r.neitherEndsPct) + "%", 11)}${JSON.stringify((r.topUnresolvedTargets as any[]).slice(0, 5))}`)
  }
  console.log("")
  console.log("R7 hygiene — placeholder-literal or empty edge endpoints")
  for (const h of hygiene) console.log(`  ${String(h.wire).padEnd(14)} n=${String(h.n).padEnd(8)} empty=${h.emptyEndpoint}  placeholders=${JSON.stringify(h.placeholderEndpoints)}`)
  if (input.endpointKinds) {
    console.log("")
    console.log(`${w("type", 14)}source endpoint kind  (a method-named source and a type-named source are different claims under one label)`)
    console.log("-".repeat(120))
    for (const r of input.endpointKinds) {
      if (!r.n) continue
      console.log(`${w(String(r.wire), 14)}${JSON.stringify(r.sourceKind)}`)
    }
  }
  const artifact = {
    tool: "script/m60/java-ontology-census.ts",
    corpus, totals, rows, resolution, hygiene, edges, perFile,
    ...(input.endpointKinds ? { endpointKinds: input.endpointKinds } : {}),
  }
  return artifact
}

/* ---------------------------------------------------------------- CLI */
const argv = process.argv.slice(2)
const isMerge = argv.includes("--merge")
const outPath = argv.find((a) => !a.startsWith("--") && !/^\d+\/\d+$/.test(a)) ?? ""
const shardRaw = argv.find((a) => a.startsWith("--shard="))?.slice("--shard=".length)
  ?? (argv.find((a) => /^\d+\/\d+$/.test(a)) ?? "")

if (isMerge) {
  if (!outPath) { console.error("--merge needs the artifact path to write"); process.exit(2) }
  const names = readdirSync(SHARD_DIR).filter((n) => n.endsWith(".json")).sort()
  const edges: Edge[] = []
  const perFile: PerFile[] = []
  const symbolNames = new Set<string>()
  const totals: Totals = { symbols: 0, importInfo: 0, exportInfo: 0, errorNodes: 0, ontologyEdges: 0 }
  let revisions: Record<string, string> = {}
  let trackedJavaFiles = 0
  let measuredFiles = 0
  let parseFail = 0
  let fallback = 0
  const kindsByName = new Map<string, Set<string>>()
  for (const n of names) {
    const d = JSON.parse(readFileSync(path.join(SHARD_DIR, n), "utf8"))
    edges.push(...(d.edges ?? []))
    perFile.push(...(d.perFile ?? []))
    for (const packed of d.symbolNames ?? []) {
      const [nm, kd] = String(packed).split("\u0000")
      if (!nm) continue
      symbolNames.add(nm)
      const set = kindsByName.get(nm) ?? new Set<string>()
      set.add(kd ?? "?")
      kindsByName.set(nm, set)
    }
    totals.symbols += d.totals?.symbols ?? 0
    totals.importInfo += d.totals?.importInfo ?? 0
    totals.exportInfo += d.totals?.exportInfo ?? 0
    totals.errorNodes += d.totals?.errorNodes ?? 0
    totals.ontologyEdges += d.totals?.ontologyEdges ?? 0
    revisions = { ...revisions, ...(d.corpus?.revisions ?? {}) }
    trackedJavaFiles = d.corpus?.trackedJavaFiles ?? trackedJavaFiles
    measuredFiles += d.corpus?.measuredFiles ?? 0
    parseFail += d.corpus?.parseFail ?? 0
    fallback += d.corpus?.fallback ?? 0
  }
  // The symbol namespace is the UNION over shards, so it is corpus-wide: a java
  // type is declared in one file and referenced in another, and a shard-local
  // namespace would understate resolution for every cross-file edge.
  const endpointKinds = endpointKindBreakdown(edges, kindsByName)
  const artifact = printReport({
    edges, symbolNames, totals, perFile,
    corpus: { repos: REPOS, revisions, trackedJavaFiles, measuredFiles, parseFail, fallback },
    shards: names,
    endpointKinds,
  })
  writeFileSync(outPath, JSON.stringify(artifact, null, 0))
  console.log(`\nwrote ${outPath} (${edges.length} edges)`)
  process.exit(0)
}

/* -------------------------------------------------------------- shard run */
let shard: { i: number; n: number } | null = null
if (shardRaw) {
  const [i, n] = shardRaw.split("/").map(Number)
  if (!Number.isInteger(i) || !Number.isInteger(n) || n <= 0 || i < 0 || i >= n) {
    console.error(`--shard must be i/n with 0 <= i < n, got ${shardRaw}`)
    process.exit(2)
  }
  shard = { i, n }
}

const { files, revisions } = trackedJavaFiles()
const corpus = shard ? files.filter((_, k) => k % shard.n === shard.i) : files

const edges: Edge[] = []
const perFile: PerFile[] = []
const symbolNames = new Set<string>()
const totals: Totals = { symbols: 0, importInfo: 0, exportInfo: 0, errorNodes: 0, ontologyEdges: 0 }
let parseFail = 0
let fallback = 0
let cursor = 0

async function worker() {
  for (;;) {
    const i = cursor++
    if (i >= corpus.length) return
    const f = corpus[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFail++; continue }
    const label = `${f.repo}/${f.rel}`
    const rels: any[] = Array.isArray(r.relationships) ? r.relationships : []
    for (const x of rels) {
      const wire = wireOf(String(x.type ?? x.relationshipType ?? ""))
      if (!wire) continue
      edges.push({
        wire,
        file: label,
        source: String(x.source ?? x.from ?? x.fromSymbol ?? ""),
        target: String(x.target ?? x.to ?? x.toSymbol ?? ""),
        confidence: typeof x.confidence === "number" ? x.confidence : 1,
        evidenceClass: String((x.metadata ?? {}).evidenceClass ?? "(none)"),
        metaRelType: String((x.metadata ?? {}).relationshipType ?? "(none)"),
        line: typeof x.line_number === "number" ? x.line_number : undefined,
      })
    }
    const syms: any[] = Array.isArray(r.symbols) ? r.symbols : []
    const names: string[] = []
    for (const s of syms) {
      if (typeof s?.name !== "string" || !s.name.trim()) continue
      symbolNames.add(s.name)
      // kind is recorded so Q4/Q5 can ask not just "does this endpoint resolve"
      // but "to WHAT is it resolving" — a `references` edge whose source is a
      // method is a different claim from one whose source is a type, and the
      // two must not be counted as one population.
      names.push(`${s.name}\u0000${String(s.kind ?? "?")}`)
    }
    const errs = Array.isArray(r.errors) ? r.errors.length : 0
    totals.symbols += syms.length
    totals.importInfo += Array.isArray(r.imports) ? r.imports.length : 0
    totals.exportInfo += Array.isArray(r.exports) ? r.exports.length : 0
    totals.errorNodes += errs
    totals.ontologyEdges += rels.length
    if (r.fallback) fallback++
    perFile.push({
      file: label, symbols: syms.length, rels: rels.length,
      imports: Array.isArray(r.imports) ? r.imports.length : 0,
      exports: Array.isArray(r.exports) ? r.exports.length : 0,
      errors: errs, fallback: !!r.fallback, symbolNames: names,
    } as PerFile & { symbolNames: string[] })
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

const shardMeta = {
  repos: REPOS, revisions, trackedJavaFiles: files.length,
  measuredFiles: corpus.length, parseFail, fallback,
}

if (shard) {
  if (!outPath) { console.error("a shard needs its artifact path: --shard=i/n <out.json>"); process.exit(2) }
  writeFileSync(outPath, JSON.stringify({
    tool: "script/m60/java-ontology-census.ts",
    shard: `${shard.i}/${shard.n}`,
    corpus: shardMeta,
    totals,
    edges,
    perFile: perFile.map(({ file, symbols, rels, imports, exports, errors, fallback }) => ({ file, symbols, rels, imports, exports, errors, fallback })),
    // `name\u0000kind`, so the merge can answer "resolves to WHAT" and not only
    // "resolves". The plain-name set is kept alongside it for the resolution pass.
    symbolNames: [...new Set(perFile.flatMap((p: any) => p.symbolNames ?? []))],
    namesOnly: [...symbolNames],
  }, null, 0))
  console.log(`java ontology census shard ${shard.i}/${shard.n} — ${corpus.length} files, ${edges.length} ontology edges, parse failures ${parseFail}, fallback ${fallback}`)
  console.log(`wrote ${outPath}`)
  process.exit(0)
}

const artifact = printReport({ edges, symbolNames, totals, perFile, corpus: shardMeta })
if (outPath) {
  writeFileSync(outPath, JSON.stringify(artifact, null, 0))
  console.log(`\nwrote ${outPath} (${edges.length} edges)`)
}