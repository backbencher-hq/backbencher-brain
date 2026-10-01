// M12.36 — the yaml corpus error / crash census.
//
// WHY THIS FILE EXISTS. Same reason as `yaml-contract-probe.ts`: the analyzer doc
// cited `validation/m12/results/yaml-corpus-errors.json` and no script in the tree
// produced it. A census with no producer cannot be re-run, so "0 errors, 0 crashes"
// was a claim about a moment rather than a property of the lane.
//
// WHAT IT MEASURES, over EIGHT pinned repositories rather than the single corpus the
// old manifest named:
//   - grammar-error files and error nodes, per repo
//   - analyzer crashes (must be 0)
//   - symbols / relationships / imports per repo
//   - the identity invariant that a corpus census can check cheaply and that a
//     differential cannot: no two symbols in one file share an id
//   - the honesty invariant: every relationship carries a 1-based line and an evidence
//     tier, and no symbol metadata carries a placeholder
//   - the payload totals, so a regression that drops docstrings or apiContractPaths is
//     visible as a count rather than as a feeling
//
// USAGE: bun run script/m12/yaml-corpus-errors.ts [corpusDir] [--per-repo=250]
//        with no argument it walks all eight pinned repositories.
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = process.cwd()
const CORPUS_ROOT = "$HOME/fixtures/repositories"
// NINTH corpus, added 2026-09-28 for ONE reason: `yaml_tag_include` had ZERO occurrences in
// the first eight, so the family was pinned by fixture only and no corpus could hold it
// to account. pyyaml-include is the library that DEFINES the construct — its own test
// data is real `!include` YAML, and PyYAML parses those files cleanly, so the grammar is
// not the reason the family was rare. It is a small repository (test data, not a
// production corpus) and is declared as such: it exists to make one construct
// corpus-backed, and it is not evidence about YAML's general shape.
const REPOS = ["grails-core", "docker", "ansible", "kubernetes", "terraform", "openapi-spec", "helm", "gh-cli", "pyyaml-include"]
/** The draw the manifest names as `corpusTarget`; see `corpusRevision` below. */
const PRIMARY_CORPUS = "kubernetes"

const arg = (name: string, dflt: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? Number(hit.slice(name.length + 3)) : dflt
}
const PER_REPO = arg("per-repo", 250)
const single = process.argv.slice(2).find((a) => !a.startsWith("--"))
const targets = single ? [{ name: path.basename(single), dir: single }] : REPOS.map((name) => ({ name, dir: path.join(CORPUS_ROOT, name) }))

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (/\.(ya?ml)$/i.test(e.name)) out.push(p)
  }
}

const perRepo: any[] = []
const errorFiles: { file: string; count: number; template?: string[] }[] = []
const templateFiles: { file: string; markers: string[]; errors: number }[] = []
const nonTemplateErrorFiles: { file: string; count: number }[] = []
const crashes: { file: string; error: string }[] = []
let trackedFiles = 0, filesScanned = 0, errorNodes = 0
let symbols = 0, relationships = 0, imports = 0
let importsWithLine = 0, importsWithRealLine = 0
let importsWithRealType = 0, genericImportTypes = 0
const importTypeMismatch: string[] = []
const importLinesMissing: string[] = []
let duplicateIdFiles = 0, duplicateIds = 0
let relWithLine = 0, relWithEvidence = 0, unknownSentinels = 0
let withDocstring = 0, withComplexity = 0, withApiContract = 0, withQualifiedCalls = 0, withLines = 0

for (const target of targets) {
  const files: string[] = []
  walk(target.dir, files)
  files.sort()
  const stride = Math.max(1, Math.floor(files.length / PER_REPO))
  const chosen: string[] = []
  for (let i = 0; i < files.length && chosen.length < PER_REPO; i += stride) chosen.push(files[i]!)
  let revision = "unpinned"
  try { revision = execFileSync("git", ["-C", target.dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { /* not a git checkout */ }
  trackedFiles += files.length

  let rFiles = 0, rErrors = 0, rErrorNodes = 0, rSymbols = 0, rRels = 0, rImports = 0
  for (const file of chosen) {
    let content: string
    try { content = fs.readFileSync(file, "utf8") } catch { continue }
    let parsed: any
    try {
      parsed = await parseFile(file, process.cwd())
    } catch (error: any) {
      crashes.push({ file: path.relative(target.dir, file), error: String(error?.message ?? error).slice(0, 300) })
      continue
    }
    filesScanned++
    rFiles++
    const count = parsed.errors?.length ?? 0
    if (count) {
      const rel = path.relative(target.dir, file)
      const markers = templateMarkers(content)
      errorFiles.push({ file: rel, count, template: markers.length > 0 ? markers : undefined })
      if (markers.length > 0) { templateFiles.push({ file: rel, markers, errors: count }) }
      else { nonTemplateErrorFiles.push({ file: rel, count }) }
      rErrors++
      rErrorNodes += count
      errorNodes += count
    }
    const syms = (parsed.symbols ?? []) as any[]
    const rels = (parsed.relationships ?? []) as any[]
    rSymbols += syms.length; symbols += syms.length
    rRels += rels.length; relationships += rels.length
    const imps = (parsed.imports ?? []) as any[]
    rImports += imps.length; imports += imps.length
    // An import must arrive with its LINE. It did not, for any language, until
    // 2026-09-28: every analyzer writes `line_number` on an import and pool-worker read
    // only `range.startLine` / `line`, so all 540 corpus imports reached the store with
    // `line: 0`. Nothing measured it — a count of imports says nothing about whether the
    // rows are locatable — so this invariant exists to make the loss loud if it returns.
    for (const imp of imps) {
      importsWithLine++
      if (typeof (imp as any).line === "number" && (imp as any).line >= 1) importsWithRealLine++
      else importLinesMissing.push(`${path.relative(target.dir, file)} :: ${(imp as any).path ?? (imp as any).module ?? "?"} line=${JSON.stringify((imp as any).line)}`)
    }
    // The import row must carry the SAME classification the relationship does. This is the
    // sharp version of the line check: for years every import in every language read
    // `type: "named"` — the JS/TS idiom — so a PROJECT file dependency
    // (`include_tasks: tasks.yml`) and an EXTERNAL tool invocation
    // (`uses: actions/checkout@v4`) were indistinguishable in the row the
    // file-dependency engine reads, while the relationships always knew the difference.
    // Asserting row-type == relationshipType makes any future flattening loud here rather
    // than discovered by a consumer.
    const importRels = (parsed.relationships ?? []).filter((r: any) => r.type === "imports")
    const relKinds = new Set<string>(importRels.map((r: any) => String(r.metadata?.relationshipType ?? "")))
    for (const imp of imps) {
      const t = String((imp as any).type ?? "")
      if (!t || t === "named" || t === "default" || t === "namespace" || t === "alias") {
        genericImportTypes++
        continue
      }
      if (relKinds.has(t)) importsWithRealType++
      else importTypeMismatch.push(`${path.relative(target.dir, file)} :: row type ${t} has no relationship of that kind (${[...relKinds].join("|")})`)
    }

    // IDENTITY AT THE PRODUCTION ENTRY. `poolWorker.parseFile` reshapes a symbol into
    // the store's row shape, and that row has NO `id` field at all: the indexer mints
    // `${fileId}:${name}:${startLine}` for the primary key and resolves relationship
    // endpoints through `qualified_name`. So the analyzer's identity, as the graph sees
    // it, is `qualifiedName` — measuring `s.id` here read `undefined` for every row and
    // reported 274,509 "duplicate ids" across 1,212 files, which was this script's bug
    // and not the analyzer's. The direct-analyzer census
    // (validation/m14/results/yaml-post-rewrite-census.json) reports 0 over the same
    // corpora, and the two now agree.
    const ids = syms.map((s) => String(s.qualifiedName))
    const dup = ids.length - new Set(ids).size
    if (dup > 0) { duplicateIdFiles++; duplicateIds += dup }
    for (const s of syms) {
      // docstring DOES survive: it is carried explicitly (the M35 pre-work) and bound.
      if (typeof s.docstring === "string" && s.docstring.length > 0) withDocstring++
      if (typeof s.complexity === "number") withComplexity++
      // `apiContractPath` does NOT survive: the worker mapping does not carry it, while
      // the indexer binds `symbol.apiContractPath` into the `api_contract_path` column.
      // Measured as 0 here and non-zero at the analyzer boundary — see
      // `seamFindings` below and reviews/yaml/master-review.md.
      if (typeof s.apiContractPath === "string") withApiContract++
      // `qualified_calls` is RENAMED to `qualifiedCalls` by the worker mapping and the
      // indexer reads the camelCase name, so the payload does survive the seam.
      if (Array.isArray(s.qualifiedCalls) && s.qualifiedCalls.length > 0) withQualifiedCalls++
      for (const v of Object.values(s.metadata ?? {})) {
        if (String(v) === "unknown") unknownSentinels++
        if (Array.isArray(v)) for (const x of v) if (String(x) === "unknown") unknownSentinels++
      }
    }
    for (const r of rels) {
      if (typeof r.line_number === "number" && r.line_number >= 1) { relWithLine++; withLines++ }
      if (["structural", "usage_contextual", "import_based", "reference_qualified", "inferred"].includes(r.metadata?.evidenceClass)) relWithEvidence++
    }
  }
  perRepo.push({ repo: target.name, revision, available: files.length, drawn: chosen.length, stride, files: rFiles, errorFiles: rErrors, errorNodes: rErrorNodes, symbols: rSymbols, relationships: rRels, imports: rImports })
}

/**
 * The grammar-error files are NAMED, not hidden. tree-sitter-yaml 0.7.1 cannot lex a
 * multi-line double-quoted scalar, and when it meets one the ERROR it produces sits at
 * the document root — so a 271 KB file loses its whole containment. Proven against an
 * independent parser: `script/m14/tmp/yaml-f5-differential.ts` records that PyYAML 6.0.1
 * parses `docker/api/docs/v1.27.yaml` cleanly. See
 * `script/m14/spec/yaml-completeness.json` and the grammar pin's `alternatives`.
 */
/**
 * A TEMPLATE is not a YAML file at parse time, and calling its parse failure an
 * analyzer error would be a category error twice over: the file is not YAML, and the
 * grammar is not at fault. Two mechanisms occur in these eight repositories and both
 * are named rather than lumped:
 *   - a Go text/template chart template (`{{ ... }}`), which Helm renders before the
 *     result is YAML — 100+ files under the helm testdata trees
 *   - an unexpanded `@name@` placeholder, which the Grails skeleton ships
 * Detection is a MARKER test on the raw text, not a filename or path pattern, and it is
 * reported as a count so a corpus that stops being templates shows up as a change.
 */
function templateMarkers(content: string): string[] {
  const found: string[] = []
  // Whitespace-tolerant, because Helm's own `malformed-template` fixtures are written
  // `{ {- ... -}}` on purpose: a literal `{{` test missed two of them and reported them
  // as analyzer errors. A measurement that misses the case it was written to catch is
  // worse than no measurement. (This is a measurement SCRIPT, so a pattern here costs
  // the lane nothing — the zero-regex rule governs src/ast/real-*-analyzer.ts.)
  if (/\{\s*\{/.test(content)) found.push("go-text-template")
  if (/@[A-Za-z][A-Za-z0-9._-]*@/.test(content)) found.push("grails-placeholder")
  return found
}

// CORRECTED 2026-09-28 by script/m60/yaml-bucket-audit.ts. This string said the trigger
// "puts a 58-byte ERROR at the document root". The 58-byte node is real but it is NESTED
// (v1.28: bytes 79,218-79,276, line 2453, depth 4). The ROOT node itself is the ERROR and
// it is 72,809-110,341 bytes: the parser STOPS, and only 27.6-31.1% of each affected file is
// ever parsed. "One bad token" and "the parser gives up 70% of the way through" are different
// upstream bug reports, and only the second is true.
const grammarLimitation = "a multi-line double-quoted scalar (a `description:` folded across a line break) makes the DOCUMENT ROOT an ERROR node, and the parse stops there: measured over docker/api/docs/v1.25..v1.38 the root ERROR spans 72,809-110,341 bytes and the tree covers only 27.6-31.1% of the file, so 69-72% is never parsed (the 58-byte node is a separate NESTED error where the trigger begins)"
// Compared BY PATH STRING, not by object identity: the first version built this list
// from `errorFiles` and tested it with `.includes()` against entries of
// `nonTemplateErrorFiles`, so the check was never true and 14 known-limitation files
// were reported as unexpected. A predicate that cannot be true is not a predicate.
const isKnownLimitation = (file: string): boolean =>
  file.includes("cloudbuild.yaml") || /v1\.(2[5-9]|3[0-8])\.ya?ml$/.test(file)
const knownLimitationFiles = errorFiles.filter((e) => isKnownLimitation(e.file) && !e.template)
const unexpectedErrors = nonTemplateErrorFiles.filter((e) => !isKnownLimitation(e.file))

const invariants = {
  crashFiles: crashes.length,
  duplicateIdFiles,
  duplicateIds,
  relationshipsWithLine: `${relWithLine}/${relationships}`,
  relationshipsWithEvidenceClass: `${relWithEvidence}/${relationships}`,
  unknownSentinels,
  symbolsWithComplexity: `${withComplexity}/${symbols}`,
  symbolsWithDocstring: withDocstring,
  symbolsWithApiContractPath: withApiContract,
  symbolsWithQualifiedCalls: withQualifiedCalls,
  importsWithLine: `${importsWithRealLine}/${importsWithLine}`,
  importsMissingLine: importLinesMissing.length,
  importsMissingLineSamples: importLinesMissing.slice(0, 8),
  // import rows whose type is this lane's own classification AND matches a relationship of
  // that kind. `generic` counts rows still carrying the JS/TS idiom, which is correct for a
  // language with no importType and a defect for this one.
  importsWithSpecificType: `${importsWithRealType}/${importsWithLine - genericImportTypes}`,
  importsWithGenericType: genericImportTypes,
  importTypeMismatches: importTypeMismatch.length,
  importTypeMismatchSamples: importTypeMismatch.slice(0, 8),
  imports,
  symbolsWithApiContractPathAtWorkerBoundary: withApiContract,
  seamFindings: [
    {
      field: "apiContractPath",
      status: "DROPPED AT THE WORKER BOUNDARY",
      detail:
        "src/ast/pool-worker.ts reshapes every symbol into the store's row shape and its mapping has no `apiContractPath` key, while src/ast/parallel-indexer.ts binds `symbol.apiContractPath` into the `api_contract_path` column (line 2414) and takes `parseFile` from the pool worker (line 889). So `brain_symbol.api_contract_path` is NULL for every file indexed through the production path, in EVERY language. Both sides of the binding exist, which is why the M60 P1 two-way rot-check passes: this is a break in the MIDDLE, not at either end.",
      affects: "every language that emits apiContractPath (yaml is one; the field is a Matrix 1b payload)",
      ownerDecision: "NOT fixed in this lane: pool-worker.ts and parallel-indexer.ts are shared files with other lanes in flight, and the user's standing instruction is that shared work is committed centrally. Recorded here and in reviews/yaml/master-review.md for the owner.",
    },
    {
      field: "metadata",
      status: "NARROWED TO A CSS ALLOWLIST AT THE WORKER BOUNDARY",
      detail:
        "The same mapping copies only a fixed list of CSS-specific metadata keys, so `brain_symbol.annotations` is NULL for every non-CSS language. That is a documented, deliberate choice in the file ('widening `annotations` for every symbol in every language is a separate, larger change that needs its own measurement round'), and it is why this lane's evidence states every `metadata` claim as an ANALYZER-BOUNDARY claim.",
      affects: "every non-CSS language's symbol metadata at the index boundary",
    },
  ],
}
const passed =
  crashes.length === 0 &&
  duplicateIds === 0 &&
  relWithLine === relationships &&
  relWithEvidence === relationships &&
  unknownSentinels === 0 &&
  withComplexity === symbols &&
  unexpectedErrors.length === 0

const result = {
  analyzer: "yaml",
  corpus: single ?? CORPUS_ROOT,
  repositories: perRepo,
  revision: perRepo.map((r) => `${r.repo}@${r.revision}`).join(" "),
  // The M60 H7 check (script/m12/verify-corpus-claims.ts) reads the artifact's own draw
  // and requires it to BE a draw the manifest declares. A union corpus has eight, and the
  // space-joined `revision` string above is not a form it can resolve: it parsed the first
  // token and reported the corpus as `?@grails-core`, which is the gate correctly refusing
  // to guess a repo id out of a prose list. `corpusRevision` names the PRIMARY draw in the
  // `<repo>@<sha>` form the gate expects and `revisions` carries all eight as a map, so
  // every pin stays visible while the draw the manifest names is unambiguous.
  // The shape H7 actually reads, established by reading the gate rather than by
  // guessing at it twice: `corpusRevision` is a BARE sha (it prefix-matches the
  // manifest's short sha in both directions) and `corpusRepo` names the repo id,
  // which it then normalises (`-`/`_` stripped, lowercased) before requiring the
  // ids to agree. Writing `repo@sha` into `corpusRevision` — which is the form the
  // gate's own comment calls a pin — fails the prefix comparison and convicts a lane
  // whose draw is declared, which is how this row first reported `?@grails-core@`.
  // The primary is named by CONSTANT rather than taken as `perRepo[0]`, because
  // element zero is grails-core and the manifest's `corpusTarget` is kubernetes.
  corpusRevision: single
    ? (perRepo[0]?.revision ?? null)
    : (perRepo.find((r) => r.repo === PRIMARY_CORPUS)?.revision ?? perRepo[0]?.revision ?? null),
  corpusRepo: single ? path.basename(single) : PRIMARY_CORPUS,
  revisions: Object.fromEntries(perRepo.map((r) => [r.repo, r.revision])),
  extensions: [".yaml", ".yml"],
  perRepoLimit: PER_REPO,
  trackedFiles,
  files: filesScanned,
  errorFiles: errorFiles.length,
  errorNodes,
  crashFiles: crashes.length,
  errors: errorFiles,
  crashes,
  symbols,
  relationships,
  knownGrammarLimitation: { reason: grammarLimitation, files: knownLimitationFiles.map((f) => f.file), provenBy: "script/m14/tmp/yaml-f5-differential.ts (PyYAML 6.0.1 parses these files cleanly)" },
  unexpandedTemplateFiles: {
    count: templateFiles.length,
    markers: templateFiles.reduce<Record<string, number>>((acc, f) => { for (const m of f.markers) acc[m] = (acc[m] ?? 0) + 1; return acc }, {}),
    files: templateFiles,
    note: "Not YAML at parse time, so a parse failure is not an analyzer error. Named per file with the mechanism, not excluded by path pattern.",
  },
  unexpectedErrors: unexpectedErrors.map((f) => f.file),
  acceptanceFiles: filesScanned - unexpectedErrors.length - templateFiles.length,
  invariants,
  passed,
  policy: "0 crashes and 0 duplicate ids are hard requirements. A file with parse errors is acceptable in exactly three named ways: (a) a TEMPLATE that is not YAML until rendered, named with its marker; (b) a GRAMMAR limitation, named with the construct, proven parseable by an independent implementation, and carrying declared recovery; (c) nothing else. Anything in `unexpectedErrors` fails the gate.",
  note: "This file previously existed with no producer in the tree. Re-runnable: bun run script/m12/yaml-corpus-errors.ts",
}
writeFileSync(path.join(ROOT, "validation/m12/results/yaml-corpus-errors.json"), JSON.stringify(result, null, 1))
console.log(JSON.stringify({ filesScanned, errorFiles: errorFiles.length, crashFiles: crashes.length, symbols, relationships, invariants, passed }, null, 1))
console.log("wrote validation/m12/results/yaml-corpus-errors.json")
process.exit(passed ? 0 : 1)
