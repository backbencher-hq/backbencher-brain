// script/m60/objc-ontology-census.ts — DERIV_EXPORTS_OBJC's own instrument.
//
// WHY THIS EXISTS. `script/m14/firing-check-v2.mjs` is the arbiter the workstream
// names, and it grades ONE channel: `res.relationships`. Two of the ten
// production relationship types travel on `ParseResult.imports` and
// `ParseResult.exports` instead, so the instrument reports them "silent" and
// cannot see them. Worse, its lane config for this lane reads `[".m"]` only, so
// the 207 `.h` files in the same corpus — 52% of the admitted universe — are
// outside its sample entirely. A number from it is therefore a number about a
// SUBSET, and a subset is not a verdict.
//
// This instrument reads the ADMITTED UNIVERSE through the PRODUCTION entry —
// `parseFile` from src/ast/pool-worker.ts, i.e. getParser -> parse -> analyze
// plus the worker's own noise filter and routing — and reports, for the whole
// universe, with no sampling:
//
//   * per-relationship-type counts AND the files each count came from;
//   * `imports[]` and `exports[]` on their own channels, separately;
//   * endpoint resolution in BOTH directions per type, against the emitting
//     file's own symbols and against the whole-corpus symbol set, with the
//     target shapes a name lookup cannot resolve reported as their own class
//     rather than quietly counted as failures;
//   * the evidenceClass / confidence distribution per type, so the heuristic
//     fraction is a queryable number rather than a vibe;
//   * the R7 runtime checks (placeholder-literal names, empty names) on every
//     emitted symbol name and every edge endpoint;
//   * the GRAMMAR INVENTORY (distinct node.type counts, instrument A) over the
//     same trees, which is what a RULED verdict has to point at: "the construct
//     is absent" is a claim about node types the grammar emits, not about a
//     pattern that failed to match.
//
// Admission is the ROUTER's, imported from src/ast/language-detection.ts, not an
// extension list re-implemented here: a census that samples a different universe
// from production measures a universe nobody indexes.
//
// NO REGEXP (lane rule 1, and the instrument's own argument). String
// startsWith/endsWith/includes and split only. A pattern over source text
// matches comments and string literals, which is how an analyzer lies.
//
// Usage: bun script/m60/objc-ontology-census.ts [--trees=0] [--files=N]
// Writes: validation/m60/results/objc-ontology-census.json
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { getParser } from "../../src/ast/engine"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories/objc"
const OUT = path.join(ROOT, "validation/m60/results/objc-ontology-census.json")

const argFlag = (f: string, d: string): string => {
  const a = process.argv.find((x) => x.startsWith(`--${f}=`))
  return a ? a.slice(f.length + 3) : d
}
const WITH_TREES = argFlag("trees", "1") !== "0"
void WITH_TREES
const FILE_LIMIT = Number(argFlag("files", "0"))

/** The ten production relationship types, read from the enum analyzers use. */
const TYPES = [
  "calls", "extends", "implements", "uses", "imports", "exports",
  "contains", "references", "overrides", "instantiates",
]

// ============================================================================
// Endpoint classification
// ============================================================================
// A name lookup cannot resolve three target shapes, and the family contract
// (CSS `references` resolving at both ends 66.8% of the time) is meaningless if
// those are counted as failures. So each side of every edge is placed in exactly
// one class and the classes are reported side by side.
//
//   local     — the name IS a symbol the emitting file publishes
//   corpus    — the name is a symbol SOME admitted file publishes (cross-file)
//   qualified — `Owner.member`, both halves resolve (overrides shape)
//   selector  — a message selector or a method symbol (`saveUser:`) — the name
//               names a member, and ObjC selectors are fragmented by design, so
//               they resolve only inside the class that declares them
//   path      — a filesystem path (`Foundation/Foundation.h`)
//   scope     — this lane's declared file-scope spelling (`root`, `global`)
//   unresolved— neither end of the corpus declares it. Reported loudly.
type Side = "local" | "corpus" | "qualified" | "selector" | "path" | "scope" | "unresolved"

function classify(name: string, localNames: Set<string>, corpusNames: Set<string>, localQualified: Set<string>): Side {
  if (!name) return "unresolved"
  if (name === "root" || name === "global") return "scope"
  if (localNames.has(name) || localQualified.has(name)) return "local"
  if (name.includes("/")) return "path"
  // `Owner.member` — an overrides source/target. Resolve the tail locally, which
  // is the shape that actually matters (the row names a member of a class).
  const dot = name.lastIndexOf(".")
  if (dot > 0) {
    const tail = name.slice(dot + 1)
    const head = name.slice(0, dot)
    if (localNames.has(tail) && localNames.has(head)) return "qualified"
  }
  if (name.endsWith(":")) return "selector"
  if (corpusNames.has(name)) return "corpus"
  if (localNames.has(name)) return "local"
  return "unresolved"
}

// R7: a placeholder literal in a name-bearing field becomes a symbol or an edge
// endpoint that does not exist in the source. The census spells the marker out
// here instead of pattern-matching it: `script/m60/sentinel-census.ts` reads it
// as /^(?:<|\()?unknown(?:\)|>)?$/i over a STRING LITERAL, i.e. the bare token
// with optional angle/round brackets. Reproduced with String ops so this file
// stays regex-free.
function isPlaceholderName(name: string): boolean {
  let s = name.trim().toLowerCase()
  while (s.length > 0 && (s.startsWith("<") || s.startsWith("("))) s = s.slice(1)
  while (s.length > 0 && (s.endsWith(">") || s.endsWith(")"))) s = s.slice(0, -1)
  return s === "unknown"
}

type TypeRow = {
  count: number
  files: number
  exampleFiles: string[]
  confidence: Record<string, number>
  evidenceClass: Record<string, number>
  lineNumbered: number
  source: Record<Side, number>
  target: Record<Side, number>
  placeholderEndpoints: number
  emptyEndpoints: number
  distinctSources: number
  distinctTargets: number
  /** Target strings the emitting file's own tree does not contain in ANY node. */
  fabricated: number
  fabricatedExamples: string[]
}

function newTypeRow(): TypeRow {
  const side = () => ({ local: 0, corpus: 0, qualified: 0, selector: 0, path: 0, scope: 0, unresolved: 0 } as Record<Side, number>)
  return {
    count: 0, files: 0, exampleFiles: [], confidence: {}, evidenceClass: {},
    lineNumbered: 0, source: side(), target: side(),
    placeholderEndpoints: 0, emptyEndpoints: 0, distinctSources: 0, distinctTargets: 0,
    fabricated: 0, fabricatedExamples: [],
  }
}

// ============================================================================
// The FABRICATION test
// ============================================================================
// Endpoint RESOLUTION answers "does a symbol exist with this name somewhere".
// It cannot answer the sharper question a consumer cares about: was this name
// INVENTED? The test is the emitting file's OWN TREE — if no node in the tree
// that produced the edge carries the target text, the analyzer named something
// the source does not contain.
//
// It is scoped honestly. A target can be a correct name that no single node
// carries: a dotted `Owner.member` override pair is two node texts joined, and a
// selector `saveUser:` is a sequence of node texts joined with a colon. Both are
// therefore checked on their SEGMENTS, and the segment test is what "occurs in
// the file" has to mean for a name the analyzer composes.
function occursInFile(target: string, nodeTexts: Set<string>): boolean {
  if (!target) return false
  if (nodeTexts.has(target)) return true
  if (target.includes(".")) {
    const parts = target.split(".").filter((p) => p.length > 0)
    if (parts.length > 1 && parts.every((p) => nodeTexts.has(p))) return true
  }
  if (target.includes(":")) {
    const parts = target.split(":").filter((p) => p.length > 0)
    if (parts.length > 0 && parts.every((p) => nodeTexts.has(p))) return true
  }
  return false
}

// ============================================================================
// Corpus walk
// ============================================================================
type UniverseFile = { abs: string; rel: string; repo: string; ext: string }

function walkCorpus(root: string, out: UniverseFile[]): void {
  const visit = (dir: string): void => {
    let entries: any[]
    try { entries = readdirSync(dir, { withFileTypes: true }) as any[] } catch { return }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { visit(p); continue }
      const ext = path.extname(e.name).toLowerCase()
      if (ext !== ".m" && ext !== ".mm" && ext !== ".h") continue
      let size = 0
      try { size = statSync(p).size } catch { continue }
      if (size > 1024 * 1024) continue
      out.push({
        abs: p,
        rel: p.slice(root.length + 1),
        repo: p.slice(root.length + 1).split(path.sep)[0] === "" ? "(root)" : p.slice(root.length + 1).split(path.sep)[0],
        ext,
      })
    }
  }
  visit(root)
}

async function main(): Promise<void> {
  const universe: UniverseFile[] = []
  walkCorpus(CORPUS_ROOT, universe)
  universe.sort((a, b) => (a.rel < b.rel ? -1 : 1))
  const sampled = FILE_LIMIT > 0 ? universe.slice(0, FILE_LIMIT) : universe

  // ---- PASS 0: admission, through the router itself -----------------------
  const admitted: UniverseFile[] = []
  const rejectedByExt: Record<string, number> = {}
  const headCache = new Map<string, string>()
  for (const f of universe) {
    let content = headCache.get(f.abs)
    if (content === undefined) {
      try { content = readFileSync(f.abs, "utf8") } catch { content = "" }
      headCache.set(f.abs, content)
    }
    if (detectLanguageFromPath(f.abs, content) === "objective-c") admitted.push(f)
    else rejectedByExt[f.ext] = (rejectedByExt[f.ext] ?? 0) + 1
  }
  // The `.h` split is reported separately because it is the population the
  // shared firing check cannot see, and its size is the whole reason this
  // instrument exists.
  const admittedByExt: Record<string, number> = {}
  const admittedByRepo: Record<string, number> = {}
  for (const f of admitted) {
    admittedByExt[f.ext] = (admittedByExt[f.ext] ?? 0) + 1
    admittedByRepo[f.repo] = (admittedByRepo[f.repo] ?? 0) + 1
  }

  // ---- PASS 1: production parseFile over the admitted universe -------------
  type PerFile = {
    rel: string; ok: boolean; reason?: string
    symbols: any[]; relationships: any[]; imports: any[]; exports: any[]
  }
  const perFile: PerFile[] = []
  for (const f of (FILE_LIMIT > 0 ? admitted.slice(0, FILE_LIMIT) : admitted)) {
    try {
      const res: any = await parseFile(f.abs, CORPUS_ROOT)
      perFile.push({
        rel: f.rel, ok: true,
        symbols: res.symbols ?? [], relationships: res.relationships ?? [],
        imports: res.imports ?? [], exports: res.exports ?? [],
      })
    } catch (e: any) {
      perFile.push({ rel: f.rel, ok: false, reason: String(e?.message ?? e).slice(0, 160), symbols: [], relationships: [], imports: [], exports: [] })
    }
  }

  // Corpus symbol-name set, for the cross-file half of endpoint resolution.
  // Built from PRODUCTION output, not from a private walk, so "resolves in the
  // corpus" means "some admitted file's analyzer published this name".
  const corpusNames = new Set<string>()
  for (const p of perFile) for (const s of p.symbols) if (typeof s?.name === "string" && s.name) corpusNames.add(s.name)

  // ---- PASS 2: grammar inventory (instrument A for RULED verdicts) --------
  // Distinct node.type counts over the SAME admitted trees. This is what a
  // "the grammar never emits a node for this construct" ruling points at.
  //
  // The per-file node-TEXT set is collected here too, because it is what makes
  // the fabrication test above possible without a second parse.
  const nodeTypes = new Map<string, number>()
  const nodeTypeFiles = new Map<string, Set<string>>()
  const nodeTextsByFile = new Map<string, Set<string>>()
  let treeFiles = 0, treeHasError = 0
  {
    const parser = await getParser("objective-c")
    for (const f of admitted) {
      let content = headCache.get(f.abs)
      if (content === undefined) { try { content = readFileSync(f.abs, "utf8") } catch { content = "" } }
      let tree: any
      try { tree = (parser as any).parse(content, f.abs) } catch { continue }
      treeFiles++
      if (tree?.rootNode?.hasError) treeHasError++
      const texts = new Set<string>()
      const stack: any[] = [tree.rootNode]
      let guard = 0
      while (stack.length > 0 && guard++ < 4_000_000) {
        const n = stack.pop()
        if (!n) continue
        nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
        let set = nodeTypeFiles.get(n.type)
        if (!set) { set = new Set(); nodeTypeFiles.set(n.type, set) }
        if (set.size < 4) set.add(f.rel)
        if (n.namedChildCount > 0) {
          // Only COMPOSITE-and-leaf node texts, and only nodes that can name a
          // thing: a whole `compound_statement`'s text would make every target
          // "present" and the test would be vacuous.
          const t = n.text
          if (t && t.length <= 200) texts.add(t)
        } else if (n.text) {
          texts.add(n.text)
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
      nodeTextsByFile.set(f.rel, texts)
    }
  }

  // ---- PASS 3: tally -------------------------------------------------------
  const rows = new Map<string, TypeRow>()
  for (const t of TYPES) rows.set(t, newTypeRow())
  const filesWithType = new Map<string, Set<string>>()
  for (const t of TYPES) filesWithType.set(t, new Set())
  const importFiles = new Set<string>()
  const exportFiles = new Set<string>()
  let importCount = 0, exportCount = 0
  let r7SymbolPlaceholder = 0, r7SymbolEmpty = 0
  const r7SymbolExamples: string[] = []
  let totalRelationships = 0, totalSymbols = 0, totalImports = 0, totalExports = 0

  for (const p of perFile) {
    if (!p.ok) continue
    totalSymbols += p.symbols.length
    totalRelationships += p.relationships.length
    const nodeTexts = nodeTextsByFile.get(p.rel) ?? new Set<string>()
    const localNames = new Set<string>()
    const localQualified = new Set<string>()
    for (const s of p.symbols) {
      if (typeof s?.name !== "string" || s.name.length === 0) { r7SymbolEmpty++; continue }
      if (isPlaceholderName(s.name)) {
        r7SymbolPlaceholder++
        if (r7SymbolExamples.length < 10) r7SymbolExamples.push(`${p.rel}: ${s.name} (${String(s.kind)})`)
      }
      localNames.add(s.name)
      if (typeof s?.ownerName === "string" && s.ownerName) localQualified.add(`${s.ownerName}.${s.name}`)
    }
    for (const r of p.relationships) {
      const t = String(r?.type ?? r?.relationshipType ?? "")
      if (!t) continue
      const row = rows.get(t) ?? rows.set(t, newTypeRow()).get(t)!
      if (!filesWithType.has(t)) filesWithType.set(t, new Set())
      filesWithType.get(t)!.add(p.rel)
      row.count++
      if (row.exampleFiles.length < 4 && !row.exampleFiles.includes(p.rel)) row.exampleFiles.push(p.rel)
      if (typeof r?.line_number === "number" && r.line_number > 0) row.lineNumbered++
      const conf = String(r?.confidence ?? "none")
      row.confidence[conf] = (row.confidence[conf] ?? 0) + 1
      const ev = String((r?.metadata as any)?.evidenceClass ?? "none")
      row.evidenceClass[ev] = (row.evidenceClass[ev] ?? 0) + 1
      const src = String(r?.source ?? "")
      const tgt = String(r?.target ?? "")
      for (const [k, v] of [[src, "source"], [tgt, "target"]] as const) {
        const side = classify(k, localNames, corpusNames, localQualified)
        row[v][side]++
        if (k.length === 0) row.emptyEndpoints++
        else if (isPlaceholderName(k)) row.placeholderEndpoints++
      }
      if (!occursInFile(tgt, nodeTexts)) {
        row.fabricated++
        if (row.fabricatedExamples.length < 6) row.fabricatedExamples.push(`${p.rel}: ${tgt}`)
      }
    }
    if (p.imports.length) { importCount += p.imports.length; importFiles.add(p.rel) }
    if (p.exports.length) { exportCount += p.exports.length; exportFiles.add(p.rel) }
    totalImports += p.imports.length
    totalExports += p.exports.length
  }

  // distinct source/target names per type
  const distinct = new Map<string, { s: Set<string>; t: Set<string> }>()
  for (const t of TYPES) distinct.set(t, { s: new Set(), t: new Set() })
  for (const p of perFile) {
    if (!p.ok) continue
    for (const r of p.relationships) {
      const k = String(r?.type ?? r?.relationshipType ?? "")
      const d = distinct.get(k)
      if (!d) continue
      d.s.add(String(r?.source ?? ""))
      d.t.add(String(r?.target ?? ""))
    }
  }
  for (const [t, row] of rows) {
    const d = distinct.get(t)!
    row.distinctSources = d.s.size
    row.distinctTargets = d.t.size
    row.files = filesWithType.get(t)?.size ?? 0
  }

  const report = {
    instrument: "script/m60/objc-ontology-census.ts",
    corpus: CORPUS_ROOT,
    entry: "src/ast/pool-worker.ts parseFile (getParser -> parse -> analyze + worker noise filter)",
    admission: "src/ast/language-detection.ts detectLanguageFromPath(filePath, content) === objective-c",
    sampled: sampled.length,
    universe: {
      filesConsidered: universe.length,
      admitted: admitted.length,
      admittedByExt,
      admittedByRepo,
      rejectedByExt,
    },
    run: {
      parsed: perFile.filter((p) => p.ok).length,
      failed: perFile.filter((p) => !p.ok).map((p) => ({ file: p.rel, reason: p.reason })),
      symbols: totalSymbols,
      relationships: totalRelationships,
    },
    relationshipChannel: Object.fromEntries(
      [...rows.entries()].map(([t, r]) => [t, {
        count: r.count,
        files: r.files,
        exampleFiles: r.exampleFiles,
        lineNumbered: r.lineNumbered,
        confidence: r.confidence,
        evidenceClass: r.evidenceClass,
        sourceResolution: r.source,
        targetResolution: r.target,
        distinctSources: r.distinctSources,
        distinctTargets: r.distinctTargets,
        placeholderEndpoints: r.placeholderEndpoints,
        emptyEndpoints: r.emptyEndpoints,
        fabricatedTargets: r.fabricated,
        fabricatedExamples: r.fabricatedExamples,
      }]),
    ),
    sideChannels: {
      imports: { count: importCount, files: importFiles.size },
      exports: { count: exportCount, files: exportFiles.size },
    },
    r7: {
      symbolNamesEmpty: r7SymbolEmpty,
      symbolNamesPlaceholder: r7SymbolPlaceholder,
      symbolPlaceholderExamples: r7SymbolExamples,
    },
    grammarInventory: WITH_TREES
      ? {
          filesParsed: treeFiles,
          filesWithErrorNodes: treeHasError,
          distinctNodeTypes: nodeTypes.size,
          nodeTypes: Object.fromEntries([...nodeTypes.entries()].sort((a, b) => b[1] - a[1])),
          nodeTypeExampleFiles: Object.fromEntries([...nodeTypeFiles.entries()]),
        }
      : null,
  }

  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(report, null, 2))

  // ---- console summary ----------------------------------------------------
  console.log(`objc ontology census  corpus=${CORPUS_ROOT}`)
  console.log(`  considered ${universe.length}  admitted ${admitted.length}  by ext ${JSON.stringify(admittedByExt)}`)
  console.log(`  by repo ${JSON.stringify(admittedByRepo)}`)
  console.log(`  parsed ${report.run.parsed}/${admitted.length}  symbols ${totalSymbols}  relationships ${totalRelationships}`)
  console.log(`  side channels: imports ${importCount} in ${importFiles.size} files · exports ${exportCount} in ${exportFiles.size} files`)
  console.log(`\n  ${"type".padEnd(13)} ${"count".padStart(7)} ${"files".padStart(6)}  source-resolution / target-resolution`)
  for (const t of TYPES) {
    const r = rows.get(t)!
    const s = r.source, tg = r.target
    const fmt = (o: Record<Side, number>) => Object.entries(o).filter(([, n]) => n > 0).map(([k, n]) => `${k}:${n}`).join(" ")
    console.log(`  ${t.padEnd(13)} ${String(r.count).padStart(7)} ${String(r.files).padStart(6)}  ${fmt(s)} | ${fmt(tg)}`)
    if (r.count > 0) console.log(`      conf ${JSON.stringify(r.confidence)} ev ${JSON.stringify(r.evidenceClass)} line ${r.lineNumbered}/${r.count} fabricated ${r.fabricated} r7 ${r.placeholderEndpoints}/${r.emptyEndpoints} e.g. ${r.exampleFiles.slice(0, 2).join(", ")}`)
    if (r.fabricated > 0) console.log(`      fabricated targets e.g. ${r.fabricatedExamples.slice(0, 3).join("  ·  ")}`)
  }
  console.log(`\n  R7: empty symbol names ${r7SymbolEmpty}  placeholder symbol names ${r7SymbolPlaceholder}`)
  console.log(`  grammar: ${report.grammarInventory!.distinctNodeTypes} distinct node types over ${treeFiles} files, ${treeHasError} with ERROR nodes`)
  console.log(`\nwrote ${OUT}`)
}

await main()