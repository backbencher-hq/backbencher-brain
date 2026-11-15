// go lane — STRESS READ on a GO-HEAVY corpus (#799/#889 round follow-up).
//
// Why this exists: the lane's pinned evidence is two MID-SIZE corpora
// (go-tools 1,931 + terraform 1,993 `.go` files), and the harness's canonical
// gates read DRAWS of them (F5 floor: terraform @60; R10 census: 40 + 24 files).
// Everything this round fixed was found by reading the full extent of those two
// trees — but 3,924 files is not a go-heavy tree. This probe reads an arbitrary
// repo root at FULL extent and answers four questions the pinned corpora cannot:
//
//   1. GRAMMAR — how often does the pinned tree-sitter-go grammar lose a
//      declaration to its own ERROR recovery (the GO-GAP-1 class: 3 of 1,931
//      go-tools files, 92 declarations, 0 of 1,993 terraform).
//   2. CRASH     — does the analyzer die on any file (the `constructor` class:
//      a plain `{}` map keyed by a LEGAL type name resolved Object.prototype)?
//   3. NAME      — F14's two go checks, verbatim: every name-bearing target and
//      every symbol name must be a Go identifier, plus the PRE-FIX derivation
//      (qualified_type texts + import paths), which MUST trip the same rule.
//   4. SURFACE   — how many analyzer edges the F5 allowlist DROPS for go
//      (`uses`/`references`/`imports`/`exports`: 75,062 on go-tools).
//
// Run: bun script/m14/tmp/go-heavy-stress.ts <repoRoot> [--stage=grammar|analyze|all] [--limit=N]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { RealGoAnalyzer } from "../../../src/ast/real-go-analyzer"

const arg = (name: string): string | undefined => {
  // BOTH spellings: `--limit 300` and `--limit=300`. The first draft accepted
  // only the space form, and a `--stage=all --limit=300` smoke run therefore
  // read the WHOLE tree while claiming to be a smoke run — the reason a probe
  // reports the extent it actually read in its own output.
  const eq = process.argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const root = process.argv[2]
if (!root || !fs.existsSync(root)) {
  console.error("usage: bun script/m14/tmp/go-heavy-stress.ts <repoRoot> [--stage=...] [--limit=N]")
  process.exit(2)
}
const STAGE = arg("--stage") ?? "all"
const LIMIT = Number(arg("--limit") ?? Number.MAX_SAFE_INTEGER)
// CHUNKING. Measured on kubernetes: a single process parses ~10,000 `.go` files
// and then the wasm runtime starts trapping (`Aborted()`) — 68+ consecutive
// traps, progress stalls — even though the parser is re-fetched per file (the
// engine's own 500-file recreation). The read is therefore driven in INDEX
// RANGES over a sorted file list, one fresh process per range, so the corpus is
// actually covered instead of covered-up-to-a-cliff. `--from`/`--to` are
// inclusive/exclusive indices into that sorted list.
const FROM = Number(arg("--from") ?? 0)
const TO = Number(arg("--to") ?? -1)

// ------------------------------------------------------------------ the rules
// GO_IDENT is F14's predicate, copied: a `letter` (unicode_letter or `_`)
// followed by letters and unicode DIGITS — NOT ASCII (go-tools' own
// `ext۰bytes۰Equal` uses U+06F0, an Arabic zero numeral, and is LEGAL).
const GO_IDENT = /^[\p{L}_][\p{L}\p{Nd}_]*$/u
// The labels the harness offers to the F5 comparison for go — copied from the
// allowlist expression in differential.ts, not paraphrased.
const GATED = new Set(["extends", "implements", "instantiates", "overrides", "calls"])

// ------------------------------------------------------------------ the walk
const files: string[] = []
let skippedDirs = 0
const walk = (dir: string, depth = 0) => {
  if (depth > 24) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === "vendor") {
        skippedDirs++
        continue
      }
      walk(path.join(dir, e.name), depth + 1)
    } else if (e.isFile() && e.name.endsWith(".go")) files.push(path.join(dir, e.name))
  }
}
walk(root)
files.sort()

// NO cached parser: fetched PER FILE, which is what the engine's own pipeline
// does (it recreates the instance every 500 files because a long-lived one dies
// with `Aborted()` after ~9,000-10,000 parses — measured: 10,609 on kubernetes).
const analyzer = new RealGoAnalyzer()

// ------------------------------------------------------------------ stage 1: grammar
const grammar = {
  filesRead: 0,
  erroredFiles: 0,
  errorRegions: 0,
  errorRegionsSpanningDecl: 0,
  swallowedDeclLines: 0,
  examples: [] as string[],
}
const DECL_LINE = /^[ \t]*(func|type|var|const)\s+/gm
const runGrammar = (src: string, rel: string, tree: any) => {
  grammar.filesRead++
  if (!tree?.rootNode?.hasError) return
  grammar.erroredFiles++
  const stack: any[] = [tree.rootNode]
  let swallowHere = 0
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "ERROR" || n.isMissing) {
      grammar.errorRegions++
      const text = String(n.text ?? "")
      const decls = text.match(DECL_LINE)
      if (decls) {
        swallowHere += decls.length
        grammar.errorRegionsSpanningDecl++
      }
      continue
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (swallowHere > 0) {
    grammar.swallowedDeclLines += swallowHere
    if (grammar.examples.length < 12) grammar.examples.push(`${rel}: ${swallowHere} declaration line(s) inside an ERROR region`)
  } else if (grammar.examples.length < 12) {
    // an errored file that does NOT hide a declaration is still worth naming:
    // it is the shape that only breaks a build, not a graph.
    grammar.examples.push(`${rel}: ERROR region(s) but no declaration inside`)
  }
}

// ------------------------------------------------------------------ stage 2: analyzer
const analyze = {
  filesRead: 0,
  throws: 0,
  throwSamples: [] as string[],
  symbols: 0,
  nameBearingTargets: 0,
  targetViolations: [] as string[],
  symbolViolations: [] as string[],
  prefixSpellings: 0,
  prefixViolations: 0,
  edgesByLabel: {} as Record<string, number>,
  gatedEdges: 0,
  droppedEdges: 0,
  droppedByLabel: {} as Record<string, number>,
}
const runAnalyze = async (src: string, rel: string, tree: any) => {
  analyze.filesRead++
  let res: any
  try {
    res = await analyzer.analyze(tree.rootNode, src, rel)
  } catch (e: any) {
    analyze.throws++
    if (analyze.throwSamples.length < 10) analyze.throwSamples.push(`${rel}: ${String(e?.message ?? e).slice(0, 160)}`)
    return
  }
  for (const s of res.symbols ?? []) {
    analyze.symbols++
    const name = String(s?.name ?? "")
    if (name.trim() === "" || !GO_IDENT.test(name)) {
      if (analyze.symbolViolations.length < 20) analyze.symbolViolations.push(`${rel}: symbol ${JSON.stringify(name)}`)
    }
  }
  for (const r of res.relationships ?? []) {
    const label = String(r?.type ?? r?.relationshipType ?? "")
    analyze.edgesByLabel[label] = (analyze.edgesByLabel[label] ?? 0) + 1
    if (GATED.has(label)) analyze.gatedEdges++
    else {
      analyze.droppedEdges++
      analyze.droppedByLabel[label] = (analyze.droppedByLabel[label] ?? 0) + 1
    }
    const t = r?.target ?? r?.to ?? r?.toSymbol
    if (t === undefined || t === null || String(t).trim() === "") continue
    // Name-bearing = everything but the module-path families the family carries
    // as owed (`imports`), which is exactly F14's one named exemption.
    if (label === "imports") continue
    analyze.nameBearingTargets++
    const target = String(t)
    if (!GO_IDENT.test(target) && analyze.targetViolations.length < 20) {
      analyze.targetViolations.push(`${rel}: ${label} -> ${JSON.stringify(target.slice(0, 90))}`)
    }
  }
  // PRE-FIX derivation, from the TREE (never from the analyzer): qualified type
  // texts and import paths. Both MUST be non-names, so the counter must move.
  const stack: any[] = [tree.rootNode]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "qualified_type") {
      analyze.prefixSpellings++
      if (!GO_IDENT.test(String(n.text ?? ""))) analyze.prefixViolations++
    }
    if (n.type === "import_spec") {
      const kids: any[] = n.namedChildren ?? []
      const p = kids.find((c: any) => c.type === "interpreted_string_literal" || c.type === "raw_string_literal")
      if (p) {
        analyze.prefixSpellings++
        if (!GO_IDENT.test(String(p.text ?? "").replace(/^["`]/, "").replace(/["`]$/, ""))) analyze.prefixViolations++
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
}

// ------------------------------------------------------------------ the read
const t0 = Date.now()
const selected = files.slice(FROM, TO >= 0 ? TO : LIMIT < files.length ? LIMIT : files.length)
console.log(`stress read: ${root}`)
console.log(`  .go files found: ${files.length}${LIMIT < files.length ? ` (reading first ${LIMIT})` : ""}; skipped dirs (.git/node_modules/vendor): ${skippedDirs}`)
console.log(`  stage: ${STAGE}; predicate: ${GO_IDENT.source}; gated labels: ${[...GATED].join(", ")}`)

// A file this probe cannot read or parse is a file it does NOT cover, so the
// skip is COUNTED AND NAMED rather than swallowed by a bare `continue` (the
// first draft of this probe silently dropped 2,879 of 13,488 kubernetes files
// that way, which is how a stress read becomes a claim about a subtree).
const skips = { read: 0, parse: 0, noRoot: 0, samples: [] as string[] }
for (const f of selected) {
  let src: string
  let tree: any
  try {
    src = fs.readFileSync(f, "utf8")
  } catch (e: any) {
    skips.read++
    if (skips.samples.length < 15) skips.samples.push(`READ ${path.relative(root, f)}: ${String(e?.message ?? e).slice(0, 120)}`)
    continue
  }
  try {
    const parser = await ASTEngine.getParser("go" as any)
    tree = parser.parse(src)
  } catch (e: any) {
    skips.parse++
    if (skips.samples.length < 15) skips.samples.push(`PARSE ${path.relative(root, f)} (${src.length} bytes): ${String(e?.message ?? e).slice(0, 120)}`)
    continue
  }
  if (!tree?.rootNode) {
    skips.noRoot++
    if (skips.samples.length < 15) skips.samples.push(`NOROOT ${path.relative(root, f)} (${src.length} bytes)`)
    continue
  }
  const rel = path.relative(root, f)
  if (STAGE === "grammar" || STAGE === "all") runGrammar(src, rel, tree)
  if (STAGE === "analyze" || STAGE === "all") await runAnalyze(src, rel, tree)
  const done = grammar.filesRead || analyze.filesRead
  if (done % 2000 === 0) console.log(`  … ${done} files, ${Math.round((Date.now() - t0) / 1000)}s`)
}
console.log(
  `\n=== COVERAGE ===\n  selected ${selected.length}, read ${grammar.filesRead || analyze.filesRead}, ` +
    `skipped: read ${skips.read} / parse ${skips.parse} / no-root ${skips.noRoot}`,
)
for (const s of skips.samples) console.log("  " + s)

if (STAGE === "grammar" || STAGE === "all") {
  console.log("\n=== GRAMMAR (GO-GAP-1 class) ===")
  console.log(JSON.stringify(grammar, null, 1))
  for (const e of grammar.examples) console.log("  " + e)
}
if (STAGE === "analyze" || STAGE === "all") {
  console.log("\n=== ANALYZER (crash + names + surface) ===")
  console.log(
    JSON.stringify(
      {
        filesRead: analyze.filesRead,
        throws: analyze.throws,
        throwSamples: analyze.throwSamples,
        symbols: analyze.symbols,
        symbolViolations: analyze.symbolViolations,
        nameBearingTargets: analyze.nameBearingTargets,
        targetViolations: analyze.targetViolations,
        prefixSpellings: analyze.prefixSpellings,
        prefixViolations: analyze.prefixViolations,
        gatedEdges: analyze.gatedEdges,
        droppedEdges: analyze.droppedEdges,
        droppedByLabel: analyze.droppedByLabel,
        edgesByLabel: analyze.edgesByLabel,
      },
      null,
      1,
    ),
  )
}
console.log(`\nelapsed: ${Math.round((Date.now() - t0) / 1000)}s`)
