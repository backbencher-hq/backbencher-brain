#!/usr/bin/env bun
/**
 * SVELTE FIRING CENSUS — "does the type actually FIRE?", measured on the
 * PRODUCTION path.
 *
 * WHY THIS EXISTS INSTEAD OF `script/m14/firing-check.mjs`.
 *
 * The shared firing check calls `getParser(lang) -> parser.parse(text) ->
 * new Cls().analyze(rootNode, content, file)` with NO `AnalyzeContext`. For
 * `.svelte` that is not the production path: the SFC seam lives in
 * `ASTEngine.parseFile`, which slices every `<script>` block out of the SFC tree
 * at its exact `raw_text` byte offsets, pre-parses each with the JS/TS grammar,
 * and hands the trees over on `context.sfcScriptTrees` /
 * `sfcScriptLines` / `sfcScriptCols` / `sfcScriptLangs`. The analyzer reads
 * NOTHING from the SFC tree about the script.
 *
 * So the shared harness, run against svelte, measures a code path the product
 * never takes: `scriptTrees` is `[]`, every script symbol is absent, and the
 * tally is a lower bound produced by an unreachable configuration. This harness
 * therefore drives `parseFile` from `src/ast/pool-worker` — the same entry the
 * ontology coverage gate and the differential use — so the number it reports is
 * the number the indexer would store.
 *
 * WHAT IT MEASURES, per relationship type:
 *   - edges actually produced (production path, real files)
 *   - how many distinct files they came from
 *   - a sample of the files, so the count is traceable to a source line
 *   - evidence-class and confidence distribution (honesty contract §4: "how
 *     much of this graph is guesswork" must be a queryable number)
 *   - R7 hygiene: empty / placeholder endpoints (rule R7 forbids shipping an
 *     edge whose endpoint is a literal placeholder)
 *
 * IT IS A DIFFERENTIAL-FREE INSTRUMENT ON PURPOSE. It never reads the analyzer
 * source and never reads the oracle; it runs the analyzer and tallies. Reading
 * either side would make it agree with a regression by construction.
 *
 * USAGE
 *   bun run script/m14/svelte-deleg-firing.mts [repo] [--limit=N] [--json=path] [--all-repos]
 *   default repo: shadcn-svelte (this lane's pinned corpus)
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { ASTEngine } from "../../src/ast/engine"
import { fileURLToPath } from "node:url"

// The enum the ANALYZERS construct from is the one re-exported by `engine.ts`
// (`ASTEngine.RelationshipType`), where `Imports` is the string "imports".
// `src/ast/types.ts` carries a SECOND enum whose `Imports` is "brain_import" —
// the SQL TABLE name. Reading the tally table from that copy reports
// `brain_import: 0` for every lane in the repository and would have called
// `imports` unfireable on evidence of nothing. Measured on
// shadcn-svelte color.svelte: the production path returns `imports` 6x.
const RelationshipType = ASTEngine.RelationshipType

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

/** The ten distinct string values of the enum (aliases collapse). */
const ALL_TYPES = [...new Set(Object.values(RelationshipType))] as string[]

const argv = process.argv.slice(2)
const flag = (name: string, dflt?: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const repoArg = argv.find((a) => !a.startsWith("--")) ?? "shadcn-svelte"
const LIMIT = Number(flag("limit", "0") ?? 0)
const JSON_OUT = flag("json")
const ALL_REPOS = argv.includes("--all-repos")

/**
 * R7 standing rule: literal placeholders that must never be an edge endpoint.
 *
 * A literal MATCH is not a violation. `placeholder.svelte` declares a component
 * named `placeholder`, `example.svelte` one named `example`, and every edge
 * those files emit names a real declared symbol. The first version of this
 * instrument convicted 17 such edges on the corpus's own file names, which is a
 * statement about the instrument. So a match here is a CANDIDATE, and it becomes
 * a violation only when the endpoint is not something the file really declares:
 * not a symbol in its own result, not its file stem, and not part of a module
 * specifier it imports.
 */
const PLACEHOLDER_LITERALS = new Set([
  "", "?", "unknown", "TODO", "FIXME", "placeholder", "dummy", "example",
  "<name>", "<type>", "N/A", "none", "null", "undefined", "any", "*",
  "anonymous", "unnamed", "no-name", "n/a",
])

/** Endpoint halves an `imports` target is built from: `module:item`. */
const endpointIsReal = (
  endpoint: string,
  declaredNames: Set<string>,
  stem: string,
  moduleSpecifiers: Set<string>,
): boolean => {
  if (!PLACEHOLDER_LITERALS.has(endpoint)) return true
  if (endpoint === stem) return true
  if (declaredNames.has(endpoint)) return true
  const colon = endpoint.indexOf(":")
  if (colon > 0) {
    const mod = endpoint.slice(0, colon)
    const item = endpoint.slice(colon + 1)
    if (moduleSpecifiers.has(mod) || declaredNames.has(item)) return true
  }
  return false
}

type Tally = {
  edges: number
  files: number
  sampleFiles: string[]
  confidence: Map<string, number>
  evidenceClass: Map<string, number>
  unresolvedTargets: number
  emptyEndpoints: number
  placeholderEndpoints: number
  placeholderSamples: string[]
  literalCandidates: number
  selfLoops: number
  selfLoopSamples: string[]
}

const tallyOf = (): Tally => ({
  edges: 0,
  files: 0,
  sampleFiles: [],
  confidence: new Map(),
  evidenceClass: new Map(),
  unresolvedTargets: 0,
  emptyEndpoints: 0,
  placeholderEndpoints: 0,
  placeholderSamples: [],
  literalCandidates: 0,
  selfLoops: 0,
  selfLoopSamples: [],
})

function trackedSvelteFiles(repo: string): { abs: string; label: string }[] {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "*.svelte"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    return []
  }
  const out = tracked
    .map((rel) => ({ abs: path.join(dir, rel), label: `${repo}/${rel}` }))
    .filter((f) => {
      try {
        const st = fs.statSync(f.abs)
        return st.isFile() && st.size < 512 * 1024
      } catch {
        return false
      }
    })
  out.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  return LIMIT > 0 ? out.slice(0, LIMIT) : out
}

const repos = ALL_REPOS
  ? fs.readdirSync(CR).filter((e) => {
      try {
        return fs.statSync(path.join(CR, e)).isDirectory()
      } catch {
        return false
      }
    })
  : [repoArg]

const perType = new Map<string, Tally>()
for (const t of ALL_TYPES) perType.set(t, tallyOf())

const filesSeen = new Map<string, number>()
const filesWithAnyEdge = new Set<string>()
let parsed = 0
let failed = 0
let zeroEdgeFiles = 0
let parseErrorFiles = 0
const errorsByKind = new Map<string, number>()
const allSymbolNamesByFile = new Map<string, Set<string>>()
let symbolTotal = 0

const bump = (m: Map<string, number>, k: string): void => m.set(k, (m.get(k) ?? 0) + 1)

for (const repo of repos) {
  const files = trackedSvelteFiles(repo)
  if (!files.length) {
    console.log(`  (no tracked .svelte under ${repo})`)
    continue
  }
  const dir = path.join(CR, repo)
  for (const f of files) {
    let r: any
    try {
      r = await parseFile(f.abs, dir)
    } catch {
      failed++
      continue
    }
    parsed++
    const names = new Set<string>()
    for (const s of r.symbols ?? []) {
      if (typeof s?.name === "string") names.add(s.name)
      symbolTotal++
    }
    allSymbolNamesByFile.set(f.abs, names)
    const stem = path.basename(f.abs, path.extname(f.abs))
    const moduleSpecifiers = new Set<string>()
    for (const i of r.imports ?? []) {
      const m = i?.module ?? i?.modulePath ?? i?.path
      if (typeof m === "string" && m.length) moduleSpecifiers.add(m)
    }
    const errs = r.errors ?? []
    if (errs.length) {
      parseErrorFiles++
      for (const e of errs) bump(errorsByKind, String(e?.message ?? "").slice(0, 60))
    }
    const rels = r.relationships ?? []
    if (!rels.length) zeroEdgeFiles++
    const fileHit = new Set<string>()
    for (const x of rels) {
      const t = String(x.type ?? x.relationshipType ?? "")
      const row = perType.get(t)
      if (!row) continue
      row.edges++
      fileHit.add(t)
      if (row.sampleFiles.length < 4 && !row.sampleFiles.includes(f.label)) row.sampleFiles.push(f.label)
      const conf = typeof x.confidence === "number" ? String(x.confidence) : "unset"
      bump(row.confidence, conf)
      bump(row.evidenceClass, String((x.metadata ?? {}).evidenceClass ?? "-"))
      const tgt = String(x.target ?? "")
      const src = String(x.source ?? "")
      if (!tgt.length || !src.length) row.emptyEndpoints++
      if (PLACEHOLDER_LITERALS.has(tgt) || PLACEHOLDER_LITERALS.has(src)) row.literalCandidates++
      if (
        !endpointIsReal(tgt, names, stem, moduleSpecifiers) ||
        !endpointIsReal(src, names, stem, moduleSpecifiers)
      ) {
        row.placeholderEndpoints++
        if (row.placeholderSamples.length < 12) row.placeholderSamples.push(`${f.label}:${x.line_number ?? "-"} ${tgt} <- ${src}`)
      }
      if (tgt === src) {
        row.selfLoops++
        if (row.selfLoopSamples.length < 12) row.selfLoopSamples.push(`${f.label}:${x.line_number ?? "-"} ${tgt}`)
      }
    }
    for (const t of fileHit) {
      const row = perType.get(t)!
      row.files++
      filesSeen.set(t, (filesSeen.get(t) ?? 0) + 1)
    }
    if (rels.length) filesWithAnyEdge.add(f.abs)
  }
}

console.log(`SVELTE FIRING CENSUS — production path (pool-worker.parseFile)`)
console.log(`corpus: ${repos.join(", ")}`)
const totalFiles = parsed + failed
console.log(`files: ${parsed}/${totalFiles} parsed (${failed} threw) · ${filesWithAnyEdge.size} carried >=1 relationship · ${zeroEdgeFiles} carried none · ${parseErrorFiles} carried parse errors`)
console.log(`symbols: ${symbolTotal}\n`)

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("type", 14)}${w("edges", 9)}${w("files", 8)}${w("conf<0.7", 10)}${w("unresolved-tgt", 15)}${w("empty", 7)}${w("placeholder", 12)}sample files`)
console.log("-".repeat(150))
const fired: string[] = []
const silent: string[] = []
for (const t of ALL_TYPES) {
  const row = perType.get(t)!
  if (row.edges > 0) fired.push(t)
  else silent.push(t)
  const heuristic = [...row.confidence.entries()]
    .filter(([k]) => k !== "unset" && Number(k) < 0.7)
    .reduce((a, [, n]) => a + n, 0)
  const unresolved = row.unresolvedTargets
  console.log(
    `${w(t, 14)}${w(row.edges.toLocaleString(), 9)}${w(row.files.toLocaleString(), 8)}${w(heuristic.toLocaleString(), 10)}${w(unresolved.toLocaleString(), 15)}${w(row.emptyEndpoints, 7)}${w(row.placeholderEndpoints, 12)}${row.sampleFiles.slice(0, 2).join(", ")}`,
  )
}
console.log("-".repeat(150))
console.log(`FIRED ${fired.length}/10 : ${fired.join(" ")}`)
console.log(`SILENT (constructible, produced nothing) : ${silent.join(" ")}`)

console.log("\nEVIDENCE CLASS / CONFIDENCE per fired type (honesty contract §4 — guesswork ratio must be countable):")
for (const t of fired) {
  const row = perType.get(t)!
  const cls = [...row.evidenceClass.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join(" ")
  const conf = [...row.confidence.entries()].sort((a, b) => Number(b[0]) - Number(a[0])).map(([k, n]) => `${k}:${n}`).join(" ")
  console.log(`  ${w(t, 13)} class[${cls}]  conf[${conf}]`)
}
if (errorsByKind.size) {
  console.log("\nPARSE ERRORS by kind (grammar residual, top 8):")
  for (const [k, n] of [...errorsByKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${String(n).padStart(5)}  ${k}`)
  }
}
const flagged = ALL_TYPES.filter((t) => {
  const r = perType.get(t)!
  return r.placeholderEndpoints > 0 || r.emptyEndpoints > 0 || r.selfLoops > 0
})
if (flagged.length) {
  console.log("\nR7 / HYGIENE FLAGS — every edge named below is shipped in the graph:")
  console.log("  (literalCandidates counts endpoints whose text IS a placeholder word;")
  console.log("   most are the file stem of a file actually named placeholder.svelte /")
  console.log("   example.svelte, so only unbacked ones are convicted.)")
  for (const t of flagged) {
    const r = perType.get(t)!
    console.log(`  ${t}: placeholder ${r.placeholderEndpoints} (of ${r.literalCandidates} literal candidates), empty ${r.emptyEndpoints}, self-loop ${r.selfLoops}`)
    for (const s of r.placeholderSamples) console.log(`      PLACEHOLDER  ${s}`)
    for (const s of r.selfLoopSamples) console.log(`      SELF-LOOP    ${s}`)
  }
}

if (JSON_OUT) {
  const out = {
    at: new Date().toISOString(),
    corpus: repos,
    productionPath: "src/ast/pool-worker.parseFile",
    filesParsed: parsed,
    filesThrew: failed,
    filesWithEdges: filesWithAnyEdge.size,
    filesWithNoEdges: zeroEdgeFiles,
    filesWithParseErrors: parseErrorFiles,
    symbols: symbolTotal,
    types: Object.fromEntries(
      [...perType.entries()].map(([t, r]) => [
        t,
        {
          edges: r.edges,
          files: r.files,
          sampleFiles: r.sampleFiles,
          confidence: Object.fromEntries(r.confidence),
          evidenceClass: Object.fromEntries(r.evidenceClass),
          emptyEndpoints: r.emptyEndpoints,
          placeholderEndpoints: r.placeholderEndpoints,
          literalCandidates: r.literalCandidates,
          placeholderSamples: r.placeholderSamples,
          selfLoops: r.selfLoops,
          selfLoopSamples: r.selfLoopSamples,
        },
      ]),
    ),
    fired,
    silent,
    parseErrorKinds: Object.fromEntries(errorsByKind),
  }
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true })
  fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2))
  console.log(`\nevidence: ${path.relative(ROOT, JSON_OUT)}`)
}