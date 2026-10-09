/**
 * EXPORT-NAME STATUS — what an `exports` edge names, measured with the FIXTURE
 * RUNNER'S OWN admission rule.
 *
 * ## The question this file exists to price
 *
 * `script/m14/run-fixtures.ts:1476-1541` runs an invariant on EVERY fixture in every
 * language: every exported name must resolve to a TOP-LEVEL symbol, and a bare member name is
 * refused with "membership rides Contains". lua's `export-edges` and `export-shapes` fixtures
 * fail it on nine names:
 *
 *   export-edges  -> ["greet","farewell"]
 *   export-shapes -> ["fromDoBlock","fromLoop","alpha","beta","gamma","nested"]
 *
 * and the gate reads 52 unresolved `exports` edges for the lane. So the ontology has to say
 * whether an export is a SYMBOL or a NAME, and the two readings cost different things:
 *
 *   (a) AN EXPORT MUST BE A SYMBOL — then every export name no symbol carries is a defect in
 *       the analyzer that emitted it, and its edge can never be verified against a key space.
 *   (b) AN EXPORT IS AN IMPORTABLE NAME, symbol or not — then the invariant is too strict for
 *       a language whose module surface is a NAME LIST, and the arbiter must verify a name no
 *       symbol answers.
 *
 * ## Why the runner's path, not `parseFile`
 *
 * This probe calls `getParser(lang)` -> `analyzer.analyze(root, content, label)` with the SAME
 * label shape the runner uses, and reads the analyzer's RAW symbols. That is not a detail: the
 * invariant tests `s.ownerName`, and `pool-worker.parseFile` REWRITES it
 * (`ownerName: s.ownerName || s.scope`), while the runner sees what the analyzer emitted. A
 * probe built on `parseFile` therefore classifies owner-less symbols as members and reports a
 * cost that does not exist. The first version of this file did exactly that and reported 39 of
 * lua's 62 export entries as "MEMBER" — corrected here rather than worked around.
 *
 * ## The three classes it counts
 *
 *   TOP-LEVEL  the invariant's own admitted set: no owner, an owner that is a
 *              namespace/module symbol, or an owner equal to the file itself.
 *   MEMBER     a symbol carries the name under an owner the invariant refuses.
 *   NO-SYMBOL  no symbol in the file carries the name at all.
 *
 * Counted over `result.exports` AND over the `exports` EDGES, because the fixture invariant
 * reads the former and the incoming gate reads the latter.
 *
 * Usage:
 *   npx tsx validation/m14/census/exports-ruling/export-name-status.ts --file=lua <path.lua>
 *   npx tsx validation/m14/census/exports-ruling/export-name-status.ts <lang> <corpusDir> <ext> [maxFiles]
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join } from "node:path"

const ROOT = new URL("../../../../", import.meta.url).pathname
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const fileArg = argv.find((a) => a.startsWith("--file="))?.slice("--file=".length)
const rest = argv.filter((a) => !a.startsWith("--"))

/** The runner's analyzer resolution: `src/ast/real-<lang>-analyzer.ts`, class matching /Analyzer$/. */
async function analyzerFor(lang: string): Promise<{ analyze: (root: any, content: string, label: string, ctx?: any) => any }> {
  const mod: any = await import(`${ROOT}src/ast/real-${lang}-analyzer.ts`)
  const Cls = Object.values(mod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name)) as any
  if (!Cls) throw new Error(`no analyzer class in real-${lang}-analyzer.ts`)
  return new Cls()
}

/**
 * THE INVARIANT, transcribed from `run-fixtures.ts:1476-1541`. Every clause here is the
 * runner's own, including the JS-family exemption, because a probe that measures a stricter or
 * looser rule than the one that fails is measuring a different question.
 */
function invariantInputs(lang: string, result: any, fileLabel: string): {
  topLevelNames: Set<string>
  reasons: Map<string, "no-owner" | "namespace-owner" | "module-owner" | "file-scope-unit">
  symbols: any[]
} {
  const symbols: any[] = result.symbols ?? []
  const nsNames = new Set(symbols.filter((s: any) => s.metadata?.isCSharpNamespace).map((s: any) => s.name))
  const moduleNames = new Set(
    symbols
      .filter((s: any) => s.kind === "module" || s.kind === "Module" || s.kind === "namespace" || s.kind === "Namespace")
      .map((s: any) => s.name),
  )
  const isFileScopeUnit = (s: any) => !!s.ownerName && s.ownerName === fileLabel
  const topLevelNames = new Set<string>()
  const reasons = new Map<string, "no-owner" | "namespace-owner" | "module-owner" | "file-scope-unit">()
  for (const s of symbols) {
    if (typeof s?.name !== "string" || s.name.length === 0) continue
    if (!s.ownerName) { topLevelNames.add(s.name); reasons.set(s.name, "no-owner"); continue }
    if (nsNames.has(s.ownerName)) { topLevelNames.add(s.name); reasons.set(s.name, "namespace-owner"); continue }
    if (moduleNames.has(s.ownerName)) { topLevelNames.add(s.name); reasons.set(s.name, "module-owner"); continue }
    if (isFileScopeUnit(s)) { topLevelNames.add(s.name); reasons.set(s.name, "file-scope-unit") }
  }
  void lang
  return { topLevelNames, reasons, symbols }
}

// ------------------------------------------------------------------ single-file mode

if (fileArg) {
  const [lang, absPath] = fileArg.split(":")
  const content = readFileSync(absPath, "utf8")
  const { getParser } = await import(`${ROOT}src/ast/engine.ts`)
  const parser = await getParser(lang)
  const tree = await parser.parse(content, absPath)
  const label = `fixtures/${lang}/${basename(absPath)}`
  const analyzer = await analyzerFor(lang)
  const result = await analyzer.analyze(tree.rootNode, content, label, undefined)
  const { topLevelNames, reasons, symbols } = invariantInputs(lang, result, label)
  const exportNames: string[] = (result.exports ?? []).map((e: any) => e.name)
  const edges = (result.relationships ?? []).filter((r: any) => r.type === "exports")

  console.log(`file:   ${absPath}`)
  console.log(`label:  ${label}   (the runner's own label shape)`)
  console.log(`symbols: ${symbols.length}   exports entries: ${exportNames.length}   exports edges: ${edges.length}`)
  console.log(``)
  console.log(`SYMBOLS (name | kind | ownerName/scope | line)`)
  for (const s of symbols.slice(0, 40)) {
    console.log(`  ${String(s.name).padEnd(34)} | ${String(s.kind ?? s.type).padEnd(9)} | owner=${JSON.stringify(s.ownerName ?? null)} scope=${JSON.stringify(s.scope ?? null)}`)
  }
  console.log(``)
  console.log(`EXPORT NAMES AND WHAT ANSWERS THEM`)
  for (const n of exportNames) {
    const cls = topLevelNames.has(n) ? `TOP-LEVEL (${reasons.get(n)})` : symbols.some((s: any) => s.name === n) ? "MEMBER" : "NO SYMBOL"
    console.log(`  ${String(n).padEnd(24)} ${cls}`)
  }
  console.log(``)
  console.log(`EXPORTS EDGES (from -> target | marker)`)
  for (const e of edges) {
    const cls = topLevelNames.has(e.target) ? `TOP-LEVEL (${reasons.get(e.target)})` : symbols.some((s: any) => s.name === e.target) ? "MEMBER" : "NO SYMBOL"
    console.log(`  ${String(e.source).padEnd(14)} -> ${String(e.target).padEnd(22)} ${cls}  [${Object.keys(e.metadata ?? {}).sort().join("+")}]`)
  }
  process.exit(0)
}

// ------------------------------------------------------------------ corpus mode

const [lang, corpusDir, ext, maxFilesArg] = rest
const MAX = Number(maxFilesArg ?? 60)

/**
 * THE FLEET MODE's lane table, transcribed from `script/m14/firing-check.mjs`'s LANES map
 * (lane -> [language, corpus checkout, extensions]) so a lane's population here is the SAME
 * population the firing instrument measures. Transcribed rather than imported because
 * firing-check.mjs is an executable script, not a module — and a lane whose corpus root is
 * re-chosen must be re-chosen in both places, which the header of this run prints.
 */
/** [parser language, analyzer FILE slug, corpus checkout, extensions] — the parser language and
 *  the analyzer file differ for `make` (`getParser("make")`, `real-makefile-analyzer.ts`), which a
 *  2-field table got wrong by silently reporting a wiring failure as a zero. */
const LANES: Record<string, [string, string, string, string]> = {
  BASH: ["bash", "bash", "bash-completion", ".sh,.bash"], FSHARP: ["fsharp", "fsharp", "fsharp", ".fs,.fsi,.fsx"],
  ZIG: ["zig", "zig", "zig", ".zig"], LUA: ["lua", "lua", "kong", ".lua"], JULIA: ["julia", "julia", "julia", ".jl"],
  NIM: ["nim", "nim", "nim", ".nim"], PHP: ["php", "php", "phpunit", ".php"], POWERSHELL: ["powershell", "powershell", "powershell", ".ps1,.psm1"],
  R_LANG: ["r", "r", "ggplot2", ".r,.R"], DART: ["dart", "dart", "dart-sdk", ".dart"], SQL: ["sql", "sql", "duckdb", ".sql"],
  GRAPHQL: ["graphql", "graphql", "gql-gqlgen", ".graphql,.gql"], PROTOBUF: ["protobuf", "protobuf", "pb-googleapis", ".proto"],
  JSON_B: ["json", "json", "shadcn-svelte", ".json"], YAML: ["yaml", "yaml", "ansible", ".yml,.yaml"],
  CSS_B: ["css", "css", "pico", ".css"], SCSS: ["scss", "scss", "bulma", ".scss"], HCL: ["hcl", "hcl", "terragrunt", ".hcl,.tf"],
  MAKE: ["make", "makefile", "otp", "Makefile,.mk"], TOML_B: ["toml", "toml", "cargo", ".toml"], XML_B: ["xml", "xml", "libxslt", ".xml"],
  MARKDOWN_B: ["markdown", "markdown", "redwood", ".md"], CLEAN_B: ["clean", "clean", "Clyde", ".icl,.dcl"],
  // THE INVARIANT'S OWN ORIGIN: the JVM/C# family whose type-owned members it refuses. The
  // firing-check corpus names for these lanes (`java-lib`, `kotlin`, `scala`, `groovy`,
  // `csharp-sample`) DO NOT EXIST on this machine, so the clause was first measured as 0 over
  // lanes that never reach it. These entries point at checkouts that DO exist, chosen by
  // extension count (grails-core 200 .java, kotlinx-coroutines 200 .kt, cats-effect 200
  // .scala, geb 200 .groovy, gql-graphql-dotnet 200 .cs) — a clause whose own population is
  // missing must be measured somewhere it is present, or its zero is a statement about the
  // file system.
  JAVA: ["java", "java", "java-lib", ".java"], JAVA_GRAILS: ["java", "java", "grails-core", ".java"],
  JAVA_GRAPHQLJAVA: ["java", "java", "graphql-java", ".java"],
  GROOVY: ["groovy", "groovy", "groovy", ".groovy"], GROOVY_GEB: ["groovy", "groovy", "geb", ".groovy"],
  KOTLIN: ["kotlin", "kotlin", "kotlin", ".kt,.kts"], KOTLIN_KX: ["kotlin", "kotlin", "kotlinx-coroutines", ".kt,.kts"],
  SCALA: ["scala", "scala", "scala", ".scala"], SCALA_CATS: ["scala", "scala", "cats-effect", ".scala"],
  CSHARP: ["csharp", "csharp", "csharp-sample", ".cs"], CSHARP_GQL: ["csharp", "csharp", "gql-graphql-dotnet", ".cs"],
  JAVASCRIPT: ["javascript", "javascript", "lodash", ".js,.mjs"],
  TYPESCRIPT: ["typescript", "typescript", "typescript", ".ts,.tsx"], PYTHON: ["python", "python", "python-codesql", ".py"],
  GO: ["go", "go", "go-stdlib", ".go"], RUST: ["rust", "rust", "ripgrep", ".rs"], RUBY: ["ruby", "ruby", "ruby", ".rb"],
  ERLANG: ["erlang", "erlang", "otp", ".erl,.hrl"], ELIXIR: ["elixir", "elixir", "elixir", ".ex,.exs"],
  HASKELL: ["haskell", "haskell", "haskell", ".hs"], SWIFT: ["swift", "swift", "swift-corpus", ".swift"],
  C: ["c", "c", "sqlite", ".c,.h"], CPP: ["cpp", "cpp", "cpp-example", ".cpp,.cc,.h"],
  SOLIDITY: ["solidity", "solidity", "solidity", ".sol"],
}

const laneArg = argv.find((a) => a.startsWith("--lanes="))
const perArg = argv.find((a) => a.startsWith("--per="))
const FLEET = laneArg ? laneArg.slice("--lanes=".length).split(",").map((x) => x.trim().toUpperCase()).filter(Boolean) : null
const PER = perArg ? Number(perArg.slice("--per=".length)) : 40
if (!FLEET && (!lang || !corpusDir || !ext)) {
  console.error("usage: export-name-status.ts --file=<lang>:<path> | <lang> <corpusDir> <ext> [maxFiles] | --lanes=LUA,FSHARP,... [--per=N]")
  process.exit(2)
}

function pickFiles(dir: string, exts: string, want: number, cap = 400): { files: string[]; total: number } {
  const extList = exts.split(",")
  const POP_CAP = 20000
  const all: string[] = []
  const walk = (d: string, depth: number): void => {
    if (all.length >= POP_CAP || depth > 20) return
    let ents: any[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (all.length >= POP_CAP) return
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git/.test(e.name)) walk(p, depth + 1) }
      else if (extList.some((x) => e.name.endsWith(x))) { try { if (statSync(p).size < 400_000) all.push(p) } catch {} }
    }
  }
  walk(dir, 0)
  all.sort()
  const total = all.length
  if (total <= want) return { files: all.slice(0, cap), total }
  const stride = total / want
  const out: string[] = []
  for (let i = 0; i < want; i++) out.push(all[Math.floor(i * stride)])
  return { files: [...new Set(out)].slice(0, cap), total }
}

/** One lane's row, over the firing instrument's corpus and draw. */
async function measureLane(lang: string, slug: string, corpusDir: string, ext: string, maxFiles: number): Promise<any> {
  const abs = join(CR, corpusDir)
  const { files, total } = pickFiles(abs, ext, maxFiles)
  const { getParser } = await import(`${ROOT}src/ast/engine.ts`)
  const parser = await getParser(lang)
  const analyzer = await analyzerFor(slug)
  const e = { entries: 0, toplevel: 0, member: 0, none: 0 } as Counts
  const g = { entries: 0, toplevel: 0, member: 0, none: 0 } as Counts
  const noSymbol = new Map<string, number>()
  let parsed = 0
  let failed = 0
  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { failed++; continue }
    let root: any
    try { root = (await parser.parse(content, f)).rootNode } catch { failed++; continue }
    let result: any
    try { result = await analyzer.analyze(root, content, `fixtures/${lang}/${basename(f)}`, undefined) } catch { failed++; continue }
    parsed++
    const { topLevelNames, symbols } = invariantInputs(lang, result, `fixtures/${lang}/${basename(f)}`)
    const names = new Set(symbols.map((s: any) => s.name))
    const classify = (n: string): "toplevel" | "member" | "none" =>
      topLevelNames.has(n) ? "toplevel" : names.has(n) ? "member" : "none"
    for (const x of result.exports ?? []) {
      const n = String(x?.name ?? "")
      if (!n) continue
      e.entries++
      e[classify(n)]++
      if (classify(n) === "none") noSymbol.set(n, (noSymbol.get(n) ?? 0) + 1)
    }
    for (const r of result.relationships ?? []) {
      if (String(r?.type ?? "") !== "exports") continue
      const n = String(r?.target ?? "")
      if (!n) continue
      g.entries++
      g[classify(n)]++
    }
  }
  return { lang, corpusDir, ext, parsed, failed, sampled: files.length, corpusTotal: total, exportEntries: e, exportEdges: g, noSymbolNames: noSymbol.size }
}

if (FLEET) {
  const rows: any[] = []
  for (const lane of FLEET) {
    const spec = LANES[lane]
    if (!spec) { rows.push({ lane, error: "not in the LANES table" }); continue }
    try {
      const r = await measureLane(spec[0], spec[1], spec[2], spec[3], PER)
      rows.push({ lane, ...r })
    } catch (err) {
      rows.push({ lane, error: String((err as Error)?.message ?? err).slice(0, 90) })
    }
  }
  const tot = rows.reduce(
    (a: any, r: any) => {
      if (r.error) return a
      a.entries += r.exportEntries.entries; a.toplevel += r.exportEntries.toplevel
      a.member += r.exportEntries.member; a.none += r.exportEntries.none
      a.edges += r.exportEdges.entries; a.edgeTop += r.exportEdges.toplevel
      a.edgeMember += r.exportEdges.member; a.edgeNone += r.exportEdges.none
      a.files += r.parsed
      return a
    },
    { entries: 0, toplevel: 0, member: 0, none: 0, edges: 0, edgeTop: 0, edgeMember: 0, edgeNone: 0, files: 0 },
  )
  const out = {
    command: `npx tsx validation/m14/census/exports-ruling/export-name-status.ts --lanes=${FLEET.join(",")} --per=${PER}`,
    population: { lanes: rows.length, filesParsed: tot.files, perLaneDraw: PER, corpus: "each lane's firing-check corpus, even stride" },
    totals: tot,
    rows,
  }
  if (JSON_OUT) console.log(JSON.stringify(out, null, 2))
  else {
    console.log(`export-name status — FLEET (${rows.length} lanes, ${tot.files} files parsed, ${PER}-file even stride per lane)`)
    console.log(``)
    console.log(`lane        corpus            files  exports(entries)  top-level  MEMBER  NO SYMBOL | edges  resolved-by-name  member  NO SYMBOL`)
    for (const r of rows) {
      if (r.error) { console.log(`${r.lane.padEnd(11)} ${r.error}`); continue }
      const e = r.exportEntries, g = r.exportEdges
      console.log(
        `${r.lane.padEnd(11)} ${String(r.corpusDir).padEnd(17)} ${String(r.parsed).padStart(5)}  ${String(e.entries).padStart(15)}  ${String(e.toplevel).padStart(9)}  ${String(e.member).padStart(6)}  ${String(e.none).padStart(9)} | ${String(g.entries).padStart(5)}  ${String(g.toplevel).padStart(16)}  ${String(g.member).padStart(6)}  ${String(g.none).padStart(9)}`,
      )
    }
    console.log(``)
    console.log(`TOTALS      entries ${tot.entries}  top-level ${tot.toplevel}  MEMBER ${tot.member}  NO SYMBOL ${tot.none}`)
    console.log(`            edges   ${tot.edges}  top-level ${tot.edgeTop}  MEMBER ${tot.edgeMember}  NO SYMBOL ${tot.edgeNone}`)
  }
  process.exit(0)
}

const abs = join(CR, corpusDir)
const { files, total } = pickFiles(abs, ext, MAX)
const { getParser } = await import(`${ROOT}src/ast/engine.ts`)
const parser = await getParser(lang)
const analyzer = await analyzerFor(lang)

type Counts = { entries: number; toplevel: number; member: number; none: number }
const e = { entries: 0, toplevel: 0, member: 0, none: 0 } as Counts
const g = { entries: 0, toplevel: 0, member: 0, none: 0 } as Counts
const noneNames = new Map<string, number>()
const memberOwners = new Map<string, number>()
const invariantFailures = new Map<string, number>()
let parsed = 0
let failed = 0

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { failed++; continue }
  let root: any
  try { root = (await parser.parse(content, f)).rootNode } catch { failed++; continue }
  let result: any
  try { result = await analyzer.analyze(root, content, `fixtures/${lang}/${basename(f)}`, undefined) } catch { failed++; continue }
  parsed++
  const { topLevelNames, symbols } = invariantInputs(lang, result, `fixtures/${lang}/${basename(f)}`)
  const names = new Set(symbols.map((s: any) => s.name))
  const ownerOf = new Map<string, string>(symbols.filter((s: any) => s.name).map((s: any) => [s.name, String(s.ownerName ?? "")]))
  const classify = (n: string): "toplevel" | "member" | "none" =>
    topLevelNames.has(n) ? "toplevel" : names.has(n) ? "member" : "none"

  for (const x of result.exports ?? []) {
    const n = String(x?.name ?? "")
    if (!n) continue
    e.entries++
    e[classify(n)]++
    if (classify(n) === "none") noneNames.set(n, (noneNames.get(n) ?? 0) + 1)
    if (classify(n) === "member") memberOwners.set(`${n} <- ${ownerOf.get(n)}`, (memberOwners.get(`${n} <- ${ownerOf.get(n)}`) ?? 0) + 1)
  }
  for (const r of result.relationships ?? []) {
    if (String(r?.type ?? "") !== "exports") continue
    const n = String(r?.target ?? "")
    if (!n) continue
    g.entries++
    g[classify(n)]++
  }
  for (const n of new Set((result.exports ?? []).map((x: any) => String(x?.name ?? "")).filter(Boolean))) {
    if (classify(n) === "none") invariantFailures.set(n, (invariantFailures.get(n) ?? 0) + 1)
  }
}

const top = (m: Map<string, number>, n: number): [string, number][] =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)

const report = {
  command: `npx tsx validation/m14/census/exports-ruling/export-name-status.ts ${lang} ${corpusDir} ${ext} ${MAX}`,
  lang, corpusDir, ext,
  population: { parsed, failed, sampled: files.length, corpusTotal: total, strideSample: MAX > 0 && total > MAX },
  exportEntries: e,
  exportEdges: g,
  topNoSymbolNames: top(noneNames, 20),
  topMemberOwners: top(memberOwners, 15),
  /** how many DISTINCT names the fixture invariant would refuse per file, summed */
  invariantRefusalNameInstances: [...invariantFailures.values()].reduce((a, b) => a + b, 0),
  invariantRefusalDistinctNames: invariantFailures.size,
}

if (JSON_OUT) console.log(JSON.stringify(report, null, 2))
else {
  const P = report.population
  console.log(`export-name status — ${lang} (${corpusDir})`)
  console.log(`population: ${P.parsed} parsed of ${P.sampled} sampled (corpus has ${P.corpusTotal} ${ext} files; ${P.strideSample ? "even stride" : "WHOLE CORPUS"})   failures ${P.failed}`)
  console.log(``)
  console.log(`result.exports ENTRIES   ${String(e.entries).padStart(7)}   top-level ${e.toplevel}   MEMBER ${e.member}   NO SYMBOL ${e.none}`)
  console.log(`exports EDGE TARGETS     ${String(g.entries).padStart(7)}   top-level ${g.toplevel}   MEMBER ${g.member}   NO SYMBOL ${g.none}`)
  console.log(`fixture invariant would refuse: ${report.invariantRefusalNameInstances} name instance(s) / ${report.invariantRefusalDistinctNames} distinct name(s)`)
  console.log(``)
  if (report.topNoSymbolNames.length) {
    console.log(`TOP NO-SYMBOL NAMES (an export whose name no symbol in the file carries)`)
    for (const [n, c] of report.topNoSymbolNames) console.log(`  ${String(c).padStart(4)}  ${JSON.stringify(n)}`)
    console.log(``)
  }
  if (report.topMemberOwners.length) {
    console.log(`TOP MEMBER-NAMED EXPORTS (name <- owner)`)
    for (const [n, c] of report.topMemberOwners) console.log(`  ${String(c).padStart(4)}  ${n}`)
  }
}
