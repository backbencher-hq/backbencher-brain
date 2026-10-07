/**
 * ENUM_HARD_FIX census — the instrument for JOB 1 and for the `brain_import`
 * verdict. LANE-LOCAL (typescript lane), NOT shared machinery: nothing else
 * imports it and it edits no shared file.
 *
 * WHAT IT MEASURES, and why this file exists at all
 * ------------------------------------------------
 * `script/m14/firing-check.mjs` answers one question — which of the ten labels
 * come out of the production path — and it tallies against
 * `RelationshipType` read from `src/ast/types.ts`. That is correct only if the
 * analyzers' emitted strings are VALUES of that enum. They are not: the enum's
 * tenth value is `brain_import`, and the analyzers emit `imports`. So
 * firing-check's "SILENT (constructible but produced nothing)" line is a
 * measurement of the ENUM, not of the analyzer, and it names an edge that the
 * analyzer emits thousands of times per corpus as missing.
 *
 * So this census reports the RAW label string every edge carries, and then
 * asks three separate questions about it:
 *   - is it a value of `src/ast/types.ts`'s `RelationshipType`?
 *   - is it a value of `src/ast/engine.ts`'s `ASTEngine.RelationshipType`?
 *   - is it one of the ten ontology labels?
 * A verdict is only allowed to rest on which of those three answered yes.
 *
 * It also carries the per-type resolution / confidence / R7 measurements for
 * questions 4, 5 and 6 of the workstream doc, and the construct census (the
 * node types the GRAMMAR admits, measured over the corpus, consulting neither
 * the analyzer nor any oracle) so a ruling can be falsified.
 *
 * NO REGEX. File selection is `path.extname`; corpus membership is
 * `git ls-files`; label membership is `Set.has` on an exact string; the R7
 * placeholder test is a Set lookup plus a `charCodeAt(0)` class test. There is
 * not one regular expression in this file, and the reason is the standing rule:
 * a regex over source text matches comments and string literals and misses
 * nested syntax, so an instrument built from one cannot be trusted to say what
 * the tree said.
 *
 * Usage:
 *   npx tsx script/m14/ts-enumhardfix-census.mts --repo typescript --out X.json
 *   npx tsx script/m14/ts-enumhardfix-census.mts --repo typescript --grammar
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync, readdirSync, existsSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "..", "..")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_FILTER = argOf("--repo") ?? "typescript"
const OUT = argOf("--out")
const LIMIT = Number(argOf("--limit") ?? "0")
const DO_GRAMMAR = argv.includes("--grammar")
/** pool-worker's own full-AST ceiling: above 1 MB production does NOT run the
 *  analyzer, it runs `extractFallback`. Admitting a 2.3 MB `lib.dom.d.ts`
 *  through the analyzer would measure a path production never takes. */
const FULL_AST_LIMIT = 1024 * 1024

const TEN = ["calls", "extends", "implements", "uses", "imports", "exports", "contains", "references", "overrides", "instantiates"]
const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"]

// ------------------------------------------------------------------ corpus
type F = { label: string; abs: string; ext: string }
const admitted: F[] = []
const skippedOverCap: string[] = []
const repoDir = path.join(CORPUS_ROOT, REPO_FILTER)
if (!existsSync(repoDir)) {
  console.error(`no corpus repo at ${repoDir}`)
  process.exit(2)
}
const tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)
for (const rel of tracked) {
  const abs = path.join(repoDir, rel)
  const ext = path.extname(rel).toLowerCase()
  if (!TS_EXTS.includes(ext)) continue
  let size = 0
  try {
    size = statSync(abs).size
  } catch {
    continue
  }
  if (size > FULL_AST_LIMIT) {
    skippedOverCap.push(`${REPO_FILTER}/${rel} (${size} bytes > ${FULL_AST_LIMIT})`)
    continue
  }
  admitted.push({ label: `${REPO_FILTER}/${rel}`, abs, ext })
}
const capped = LIMIT ? admitted.slice(0, LIMIT) : admitted

// --------------------------------------------------------------- the enums
const typesMod: any = await import(path.join(ROOT, "src/ast/types.ts"))
const engineMod: any = await import(path.join(ROOT, "src/ast/engine.ts"))
const TypesEnum: Record<string, string> = typesMod.RelationshipType
const EngineEnum: Record<string, string> = (engineMod.ASTEngine as any).RelationshipType
const typesValues = new Set<string>(Object.values(TypesEnum))
const engineValues = new Set<string>(Object.values(EngineEnum))
const tenSet = new Set(TEN)

console.log("=" .repeat(100))
console.log("THE ENUM, MEASURED (two declarations of one concept)")
console.log("-".repeat(100))
console.log(`src/ast/types.ts   RelationshipType values: ${[...new Set(Object.values(TypesEnum))].join(" ")}`)
console.log(`src/ast/engine.ts  ASTEngine.RelationshipType: ${[...new Set(Object.values(EngineEnum))].join(" ")}`)
console.log(`same member NAMES : ${JSON.stringify(Object.keys(TypesEnum).filter((k) => !(k in EngineEnum)).length === 0 && Object.keys(EngineEnum).filter((k) => !(k in TypesEnum)).length === 0)}`)
console.log(`types.ts Imports  = ${JSON.stringify(TypesEnum.Imports)}`)
console.log(`engine.ts Imports= ${JSON.stringify(EngineEnum.Imports)}`)
const divergent = [...new Set([...Object.keys(TypesEnum), ...Object.keys(EngineEnum)])].filter(
  (k) => TypesEnum[k] !== EngineEnum[k],
)
console.log(`members whose VALUE differs between the two declarations: ${divergent.length ? divergent.map((k) => `${k}: ${TypesEnum[k]} vs ${EngineEnum[k]}`).join("  ") : "(none)"}`)
console.log()

// ------------------------------------------------------------- run the lane
const { getParser } = engineMod
const { RealTypeScriptAnalyzer } = await import(path.join(ROOT, "src/ast/real-typescript-analyzer.ts"))

type Row = {
  rawLabel: string
  count: number
  files: Set<string>
  srcResolves: number
  tgtResolves: number
  bothResolve: number
  emptyEndpoint: number
  selfLoop: number
  r7Src: number
  r7Tgt: number
  conf: Map<string, number>
  evidence: Map<string, number>
  reasons: Map<string, number>
  examples: string[]
}
const mk = (): Row => ({
  rawLabel: "", count: 0, files: new Set(), srcResolves: 0, tgtResolves: 0, bothResolve: 0,
  emptyEndpoint: 0, selfLoop: 0, r7Src: 0, r7Tgt: 0,
  conf: new Map(), evidence: new Map(), reasons: new Map(), examples: [],
})
/** every raw label observed, so a label the ontology does not list cannot hide
 *  inside a canonical-bucket tally */
const rawLabels = new Map<string, Row>()
const rows = new Map<string, Row>()
for (const t of TEN) rows.set(t, mk())

/** R7: standing rule — a placeholder literal is not a name. Exact-string set
 *  membership, plus a first-character class test written with charCodeAt so no
 *  pattern-matching over user text is involved. */
const PLACEHOLDERS = new Set([
  "", "?", "unknown", "unknown_symbol", "unknownsymbol", "<unknown>", "undefined", "null",
  "todo", "tbd", "n/a", "na", "none", "anonymous", "<anonymous>", "anonymousfunction",
  "placeholder", "xxx", "<lambda>", "lambda", "func", "fn", "symbol", "name", "value",
  "target", "source", "object", "string", "number", "any", "unknown1", "foo", "bar", "baz",
])
const isPlaceholder = (s: string): boolean => {
  const n = s.trim().toLowerCase()
  if (PLACEHOLDERS.has(n)) return true
  if (n.length === 0) return true
  const c = n.charCodeAt(0)
  // '<' (60) and '?' (63) open the shapes analyzers use for "I could not
  // resolve this": <unknown>, ??X. A real identifier never starts with either.
  return c === 60 || c === 63
}

let parsed = 0
let failed = 0
let totalSymbols = 0
let totalRels = 0
let filesWithEdges = 0
const failures: string[] = []
const parserCache = new Map<string, any>()
let cursor = 0
const t0 = Date.now()

async function worker() {
  for (;;) {
    const i = cursor++
    if (i >= capped.length) return
    const f = capped[i]
    // `.tsx` must go through the tsx grammar, which is what engine.getParser
    // does for the `tsx` language; using the plain ts grammar would measure a
    // parse production never performs.
    const lang = f.ext === ".tsx" ? "tsx" : "typescript"
    try {
      let parser = parserCache.get(lang)
      if (!parser) {
        parser = await getParser(lang as any)
        parserCache.set(lang, parser)
      }
      const content = readFileSync(f.abs, "utf8")
      const pr = await parser.parse(content, f.abs)
      const res = new RealTypeScriptAnalyzer().analyze(pr.rootNode as any, content, f.abs)
      parsed++
      const symbols: any[] = res?.symbols ?? []
      const rels: any[] = res?.relationships ?? []
      totalSymbols += symbols.length
      totalRels += rels.length
      if (rels.length) filesWithEdges++
      // Resolution: an endpoint "resolves" when it binds to a symbol THIS
      // analyzer emitted in THIS file, by emitted id or by bare name.
      const ids = new Set<string>()
      const names = new Set<string>()
      for (const s of symbols) {
        if (s?.id !== undefined) ids.add(String(s.id))
        if (s?.name !== undefined) names.add(String(s.name))
      }
      for (const r of rels) {
        const label = String(r?.relationshipType ?? r?.type ?? "")
        if (label === "") continue
        const src = String(r?.source ?? r?.from ?? r?.fromSymbol ?? "")
        const tgt = String(r?.target ?? r?.to ?? r?.toSymbol ?? "")
        const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
        for (const row of [rawLabels, rows.has(label) ? rows : new Map<string, Row>()]) {
          let s = row.get(label)
          if (!s) {
            s = mk()
            s.rawLabel = label
            row.set(label, s)
          }
          s.count++
          s.files.add(f.label)
          if (src === "" || tgt === "") s.emptyEndpoint++
          const sr = src !== "" && (ids.has(src) || names.has(src))
          const tr = tgt !== "" && (ids.has(tgt) || names.has(tgt))
          if (sr) s.srcResolves++
          if (tr) s.tgtResolves++
          if (sr && tr) s.bothResolve++
          if (src === tgt && src !== "") s.selfLoop++
          if (isPlaceholder(src)) s.r7Src++
          if (isPlaceholder(tgt)) s.r7Tgt++
          bump(s.conf, String(r?.confidence ?? "absent"))
          bump(s.evidence, String(r?.metadata?.evidenceClass ?? r?.evidenceClass ?? "absent"))
          const reason = r?.metadata?.reason ?? r?.metadata?.confidenceReason ?? r?.reason
          if (reason) bump(s.reasons, String(reason))
          if (s.examples.length < 6) s.examples.push(`${src} -> ${tgt}`)
        }
      }
    } catch (e) {
      failed++
      if (failures.length < 12) failures.push(`${f.label}: ${String(e).slice(0, 160)}`)
    }
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))
const wallMs = Date.now() - t0

// ------------------------------------------------------------------ report
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log("PRODUCTION-PATH CENSUS — getParser -> parse -> RealTypeScriptAnalyzer.analyze")
console.log(`corpus ${repoDir}`)
console.log(`admitted ${capped.length} files (${admitted.length} over the tracked set, ${skippedOverCap.length} over pool-worker's 1 MB full-AST ceiling and therefore NEVER analysed in production)`)
console.log(`parsed ${parsed}  failed ${failed}  symbols ${totalSymbols.toLocaleString()}  relationships ${totalRels.toLocaleString()}  files with edges ${filesWithEdges}  wall ${(wallMs / 1000).toFixed(1)}s`)
if (failures.length) console.log(`failures:\n  ${failures.join("\n  ")}`)
console.log()

console.log("RAW LABELS ACTUALLY EMITTED (the string on the edge, not the ten names)")
console.log("-".repeat(100))
console.log(`${pad("raw label", 16)}${pad("count", 12)}${pad("files", 8)}${pad("src%", 8)}${pad("tgt%", 8)}${pad("both%", 8)}${pad("self", 7)}${pad("R7s", 6)}${pad("R7t", 6)}${pad("types.ts", 10)}${pad("engine.ts", 10)}${pad("one-of-ten", 10)}confidence`)
for (const [label, s] of [...rawLabels.entries()].sort((a, b) => b[1].count - a[1].count)) {
  const pct = (n: number) => (s.count ? ((100 * n) / s.count).toFixed(1) : "-")
  const hist = [...s.conf.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(
    `${pad(label, 16)}${pad(s.count.toLocaleString(), 12)}${pad(String(s.files.size), 8)}${pad(pct(s.srcResolves), 8)}${pad(pct(s.tgtResolves), 8)}${pad(pct(s.bothResolve), 8)}${pad(String(s.selfLoop), 7)}${pad(String(s.r7Src), 6)}${pad(String(s.r7Tgt), 6)}${pad(typesValues.has(label) ? "YES" : "no", 10)}${pad(engineValues.has(label) ? "YES" : "no", 10)}${pad(tenSet.has(label) ? "yes" : "NO", 10)}${hist}`,
  )
}
console.log()

const report: any = {
  at: new Date().toISOString(),
  lane: "typescript",
  worktree: ROOT,
  corpusRoot: CORPUS_ROOT,
  corpusRepo: REPO_FILTER,
  filesAdmitted: capped.length,
  filesOverFullAstCeiling: skippedOverCap,
  filesParsed: parsed,
  filesFailed: failed,
  filesWithEdges,
  totalSymbols,
  totalRelationships: totalRels,
  wallMs,
  enum: {
    typesTsValues: [...new Set(Object.values(TypesEnum))],
    engineTsValues: [...new Set(Object.values(EngineEnum))],
    typesTsImports: TypesEnum.Imports,
    engineTsImports: EngineEnum.Imports,
    divergentMembers: divergent.map((k) => ({ key: k, typesTs: TypesEnum[k], engineTs: EngineEnum[k] })),
  },
  rawLabels: {},
  types: {},
  unlistedLabels: [...rawLabels.keys()].filter((k) => !tenSet.has(k)),
}

for (const [label, s] of rawLabels.entries()) {
  const entry = {
    count: s.count,
    files: s.files.size,
    fileListSample: [...s.files].slice(0, 15),
    sourceResolves: s.srcResolves,
    targetResolves: s.tgtResolves,
    bothResolve: s.bothResolve,
    emptyEndpoints: s.emptyEndpoint,
    selfLoops: s.selfLoop,
    r7Source: s.r7Src,
    r7Target: s.r7Tgt,
    isValueOfTypesTsEnum: typesValues.has(label),
    isValueOfEngineTsEnum: engineValues.has(label),
    isOneOfTheTen: tenSet.has(label),
    confidenceHistogram: Object.fromEntries(s.conf),
    evidenceClassHistogram: Object.fromEntries(s.evidence),
    confidenceReasonHistogram: Object.fromEntries([...s.reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    examples: s.examples,
  }
  report.rawLabels[label] = entry
  if (tenSet.has(label)) report.types[label] = entry
}

console.log("THE BLOCKER, AS A NUMBER")
console.log("-".repeat(100))
const brain = rawLabels.get("brain_import")
const imp = rawLabels.get("imports")
console.log(`edges labelled "imports"    : ${imp ? imp.count : 0} over ${imp ? imp.files.size : 0} files`)
console.log(`edges labelled "brain_import": ${brain ? brain.count : 0} over ${brain ? brain.files.size : 0} files`)
console.log(`"imports"    is a value of src/ast/types.ts RelationshipType : ${typesValues.has("imports")}`)
console.log(`"brain_import" is a value of src/ast/types.ts RelationshipType: ${typesValues.has("brain_import")}`)
console.log(`"imports"    is a value of src/ast/engine.ts ASTEngine.RelationshipType: ${engineValues.has("imports")}`)
console.log()

if (DO_GRAMMAR) {
  // CONSTRUCT CENSUS — consults the GRAMMAR and the CORPUS, never the analyzer
  // and never an oracle, because a construct BOTH of them forgot cannot appear
  // as a disagreement. This is the instrument a RULED verdict has to cite.
  console.log("CONSTRUCT CENSUS — node types the grammar admits, counted over the corpus")
  console.log("-".repeat(100))
  const nodeTypeCounts = new Map<string, number>()
  const nodeTypeFiles = new Map<string, Set<string>>()
  const filesWithError = new Set<string>()
  let errorNodes = 0
  let ci = 0
  const cparser = parserCache.get("typescript")
  for (const f of capped) {
    ci++
    try {
      const content = readFileSync(f.abs, "utf8")
      const pr = await cparser.parse(content, f.abs)
      const stack: any[] = [pr.rootNode]
      while (stack.length) {
        const n = stack.pop()
        const t = n.type
        nodeTypeCounts.set(t, (nodeTypeCounts.get(t) ?? 0) + 1)
        if (!nodeTypeFiles.has(t)) nodeTypeFiles.set(t, new Set())
        nodeTypeFiles.get(t)!.add(f.label)
        if (t === "ERROR" || n.isMissing) {
          errorNodes++
          filesWithError.add(f.label)
        }
        for (let k = 0; k < n.childCount; k++) stack.push(n.child(k))
      }
    } catch {
      /* counted as parsed-failure above */
    }
  }
  const nodeTypes = [...nodeTypeCounts.keys()].sort()
  console.log(`distinct node types over ${capped.length} files: ${nodeTypes.length}`)
  console.log(`ERROR/missing nodes: ${errorNodes} in ${filesWithError.size} files`)
  for (const t of [...filesWithError]) console.log(`  parse-error file: ${t}`)
  console.log()
  const interesting = [
    "import_statement", "import_alias", "import_clause", "import_specifier", "namespace_import",
    "export_statement", "export_clause", "export_specifier", "namespace_export",
    "class_heritage", "extends_clause", "extends_type_clause", "implements_clause",
    "function_declaration", "method_definition", "method_signature",
    "new_expression", "object_type", "function_type", "type_annotation", "generic_type",
    "call_expression", "decorator", "module", "internal_module", "abstract_class_declaration",
  ]
  console.log(`${pad("node type", 28)}${pad("occurrences", 13)}${pad("files", 8)}present`)
  for (const t of interesting) {
    const n = nodeTypeCounts.get(t) ?? 0
    console.log(`${pad(t, 28)}${pad(n.toLocaleString(), 13)}${pad(String(nodeTypeFiles.get(t)?.size ?? 0), 8)}${n > 0 ? "YES" : "ABSENT"}`)
  }
  console.log()
  console.log("every node type the corpus produced (for the grammar-inventory record):")
  console.log(nodeTypes.join(" "))
  report.constructCensus = {
    distinctNodeTypes: nodeTypes.length,
    errorNodes,
    filesWithErrorNodes: [...filesWithError],
    nodeTypeCounts: Object.fromEntries([...nodeTypeCounts.entries()].sort((a, b) => b[1] - a[1])),
    nodeTypeFiles: Object.fromEntries([...nodeTypeFiles.entries()].map(([k, v]) => [k, v.size])),
  }
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`wrote ${OUT}`)
}