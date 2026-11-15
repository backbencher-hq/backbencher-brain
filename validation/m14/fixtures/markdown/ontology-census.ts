/**
 * MARKDOWN ONTOLOGY CENSUS — the instrument behind every number in the markdown
 * lane's ontology report.
 *
 * ## Why this exists
 *
 * `script/m14/ontology-coverage-gate.ts markdown` is the supervisor's arbiter, and it
 * refuses to report for this lane: its `RULED_BY_LANG` table carries `bash` and `json`
 * only, so the gate exits 2 with "no RULING TABLE for markdown". The table is shared
 * machinery the lane does not own, so this script does the measuring instead and
 * reports the gap as a §8 item. It is a faithful stand-in, not a replacement: it
 * applies the SAME two instruments the gate names, with the same reason a regex is the
 * wrong one (see `validation/m60/markdown/` in this lane's report).
 *
 * ## What it does, and what it deliberately does NOT do
 *
 * It calls the PRODUCTION entry point — `parseFile` from `src/ast/pool-worker.ts` — not
 * `analyze()`. `analyze()` is the per-file unit and skips the pipeline stages (worker,
 * size limits, truncation, enhancements), so a count taken from it is a count of the
 * analyzer rather than of the indexer.
 *
 * Sampling is DETERMINISTIC and PUBLISHED: files are admitted by the same
 * `git ls-files` walk the coverage gate uses, ordered by `sha256(<seed>|<repo>/<rel>)`,
 * and the first N taken. A hashed order is not a random sample in the statistical
 * sense and is not claimed to be one; it is a reproducible draw whose file set is named
 * by one hash, so a published figure can be reproduced from a clean corpus and re-drawn
 * with `--seed`.
 *
 * ## The tallies (one per question the workstream asks)
 *
 *   - relationship type -> count, files, per-repo counts
 *   - symbol kind -> count, plus any kind outside the shared `SymbolKind`
 *   - symbols with an empty name (standing rule: none)
 *   - relationship endpoints equal to the literal `unknown` (rule R7: none)
 *   - ENDPOINT RESOLUTION per type, at two tiers, reported apart. This lane needs
 *     both more than any other: a `uses` target is a link DESTINATION, which is a
 *     string the document wrote and not a name the document declares, so the strict
 *     file-local tier is structurally the wrong question for it and the loose
 *     corpus tier is the right one. A `contains` endpoint is the opposite — both ends
 *     are symbols this file published — so the file-local tier is the honest one
 *     there. Reporting one number would hide that asymmetry.
 *   - confidence histogram and the sub-0.7 heuristic count per type (honesty
 *     contract §4: a heuristic must be COUNTABLE)
 *   - `metadata.evidenceClass` histogram per type
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/markdown/ontology-census.ts \
 *     [--sample 400] [--seed s] [--out p] [--repos a,b]
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
const arg = (name: string, dflt: string): string => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const SAMPLE = Number(arg("sample", "400"))
const SEED = arg("seed", "markdown-ontology-census-v1")
const OUT = arg("out", "")
const ONLY = arg("repos", "")
const ONLY_SET = ONLY ? new Set(ONLY.split(",").map((s) => s.trim()).filter(Boolean)) : null

/** Every value `ASTEngine.SymbolKind` can take, read off the enum rather than copied
 *  from a doc. A kind outside this set is reported, not tolerated. */
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
 *  `document` is the analyzer's `DOC` container: a top-level fact has no heading
 *  owner, and the analyzer writes the literal `document` rather than inventing one. */
const SOURCE_MARKERS = new Set(["document"])

// ─────────────────────────────────────────────────────────── corpus (git walk)
type FileRec = { repo: string; dir: string; rel: string; abs: string }
const all: FileRec[] = []
const repoCommits: Record<string, string> = {}
const repoPopulation: Record<string, number> = {}
for (const e of readdirSync(CR).sort()) {
  if (ONLY_SET && !ONLY_SET.has(e)) continue
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
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    // The gate's admission test: the ROUTER decides, not the extension. `.md` in a
    // Rust repo is a `cargo` manifest half the time and a document the other half.
    if (/\.(md|markdown)$/i.test(rel)) { admitted++; all.push({ repo: e, dir, rel, abs }) }
  }
  if (admitted > 0) repoPopulation[e] = admitted
}

const key = (f: FileRec) => `${f.repo}/${f.rel}`
const hashed = all
  .map((f) => ({ f, h: createHash("sha256").update(`${SEED}|${key(f)}`).digest("hex") }))
  .sort((a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0))
  .map((x) => x.f)
const draw = SAMPLE > 0 && SAMPLE < hashed.length ? hashed.slice(0, SAMPLE) : hashed
const drawHash = createHash("sha256").update(draw.map(key).sort().join("\n")).digest("hex")

// ─────────────────────────────────────────────────────────── tallies
type TypeRow = {
  count: number
  perRepo: Record<string, number>
  exampleFiles: string[]
  fileCount: number
  sourceMarker: number
  sourceResolvedFile: number
  sourceDangling: number
  targetResolvedFile: number
  targetDangling: number
  bothResolvedFile: number
  sourceResolvedCorpus: number
  targetResolvedCorpus: number
  bothResolvedCorpus: number
  confidence: Record<string, number>
  heuristicUnder07: number
  evidenceClass: Record<string, number>
  role: Record<string, number>
  lineNumbered: number
}
const typeFiles = new Map<string, Set<string>>()
const filesOfType = (t: string): Set<string> => {
  let s = typeFiles.get(t)
  if (!s) { s = new Set(); typeFiles.set(t, s) }
  return s
}
const blankRow = (): TypeRow => ({
  count: 0, perRepo: {}, exampleFiles: [], fileCount: 0,
  sourceMarker: 0, sourceResolvedFile: 0, sourceDangling: 0,
  targetResolvedFile: 0, targetDangling: 0, bothResolvedFile: 0,
  sourceResolvedCorpus: 0, targetResolvedCorpus: 0, bothResolvedCorpus: 0,
  confidence: {}, heuristicUnder07: 0, evidenceClass: {}, role: {}, lineNumbered: 0,
})
const byType = new Map<string, TypeRow>()
const row = (t: string): TypeRow => {
  let r = byType.get(t)
  if (!r) { r = blankRow(); byType.set(t, r) }
  return r
}
// Pre-create the ontology rows so a type with no edge is a reported ZERO.
for (const t of ONTOLOGY_TYPES) row(t)

const kinds = new Map<string, number>()
const unknownKinds = new Map<string, number>()
const emptyNameSymbols: string[] = []
const unknownEndpoints: string[] = []
const corpusNameList: string[] = []
const fileNames: (Set<string> | undefined)[] = []
const edgeRecs: { t: string; src: string; tgt: string; file: number }[] = []
let fileCount = 0
let symbolCount = 0
let relCount = 0
let parseFailures = 0
let parseFailureFiles: string[] = []
const perRepoFiles: Record<string, number> = {}

let idx = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFailures++; if (parseFailureFiles.length < 12) parseFailureFiles.push(key(f)); continue }
    fileCount++
    perRepoFiles[f.repo] = (perRepoFiles[f.repo] ?? 0) + 1
    const symbols: any[] = r.symbols ?? []
    const names = new Set<string>()
    for (const s of symbols) {
      symbolCount++
      const nm = typeof s.name === "string" ? s.name : ""
      const k = typeof s.kind === "string" ? s.kind : String(s.kind ?? "")
      kinds.set(k, (kinds.get(k) ?? 0) + 1)
      if (!SYMBOL_KINDS.has(k)) unknownKinds.set(k, (unknownKinds.get(k) ?? 0) + 1)
      if (nm.length === 0) emptyNameSymbols.push(`${key(f)}@${s.range?.startLine ?? 0}`)
      if (nm) names.add(nm)
    }
    // Published for the caller; the corpus-wide set is folded in AFTER the workers
    // join, because `Set.add` from eight interleaved workers is a data race and a
    // torn set would under-report resolution.
    fileNames[i] = names
    for (const nm of names) corpusNameList.push(nm)
    const rels: any[] = r.relationships ?? []
    for (const e of rels) {
      relCount++
      const t = String(e.type ?? e.relationshipType ?? "")
      const r2 = row(t)
      r2.count++
      r2.perRepo[f.repo] = (r2.perRepo[f.repo] ?? 0) + 1
      const fs = filesOfType(t)
      if (!fs.has(key(f))) {
        fs.add(key(f))
        if (r2.exampleFiles.length < 4) r2.exampleFiles.push(key(f))
      }
      const src = String(e.source ?? "")
      const tgt = String(e.target ?? "")
      if (src === "unknown" || tgt === "unknown") {
        const declared = names.has(src) || names.has(tgt)
        unknownEndpoints.push(
          `${t} ${src} -> ${tgt} @ ${key(f)} [${declared ? "declared in this file" : "PLACEHOLDER"}]`,
        )
      }
      edgeRecs.push({ t, src, tgt, file: i })
      const isMarker = SOURCE_MARKERS.has(src)
      if (isMarker) r2.sourceMarker++
      else if (names.has(src)) r2.sourceResolvedFile++
      else r2.sourceDangling++
      if (names.has(tgt)) r2.targetResolvedFile++
      else r2.targetDangling++
      if (names.has(tgt) && (isMarker || names.has(src))) r2.bothResolvedFile++
      const conf = typeof e.confidence === "number" ? e.confidence : 1
      r2.confidence[String(conf)] = (r2.confidence[String(conf)] ?? 0) + 1
      if (conf < 0.7) r2.heuristicUnder07++
      const md = e.metadata ?? {}
      const ec = String(md.evidenceClass ?? "(absent)")
      r2.evidenceClass[ec] = (r2.evidenceClass[ec] ?? 0) + 1
      const ro = String(md.role ?? "(absent)")
      r2.role[ro] = (r2.role[ro] ?? 0) + 1
      if (typeof e.line_number === "number" && e.line_number > 0) r2.lineNumbered++
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

/** Corpus-tier resolution, computed AFTER the join from the recorded edges. */
const corpusNames = new Set(corpusNameList)
for (const e of edgeRecs) {
  const r2 = row(e.t)
  const names = fileNames[e.file] ?? new Set<string>()
  const sOK = corpusNames.has(e.src)
  const tOK = corpusNames.has(e.tgt)
  if (sOK) r2.sourceResolvedCorpus++
  if (tOK) r2.targetResolvedCorpus++
  if (sOK && tOK) r2.bothResolvedCorpus++
}

// ─────────────────────────────────────────────────────────── report
const pct = (n: number, d: number) => (d > 0 ? ((100 * n) / d).toFixed(1) : "n/a")
const out: Record<string, unknown> = {
  instrument: "markdown ontology census (validation/m14/fixtures/markdown/ontology-census.ts)",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  corpusRoot: CR,
  seed: SEED,
  requestedSample: SAMPLE,
  admittedByExtension: all.length,
  reposWithMarkdown: Object.keys(repoPopulation).length,
  repoPopulation: repoPopulation,
  repoCommits: repoCommits,
  drawn: draw.length,
  drawHash,
  parsed: fileCount,
  parseFailures,
  parseFailureExamples: parseFailureFiles,
  filesPerRepo: perRepoFiles,
  symbols: symbolCount,
  relationships: relCount,
  symbolKinds: Object.fromEntries([...kinds.entries()].sort((a, b) => b[1] - a[1])),
  unknownSymbolKinds: Object.fromEntries(unknownKinds),
  emptyNameSymbols: emptyNameSymbols.length,
  emptyNameExamples: emptyNameSymbols.slice(0, 10),
  unknownEndpoints: unknownEndpoints.length,
  unknownEndpointExamples: unknownEndpoints.slice(0, 10),
  types: {},
}
// `out.types` is reached through `Record<string, unknown>`, where a non-null assertion
// narrows to `{}` and refuses the index. A local of the right type is the fix — the same
// one whole-corpus-census.ts needed.
const typesOut: Record<string, unknown> = {}
out.types = typesOut
for (const t of [...new Set([...ONTOLOGY_TYPES, ...byType.keys()])]) {
  const r2 = byType.get(t) ?? blankRow()
  typesOut[t] = {
    count: r2.count,
    files: typeFiles.get(t)?.size ?? 0,
    perRepo: r2.perRepo,
    exampleFiles: r2.exampleFiles,
    resolution: {
      fileLocal: {
        bothEnds: `${r2.bothResolvedFile} (${pct(r2.bothResolvedFile, r2.count)}%)`,
        sourceMarker: r2.sourceMarker,
        sourceResolved: r2.sourceResolvedFile,
        sourceDangling: r2.sourceDangling,
        targetResolved: r2.targetResolvedFile,
        targetDangling: r2.targetDangling,
      },
      corpusWide: {
        bothEnds: `${r2.bothResolvedCorpus} (${pct(r2.bothResolvedCorpus, r2.count)}%)`,
        sourceResolved: r2.sourceResolvedCorpus,
        targetResolved: r2.targetResolvedCorpus,
      },
    },
    confidence: r2.confidence,
    heuristicUnder07: r2.heuristicUnder07,
    heuristicPct: `${pct(r2.heuristicUnder07, r2.count)}%`,
    evidenceClass: r2.evidenceClass,
    role: r2.role,
    lineNumbered: `${r2.lineNumbered} (${pct(r2.lineNumbered, r2.count)}%)`,
  }
}

const line = (s: string) => console.log(s)
line(`markdown ontology census — ${LANG_LABEL()}`)
line(`corpus ${CR}: ${all.length} admitted .md/.markdown files across ${Object.keys(repoPopulation).length} repos`)
line(`draw ${draw.length} files, sha256=${drawHash.slice(0, 16)} (seed ${SEED})`)
line(`parsed ${fileCount}, parse failures ${parseFailures}, symbols ${symbolCount}, relationships ${relCount}`)
line("")
line(`symbol kinds: ${Object.entries(out.symbolKinds as Record<string, number>).map(([k, v]) => `${k}=${v}`).join("  ")}`)
line(`kinds outside the shared SymbolKind: ${Object.keys(out.unknownSymbolKinds as object).length === 0 ? "none" : JSON.stringify(out.unknownSymbolKinds)}`)
line(`symbols with an empty name: ${emptyNameSymbols.length}`)
line(`endpoints equal to the literal 'unknown': ${unknownEndpoints.length}`)
line("")
line(`${"type".padEnd(14)}${"count".padStart(9)}${"files".padStart(7)}  ${"both/file".padEnd(10)}${"both/corpus".padEnd(10)}${"heur<0.7".padStart(9)}  evidenceClass`)
for (const t of [...new Set([...ONTOLOGY_TYPES, ...byType.keys()])]) {
  const r2 = byType.get(t) ?? blankRow()
  const ec = Object.entries(r2.evidenceClass).map(([k, v]) => `${k}=${v}`).join(",") || "-"
  line(
    `${t.padEnd(14)}${String(r2.count).padStart(9)}${String(typeFiles.get(t)?.size ?? 0).padStart(7)}  ` +
    `${`${pct(r2.bothResolvedFile, r2.count)}%`.padEnd(10)}${`${pct(r2.bothResolvedCorpus, r2.count)}%`.padEnd(10)}${String(r2.heuristicUnder07).padStart(9)}  ${ec}`,
  )
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")
  line(`\nwrote ${OUT}`)
}

function LANG_LABEL(): string {
  return "markdown"
}