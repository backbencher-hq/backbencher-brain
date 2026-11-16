// M14.6 perl lane instrument. Re-runnable by the next reader, which is the point
// of tracking it here (reviews/LANE-AUDIT-FORMULA.md, evidence-integrity rule 4).
//
// Paths: REPO is derived from this file's own location, so the instrument travels
// with the repo. The corpora are NOT in the repo -- they are large upstream
// checkouts -- so point BB_PERL_CORPUS at them. Everything written lands in
// BB_PERL_OUT (default /tmp), never inside the repo.
const REPO = path.resolve(import.meta.dir, "..", "..", "..")
const CORPUS = process.env.BB_PERL_CORPUS ?? "<corpus-root>/bb_tests/repositories"
const OUTDIR = process.env.BB_PERL_OUT ?? "/tmp"
/**
 * PERL CORPUS CENSUS — the measuring instrument for the Perl lane.
 *
 * One pass per corpus, through the REAL engine path (engine.parseFile-equivalent:
 * pinned wasm + RealPerlAnalyzer), recording every number the lane audit needs:
 *
 *   - files, symbols, relationships, imports, exports
 *   - parse-error files + error nodes (grammar damage census)
 *   - zero-unknown-symbol counts (unknown kind / empty name / member w/o owner)
 *   - symbol-free files and their legitimacy class
 *   - NODE-TYPE CENSUS (F8): every node type the corpus actually contains
 *   - FIELD CENSUS: every field the corpus actually contains
 *   - relationship-type census and the count of relationships carrying a LINE
 *   - call-target census: targets never declared in the corpus (phantom surface)
 *
 * usage: npx tsx census.mts [--corpus mojo,perl5] [--limit N] [--out file.json]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const CORPUS_ROOT = process.env.BB_PERL_CORPUS ?? "<corpus-root>/bb_tests/repositories"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const language: any = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm")))
const parser = new ParserClass()
parser.setLanguage(language)

const { RealPerlAnalyzer } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

const PERL_EXTS = new Set(["pm", "pl", "t", "PL", "psgi", "pod"])

/**
 * The ext set is production's, exactly: src/ast/language-detection.ts:42 maps
 * only pl|pm|t|perl to perl, so `.PL` is NOT a perl file to the engine. This
 * census read ["pm","pl","t","PL"] for perl5 and Moose — 92 extra files (91 of
 * them perl5's) that the engine never routes, which is why its file total
 * disagreed with lineless.mts and with the F5 lane. Dropping PL makes all three
 * instruments describe ONE surface, and the 92 files are named here rather than
 * quietly dropped: they are real Perl that the product does not index, and if
 * routing ever changes, this is the line to move.
 */
export const CORPORA: Record<string, { dir: string; exts: string[]; pinned: string }> = {
  mojo: { dir: path.join(CORPUS_ROOT, "mojo"), exts: ["pm", "pl", "t"], pinned: "93f591742a7dbc0cee36875ab80a38f0666e32ae" },
  plack: { dir: path.join(CORPUS_ROOT, "plack"), exts: ["pm", "pl", "t"], pinned: "c821514" },
  perl5: { dir: path.join(CORPUS_ROOT, "perl5"), exts: ["pm", "pl", "t"], pinned: "b1e4db661a9beb6426fc04fd63853a68e55ad13e" },
  // PERL-ONTO: the `cpan/<Dist-Name>` paths do not exist on this box -- the
  // checkouts are at `moose/` and `moo/` -- so this instrument printed
  // `SKIP Moose-2.4000` and `SKIP Moo-2.005005` and went on. A SKIP is not a
  // zero and it is not a pass; it is the absence of a measurement, and it is why
  // this lane's own 7-corpus totals were 4,846 files rather than 5,913 and why
  // `implements` had no census at all. Same defect as perl-lineoracle.mts, same
  // cause, fixed in the same wave.
  Moose: { dir: path.join(CORPUS_ROOT, "moose"), exts: ["pm", "pl", "t"], pinned: "fadfec9" },
  Moo: { dir: path.join(CORPUS_ROOT, "moo"), exts: ["pm", "pl", "t"], pinned: "f0c9e7b" },
  "Catalyst-Runtime-5.90132": { dir: path.join(CORPUS_ROOT, "cpan/Catalyst-Runtime-5.90132"), exts: ["pm", "pl", "t"], pinned: "cpan:sha256:bb83758b7bda360d" },
  "DBI-1.654": { dir: path.join(CORPUS_ROOT, "cpan/DBI-1.654"), exts: ["pm", "pl", "t"], pinned: "cpan:sha256:da853ff382ae8000" },
}

function walk(dir: string, exts: string[], out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === ".git") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, exts, out, depth + 1)
    else if (exts.includes(e.name.split(".").pop()!)) out.push(p)
  }
  return out
}

/** Every node type and field the corpus actually contains. */
function treeCensus(root: any) {
  const types = new Set<string>()
  const fields = new Set<string>()
  const fieldPairs = new Set<string>()
  const stack: any[] = [root]
  let nodeCount = 0
  while (stack.length) {
    const n = stack.pop()
    nodeCount++
    types.add(n.type)
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (!c) continue
      if (n.isNamed && c.isNamed) {
        const f = n.fieldNameForNamedChild(i)
        if (f) {
          fields.add(f)
          fieldPairs.add(`${n.type}.${f}`)
        }
      }
      stack.push(c)
    }
  }
  return { types, fields, fieldPairs, nodeCount }
}

const arg = (k: string, d?: string) => {
  const i = process.argv.indexOf(k)
  return i >= 0 ? process.argv[i + 1] : d
}
const only = arg("--corpus")?.split(",")
const limit = arg("--limit") ? parseInt(arg("--limit")!) : 0
const outFile = arg("--out", (process.env.BB_PERL_OUT ?? "/tmp") + "/perl-census.json")!

const knownKinds = new Set<string>(Object.values(ASTEngine.SymbolKind as Record<string, string>))
const validRelTypes = new Set<string>(Object.values(ASTEngine.RelationshipType as Record<string, string>))

const allCorpusTypes = new Set<string>()
const allCorpusFields = new Set<string>()
const allCorpusFieldPairs = new Set<string>()
const summary: any = {}

for (const [name, cfg] of Object.entries(CORPORA)) {
  if (only && !only.includes(name)) continue
  if (!fs.existsSync(cfg.dir)) {
    console.error(`SKIP ${name}: ${cfg.dir} missing`)
    continue
  }
  let files = walk(cfg.dir, cfg.exts)
  files.sort()
  const all = files.length
  if (limit) files = files.slice(0, limit)

  let symbols = 0, relationships = 0, imports = 0, exports = 0
  let errFiles = 0, errNodes = 0, crashFiles = 0
  let unknownKind = 0, emptyName = 0, memberWithoutOwner = 0, unknownRelType = 0
  let relWithLine = 0, symWithParams = 0, paramsTotal = 0
  let symWithDecorators = 0
  let subsWithSig = 0
  let paramNames = 0
  const symbolFreeFiles: string[] = []
  const errFileList: string[] = []
  const crashList: string[] = []
  const relTypes = new Map<string, number>()
  const symKinds = new Map<string, number>()
  const declaredNames = new Set<string>()
  const callTargets = new Map<string, number>()
  const callTargetFiles = new Map<string, Set<string>>()
  const importModules = new Set<string>()
  let nodeTotal = 0
  const corpusTypes = new Set<string>()
  const corpusFields = new Set<string>()
  const corpusFieldPairs = new Set<string>()
  let totalBytes = 0
  let missingPosSymbols = 0

  for (const f of files) {
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    totalBytes += Buffer.byteLength(src)
    let res: any
    try {
      const tree = parser.parse(src)
      res = new RealPerlAnalyzer().analyze(tree.rootNode, src, f)
      const cen = treeCensus(tree.rootNode)
      for (const t of cen.types) { corpusTypes.add(t); allCorpusTypes.add(t) }
      for (const t of cen.fields) { corpusFields.add(t); allCorpusFields.add(t) }
      for (const t of cen.fieldPairs) allCorpusFieldPairs.add(t)
      nodeTotal += cen.nodeCount
    } catch (e) {
      crashFiles++
      crashList.push(`${path.relative(cfg.dir, f)}: ${(e as Error).message}`)
      continue
    }
    const rel = path.relative(cfg.dir, f)
    if ((res.errors ?? []).length) {
      errFiles++
      errNodes += res.errors.length
      errFileList.push(rel)
    }
    if (res.symbols.length === 0) symbolFreeFiles.push(rel)
    symbols += res.symbols.length
    relationships += res.relationships.length
    imports += (res.imports ?? []).length
    exports += (res.exports ?? []).length
    for (const s of res.symbols) {
      const k = String(s.kind)
      symKinds.set(k, (symKinds.get(k) ?? 0) + 1)
      if (!knownKinds.has(k)) unknownKind++
      if (!s.name || !String(s.name).trim()) emptyName++
      if (s.ownerName && s.ownerName !== s.name) memberWithoutOwner += s.ownerName ? 0 : 1
      if (!s.range || s.range.startLine === undefined) missingPosSymbols++
      if (s.parameters && s.parameters.length) {
        symWithParams++
        paramsTotal += s.parameters.length
      }
      if (s.decorators && s.decorators.length) symWithDecorators++
      if (s.parameters && s.parameters.length) { subsWithSig++ ; paramNames += s.parameters.length }
      declaredNames.add(String(s.name))
      if (s.ownerName) declaredNames.add(`${s.ownerName}::${s.name}`)
    }
    for (const r of res.relationships) {
      const t = String(r.type)
      relTypes.set(t, (relTypes.get(t) ?? 0) + 1)
      if (!validRelTypes.has(t)) unknownRelType++
      if (typeof (r as any).line_number === "number" && (r as any).line_number > 0) relWithLine++
      if (t === "calls" || t === "instantiates") {
        const tgt = String(r.target)
        callTargets.set(tgt, (callTargets.get(tgt) ?? 0) + 1)
        if (!callTargetFiles.has(tgt)) callTargetFiles.set(tgt, new Set())
        callTargetFiles.get(tgt)!.add(String(r.source))
      }
    }
    for (const i of res.imports ?? []) importModules.add(i.module)
  }

  // Phantom surface: call targets that are never declared as a symbol anywhere in
  // this corpus. These are the edges the product cannot resolve.
  const unresolved = [...callTargets.entries()]
    .filter(([t]) => !declaredNames.has(t) && !declaredNames.has(t.split(".")[0]))
    .map(([t, n]) => ({ target: t, edges: n, files: callTargetFiles.get(t)!.size }))
    .sort((a, b) => b.edges - a.edges)

  summary[name] = {
    dir: cfg.dir,
    pinned: cfg.pinned,
    filesTotal: all,
    filesMeasured: files.length,
    bytes: totalBytes,
    nodes: nodeTotal,
    symbols,
    relationships,
    imports,
    exports,
    importModules: importModules.size,
    parseErrorFiles: errFiles,
    parseErrorNodes: errNodes,
    crashFiles,
    symbolFreeFiles: symbolFreeFiles.length,
    symbolFreeList: symbolFreeFiles.slice(0, 40),
    unknownKind,
    emptyName,
    unknownRelType,
    missingPosSymbols,
    subsWithParams: symWithParams,
    paramsTotal,
    subsWithDecorators: symWithDecorators,
    subsWithParams: subsWithSig,
    paramsEmitted: paramNames,
    relationshipsWithLine: relWithLine,
    relationshipsTotal: relationships,
    symbolKinds: Object.fromEntries([...symKinds].sort((a, b) => b[1] - a[1])),
    relTypes: Object.fromEntries([...relTypes].sort((a, b) => b[1] - a[1])),
    distinctCallTargets: callTargets.size,
    unresolvedCallTargets: unresolved.length,
    unresolvedCallEdges: unresolved.reduce((a, b) => a + b.edges, 0),
    unresolvedTop: unresolved.slice(0, 40),
    errorFileList: errFileList.slice(0, 30),
    crashList: crashList.slice(0, 10),
    corpusNodeTypes: [...corpusTypes].sort(),
    corpusFields: [...corpusFields].sort(),
  }
  console.error(
    `${name}: files=${files.length} sym=${symbols} rel=${relationships} imp=${imports} exp=${exports} ` +
      `errFiles=${errFiles} errNodes=${errNodes} crashes=${crashFiles} ` +
      `symFree=${symbolFreeFiles.length} unkKind=${unknownKind} emptyName=${emptyName} unkRelType=${unknownRelType} ` +
      `relWithLine=${relWithLine}/${relationships} subsWithParams=${symWithParams} ` +
      `unresolvedTargets=${unresolved.length} (${unresolved.reduce((a, b) => a + b.edges, 0)} edges) types=${corpusTypes.size}`,
  )
}

const out = {
  generatedAt: new Date().toISOString(),
  grammar: "wasm/tree-sitter-perl.wasm",
  unionNodeTypes: [...allCorpusTypes].sort(),
  unionFields: [...allCorpusFields].sort(),
  unionFieldPairs: [...allCorpusFieldPairs].sort(),
  corpora: summary,
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 2))
console.error(`\nwrote ${outFile}`)
console.error(`union node types across corpora: ${allCorpusTypes.size}`)
console.error(`union fields: ${allCorpusFields.size}`)
