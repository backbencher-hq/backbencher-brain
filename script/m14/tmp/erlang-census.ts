// ER3 wave — the corpus census: analyzer vs the independent oracle.
//
// Answers, per corpus file, the two questions the milestone bars are written in:
//   UNEXPLAINED  every edge the analyzer emits that the oracle cannot derive
//                (fabrication class — the analyzer inventing a relationship)
//   MISSING      every edge the oracle derives that the analyzer does not emit
//                (loss class — a real relationship the analyzer drops)
//   UNKNOWN SYMBOLS  every emitted symbol whose name has no declaration site in
//                the parse tree (a symbol that names nothing)
//   NODE COVERAGE    which of the grammar census's node types the walk entered,
//                cross-checked against the analyzer's referenced types and the
//                spec's silent list
//
// Usage:
//   bun run script/m14/tmp/erlang-census.ts [--files N] [--corpus a,b] [--out P]
import * as fs from "fs"
import * as path from "path"
import { RealErlangAnalyzer } from "../../../src/ast/real-erlang-analyzer"
import { oracleAnalyze, type OracleEdge } from "../erlang-truth-oracle"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPO_ROOT = "/home/sano/ishaq/bb_tests/repositories"

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt
}
const FILE_LIMIT = parseInt(arg("files", "200"), 10)
const CORPORA = arg("corpus", "rebar3,cowboy,otp").split(",")
const OUT = arg("out", "")

function collect(corpora: string[]): string[] {
  const out: string[] = []
  for (const d of corpora) {
    const base = path.join(REPO_ROOT, d)
    if (!fs.existsSync(base)) continue
    const stack = [base]
    while (stack.length > 0) {
      const cur = stack.pop()!
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
      for (const e of entries) {
        if (e.name === ".git") continue
        const p = path.join(cur, e.name)
        if (e.isDirectory()) stack.push(p)
        // `.hrl` as well as `.erl`. The include fragments are 291 files of this
        // corpus and they are the heart of ER-D32's domain — a header with no
        // `-module` at all — so leaving them out of the differential meant the
        // ruling that matters most for them was the one ruling never verified by two
        // independent implementations. The M60 line gate already reads them
        // (`*.erl`, `*.hrl`), which is how the omission became visible.
        else if (e.name.endsWith(".erl") || e.name.endsWith(".hrl")) out.push(p)
      }
    }
  }
  out.sort()
  // Chunking, because the WASM parser cannot be trusted to survive a whole corpus
  // in one process. Three separate failures forced this:
  //
  //  - one reused parser returned no tree for 422 of 4,326 files;
  //  - `parser.delete()` on an instance an aborted parse had already torn down
  //    raised "Out of bounds memory access" and killed a 70-minute run;
  //  - and after enough of those, `new Parser()` ITSELF started failing with
  //    "call_indirect to a signature that does not match" — the module's function
  //    table is corrupted once parsers have been deleted.
  //
  // Recycling inside one process is therefore not safe with this web-tree-sitter.
  // Chunking is: each chunk is a fresh process with a fresh module, the chunks
  // tile the file list exactly (no stride, so nothing is skipped and nothing is
  // double-counted), and a chunk that dies costs one chunk rather than the run.
  // The driver is `erlang-census-all.sh`, which skips chunks whose JSON already
  // exists — so the whole thing is restartable, which a 70-minute job on a shared
  // box has to be.
  const offset = parseInt(arg("offset", "0"), 10)
  const chunk = parseInt(arg("chunk", "0"), 10)
  const chunks = parseInt(arg("chunks", "0"), 10)
  if (chunks > 0) {
    const all = out
    const per = Math.ceil(all.length / chunks)
    const from = offset * per
    return all.slice(from, from + per)
  }
  // No chunking requested: an even stride across the whole draw, so no corpus is
  // over-represented and the sample is reproducible from the file list alone.
  const stride = Math.max(1, Math.floor(out.length / FILE_LIMIT))
  return out.filter((_, i) => i % stride === 0).slice(0, FILE_LIMIT)
}

const ek = (e: { type?: any; source?: any; target?: any; line_number?: any; metadata?: any }): string =>
  `${e.type}|${e.source}|${e.target}`
const elk = (e: OracleEdge): string => `${e.type}|${e.source}|${e.target}|${e.line}|${e.arity ?? ""}`

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const langBytes = fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))
  const lang = await L.load(langBytes)
  let parser = new P()
  parser.setLanguage(lang)
  // A single reused parser silently failed to return a tree for 422 of the 4,326
  // corpus files — 9.8% of the corpus never reached EITHER lens, and nothing in
  // the report said so. The skip set is a property of parser state, not of the
  // files, so it is not reproducible and it is not safe to quote a "full corpus"
  // number from it. The parser is therefore rebuilt every PARSER_RECYCLE files,
  // which bounds any state corruption to well under 1%, and every file that still
  // yields no tree is RECORDED so the report can state exactly how many files it
  // actually examined. An instrument that cannot say what it skipped is not an
  // instrument.
  const analyzer = new RealErlangAnalyzer()

  const files = collect(CORPORA)
  const unexplained: string[] = []
  const missing: string[] = []
  const lineMismatch: string[] = []
  const unknownSymbols: string[] = []
  const symbolMismatch: string[] = []
  const typesSeen = new Map<string, number>()
  let nFiles = 0
  let nParsed = 0
  const noTree: string[] = []
  let nErr = 0
  let nSymbols = 0
  let nEdges = 0
  let nOracleEdges = 0
  // ER-D35: remote calls through a macro module have no derivable callee. The
  // oracle counts them instead of inventing one, and the census reports the
  // number so a deliberately-empty class cannot be mistaken for a coverage win.
  let nMacroModuleRemotes = 0
  let nGrammarDamaged = 0
  const t0 = Date.now()
  const perCorpus = new Map<string, { files: number; symbols: number; edges: number; ms: number }>()

  for (const file of files) {
    let content: string
    try { content = fs.readFileSync(file, "utf8") } catch { continue }
    nFiles++
    const corpus = path.relative(REPO_ROOT, file).split(path.sep)[0]
    // `rel` is needed by the no-tree accounting BELOW, so it is computed before the
    // parse. It was declared after, which made the throw path a ReferenceError —
    // and the throw path is exactly the one this instrument exists to count, so
    // the bug fired only when it mattered: the run died on the first file whose
    // parse threw, taking the whole census with it, after 40 minutes of work.
    const rel = path.relative(REPO_ROOT, file)
    const c0 = Date.now()
    // ONE parser for the whole chunk, never deleted. Deleting it corrupts the
    // module (see the note in `collect`), and a chunk is small enough that a
    // parser that degrades costs one chunk, which the driver re-runs.
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      noTree.push(`${rel} (threw)`)
      continue
    }
    if (!tree) {
      noTree.push(rel)
      continue
    }
    nParsed++
    if (tree.rootNode.hasError) nErr++
    const result: any = analyzer.analyze(tree.rootNode, content, rel)
    const oracle = oracleAnalyze(tree.rootNode, rel)
    const ms = Date.now() - c0
    const cs = perCorpus.get(corpus) ?? { files: 0, symbols: 0, edges: 0, ms: 0 }
    cs.files++
    cs.symbols += result.symbols.length
    cs.edges += result.relationships.length
    cs.ms += ms
    perCorpus.set(corpus, cs)

    const rels: any[] = result.relationships ?? []
    nSymbols += result.symbols.length
    nEdges += rels.length
    nOracleEdges += oracle.edges.length
    nMacroModuleRemotes += oracle.macroModuleRemotes
    if (oracle.grammarDamaged) nGrammarDamaged++
    for (const t of oracle.typesSeen) typesSeen.set(t, (typesSeen.get(t) ?? 0) + 1)

    // edge classes
    const aSet = new Set(rels.map(ek))
    const oSet = new Set(oracle.edges.map(elk))
    const oLoose = new Set(oracle.edges.map(ek))
    for (const r of rels) {
      if (!oLoose.has(ek(r)) && unexplained.length < 400) {
        unexplained.push(`${rel}: ${ek(r)} @${r.line_number ?? "-"} ${JSON.stringify(r.metadata ?? {})}`)
      }
    }
    for (const e of oracle.edges) {
      if (!aSet.has(ek(e))) {
        if (missing.length < 400) missing.push(`${rel}: ${elk(e)}`)
        continue
      }
      // line contract: for an edge the analyzer emits, does SOME emitted edge
      // carry the oracle's line?
      const want = `${e.type}|${e.source}|${e.target}|${e.line}`
      let found = false
      for (const r of rels) {
        if (ek(r) === `${e.type}|${e.source}|${e.target}` && r.line_number === e.line) { found = true; break }
      }
      if (!found && lineMismatch.length < 200) lineMismatch.push(`${rel}: want ${want}`)
    }
    void oSet

    // symbols
    const aSyms = new Set((result.symbols as any[]).map((s: any) => `${s.kind}|${s.name}|${s.ownerName ?? ""}`))
    const oSyms = new Set(oracle.symbols.map((s) => `${s.kind}|${s.name}|${s.ownerName ?? ""}`))
    for (const s of result.symbols as any[]) {
      if (!oSyms.has(`${s.kind}|${s.name}|${s.ownerName ?? ""}`) && symbolMismatch.length < 300) {
        symbolMismatch.push(`${rel}: analyzer ${s.kind} ${s.name} owner=${s.ownerName ?? "-"} NOT in oracle`)
      }
      void aSyms
    }
    for (const s of oracle.symbols) {
      if (!aSyms.has(`${s.kind}|${s.name}|${s.ownerName ?? ""}`) && symbolMismatch.length < 300) {
        symbolMismatch.push(`${rel}: oracle ${s.kind} ${s.name} owner=${s.ownerName ?? "-"} NOT in analyzer`)
      }
    }
  }
  const elapsed = Date.now() - t0

  const lines: string[] = []
  lines.push(
    `# ER3 corpus census — ${nFiles} files read, ${nParsed} examined by BOTH lenses, ${nErr} with a grammar error` +
      (noTree.length ? `, **${noTree.length} yielded no tree and were NOT examined**` : ", 0 unexamined"),
  )
  lines.push(`corpora: ${CORPORA.join(", ")}  |  wall ${elapsed} ms  |  ${(elapsed / Math.max(1, nFiles)).toFixed(1)} ms/file`)
  lines.push("")
  lines.push("| metric | value |")
  lines.push("|---|---|")
  lines.push(`| symbols emitted | ${nSymbols} |`)
  lines.push(`| relationships emitted | ${nEdges} |`)
  lines.push(`| oracle-derived relationships | ${nOracleEdges} |`)
  lines.push(`| UNEXPLAINED (analyzer-only) | ${unexplained.length}${unexplained.length >= 400 ? "+" : ""} |`)
  lines.push(`| MISSING (oracle-only) | ${missing.length}${missing.length >= 400 ? "+" : ""} |`)
  lines.push(`| line-contract mismatches | ${lineMismatch.length} |`)
  lines.push(`| symbol mismatches | ${symbolMismatch.length} |`)
  lines.push(`| ruled-empty: macro-module remotes (ER-D35) | ${nMacroModuleRemotes} |`)
  lines.push(`| whole-file grammar damage (no top-level form survives) | ${nGrammarDamaged} |`)
  lines.push("")
  lines.push("## per corpus")
  lines.push("")
  lines.push("| corpus | files | symbols | relationships | ms | ms/file |")
  lines.push("|---|---|---|---|---|---|")
  for (const [k, v] of [...perCorpus.entries()].sort()) {
    lines.push(`| ${k} | ${v.files} | ${v.symbols} | ${v.edges} | ${v.ms} | ${(v.ms / Math.max(1, v.files)).toFixed(1)} |`)
  }
  const section = (title: string, arr: string[]) => {
    lines.push("")
    lines.push(`## ${title} (${arr.length})`)
    lines.push("")
    if (arr.length === 0) {
      lines.push("_none_")
      return
    }
    lines.push("```")
    for (const a of arr.slice(0, 120)) lines.push(a)
    if (arr.length > 120) lines.push(`… ${arr.length - 120} more`)
    lines.push("```")
  }
  // A tally by (relationship type) turns "922 missing" into a class. Without it
  // the only way to learn the shape of a gap is to re-run and read 120 samples.
  const tally = (arr: string[]) => {
    const m = new Map<string, number>()
    for (const a of arr) {
      const t = (a.split("|")[1] ?? "?").trim()
      m.set(t, (m.get(t) ?? 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  const byType = (label: string, arr: string[]) => {
    if (arr.length === 0) return
    lines.push("")
    lines.push(`### ${label} by relationship type (${arr.length} total)`)
    lines.push("")
    lines.push("| type | count |")
    lines.push("|---|---|")
    for (const [t, c] of tally(arr)) lines.push(`| ${t} | ${c} |`)
  }
  byType("UNEXPLAINED", unexplained)
  byType("MISSING", missing)
  section("UNEXAMINED — no tree, so neither lens saw this file", noTree)
  section("UNEXPLAINED — analyzer emits, oracle cannot derive", unexplained)
  section("MISSING — oracle derives, analyzer does not emit", missing)
  section("LINE mismatches", lineMismatch)
  section("SYMBOL mismatches", symbolMismatch)
  lines.push("")
  lines.push(`## distinct node types entered by the oracle walk: ${typesSeen.size}`)
  lines.push("")
  lines.push([...typesSeen.keys()].sort().map((t) => `\`${t}\``).join(" "))
  const md = lines.join("\n") + "\n"
  console.log(md)
  if (OUT) {
    // Machine-readable, so `erlang-census-all.sh` can aggregate chunks without
    // scraping this report's tables. The disagreement LISTS are included, not just
    // the counts: a chunk that disagrees must be diagnosable from its own output.
    const j: any = {
      chunk: parseInt(arg("offset", "0"), 10) + 1,
      chunks: parseInt(arg("chunks", "0"), 10),
      corpora: CORPORA,
      filesRead: nFiles,
      parsed: nParsed,
      grammarErrors: nErr,
      symbols: nSymbols,
      relationships: nEdges,
      oracleRelationships: nOracleEdges,
      unexplained: unexplained.length,
      missing: missing.length,
      lineMismatch: lineMismatch.length,
      symbolMismatch: symbolMismatch.length,
      noTree: noTree.length,
      macroModuleRemotes: nMacroModuleRemotes,
      grammarDamaged: nGrammarDamaged,
      perCorpus: Object.fromEntries(perCorpus.entries()),
      unexplainedSample: unexplained.slice(0, 200),
      missingSample: missing.slice(0, 200),
      lineMismatchSample: lineMismatch.slice(0, 200),
      symbolMismatchSample: symbolMismatch.slice(0, 200),
      noTreeSample: noTree.slice(0, 200),
    }
    fs.writeFileSync(OUT, JSON.stringify(j, null, 2) + "\n")
    console.log(`chunk json: ${OUT}`)
  }

  if (OUT && !OUT.endsWith(".json")) {
    fs.writeFileSync(OUT, md)
    console.log(`wrote ${OUT}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
