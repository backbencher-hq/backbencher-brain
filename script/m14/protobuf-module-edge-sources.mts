/**
 * THE MODULE-EDGE SOURCE ENDPOINT — `imports` and `exports`, 1,565 edges, priced.
 *
 * ## What is being asked
 *
 * Every other emitted type in this lane has had its endpoint resolution measured.
 * `imports` and `exports` were recorded as "0% by design" on the grounds that both
 * endpoints of a cross-file module edge are module paths rather than symbols of the
 * file — which is the family's convention, matching `real-css-analyzer.ts`'s
 * `importerName`. That is a claim about the TARGET, and it is correct: `protoc`
 * resolves `import "a/b.proto"` against `-I` include roots this analyzer is never
 * told, so the path as written is the only faithful name available.
 *
 * It is NOT a claim about the SOURCE, and the source was never measured. The source
 * is meant to be "the importing file", published as the file's BASENAME. Three
 * things follow, none of them measured until now:
 *
 *   1. the basename is not a published symbol id, so the edge asserts a node the
 *      index does not hold and `bb_graph` cannot walk outward from it;
 *   2. two files sharing a basename are INDISTINGUISHABLE as edge sources, which is
 *      a stated limitation in the doc carrying no count;
 *   3. the analyzer ALREADY publishes a `namespace` symbol for the file's `package`
 *      and already uses it as the owner of the file's top-level declarations
 *      (7,166 `contains` edges). So a file-local, already-published symbol stands
 *      for the file — and nothing measured whether the module edges could use it.
 *
 * This probe measures all three, and prices the alternative rather than proposing
 * it: how many of the 1,565 edges would carry a resolvable source if the source
 * were the file's own `package` namespace, how many files declare no package at
 * all, and what that substitution would COST in aggregation — because a package
 * declared by N files is one node and N files' worth of edges would land on it.
 *
 * ## The instrument
 *
 * The analyzer is driven directly, because `parseFile` DROPS per-symbol `metadata`
 * (pool-worker.ts:855-895) and `metadata.id` is the id every relationship endpoint
 * is written in. Measuring resolution against a symbol set the product does not
 * carry would understate it for every type, so both populations are reported:
 * `analyzer-direct` (endpoints vs `metadata.id`) and `production` (the edge counts
 * `parseFile` actually emits). Nothing here is regex: the package of a file is read
 * by walking the parse tree for the `package` node and taking its text.
 *
 * ## What would overturn each number
 *
 *   - `imports`/`exports` sources resolving at 0% is overturned by ANY edge whose
 *     source is already a published `metadata.id` — i.e. the claim "the source is a
 *     module path, not a symbol" is false the moment one is.
 *   - "N files declare no package" is overturned by a file-local reading of the
 *     tree that finds a package in one of them.
 *   - the aggregation cost is overturned by a package declared by more than one
 *     importing file; if that count were 0, the substitution would cost nothing and
 *     this probe would have said so.
 *
 * Reproduce: npx tsx script/m14/protobuf-module-edge-sources.mts
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/opencode/pb/module-edge-sources.json"

// ------------------------------------------------------------------ corpus walk
// Identical to protobuf-census.ts: the WORKING TREE, because three of these corpora
// are sparse checkouts whose `git ls-files` lists thousands of paths that are not
// on disk. Reading those would make the denominator a fiction.
const corpus: { repo: string; rel: string; abs: string }[] = []
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(dir)
  } catch {
    continue
  }
  if (!st.isDirectory()) continue
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop() as string
    let kids: string[]
    try {
      kids = readdirSync(cur).sort()
    } catch {
      continue
    }
    for (const k of kids) {
      const p = path.join(cur, k)
      let s: ReturnType<typeof statSync>
      try {
        s = statSync(p)
      } catch {
        continue
      }
      if (s.isDirectory()) {
        if (k === ".git" || k === "node_modules") continue
        stack.push(p)
      } else if (k.endsWith(".proto")) {
        corpus.push({ repo: entry, rel: path.relative(dir, p), abs: p })
      }
    }
  }
}

// ------------------------------------------------------------------ the grammar
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const parser = new P()
parser.setLanguage(lang)
const analyzer = new RealProtobufAnalyzer()

/** The file's own `package`, read off the tree. A parse fact, never a text scan. */
const packageOf = (root: any): string | null => {
  let found: string | null = null
  const visit = (n: any): void => {
    if (found !== null) return
    if (n.type === "package") {
      // `package foo.bar;` — the declared name is the node's text without the
      // keyword and the terminator. Taken from `message_or_enum_type`-shaped named
      // children when the grammar offers them, else the node text, so a leading
      // `package`/`;` in an ERROR node cannot silently become the name.
      const named = (n.namedChildren ?? []).map((c: any) => String(c.text))
      found = named.length ? named.join(".") : null
      return
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)
  return found
}

type ModEdge = { type: string; source: string; target: string; line: number; file: string }
const analyzerIds = new Set<string>()
const pkgOfFile = new Map<string, string | null>()
const fileOfPkg = new Map<string, Set<string>>()
const importingFiles = new Set<string>()
const modEdges: ModEdge[] = []
const prodCounts: Record<string, number> = {}
let filesOk = 0
let filesFail = 0
const kindTally: Record<string, number> = {}

for (const f of corpus) {
  const content = readFileSync(f.abs, "utf8")
  let tree: any
  try {
    tree = parser.parse(content)
  } catch {
    continue
  }
  if (!tree) continue
  let r: any
  try {
    r = analyzer.analyze(tree.rootNode, content, f.abs)
  } catch {
    tree.delete?.()
    continue
  }
  filesOk++
  for (const s of r.symbols ?? []) {
    analyzerIds.add(String(s.metadata?.id ?? s.name))
    const k = String(s.kind ?? "")
    kindTally[k] = (kindTally[k] ?? 0) + 1
  }
  const pkg = packageOf(tree.rootNode)
  pkgOfFile.set(f.abs, pkg)
  if (pkg) {
    let set = fileOfPkg.get(pkg)
    if (!set) fileOfPkg.set(pkg, (set = new Set()))
    set.add(f.abs)
  }
  const label = `${f.repo}/${f.rel}`
  for (const x of r.relationships ?? []) {
    const t = String(x.type ?? "")
    if (t !== "imports" && t !== "exports") continue
    const e: ModEdge = { type: t, source: String(x.source ?? ""), target: String(x.target ?? ""), line: Number(x.line ?? x.line_number ?? 0), file: label }
    modEdges.push(e)
    importingFiles.add(f.abs)
  }
  tree.delete?.()
  // production counts, for the population the product emits
  try {
    const pr: any = await parseFile(f.abs, path.dirname(f.abs))
    for (const x of pr?.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
      if (t === "imports" || t === "exports") prodCounts[t] = (prodCounts[t] ?? 0) + 1
    }
  } catch {
    filesFail++
  }
}

// ------------------------------------------------------------------ the measurement
const basename = (abs: string) => abs.split("/").pop() ?? abs
const basenames = new Map<string, Set<string>>()
for (const f of corpus) {
  const b = basename(f.abs)
  let set = basenames.get(b)
  if (!set) basenames.set(b, (set = new Set()))
  set.add(f.abs)
}

const perType: Record<string, { edges: number; sourceResolvesNow: number; sourceResolvesAsPackage: number; sourceHasNoPackage: number }> = {}
for (const e of modEdges) {
  const row = (perType[e.type] ??= { edges: 0, sourceResolvesNow: 0, sourceResolvesAsPackage: 0, sourceHasNoPackage: 0 })
  row.edges++
  if (analyzerIds.has(e.source)) row.sourceResolvesNow++
  const abs = corpus.find((c) => `${c.repo}/${c.rel}` === e.file)?.abs
  const pkg = abs ? pkgOfFile.get(abs) : null
  if (pkg && analyzerIds.has(pkg)) row.sourceResolvesAsPackage++
  else row.sourceHasNoPackage++
}

// What the substitution would AGGREGATE: a package declared by more than one
// importing file puts N files' module edges on one node.
const importingPkgs = new Map<string, Set<string>>()
for (const abs of importingFiles) {
  const pkg = pkgOfFile.get(abs)
  if (!pkg) continue
  let set = importingPkgs.get(pkg)
  if (!set) importingPkgs.set(pkg, (set = new Set()))
  set.add(abs)
}
const sharedImportPkgs = [...importingPkgs.entries()].filter(([, s]) => s.size > 1)
const sharedPkgSet = new Set(sharedImportPkgs.map(([p]) => p))
// The edges that WOULD aggregate onto a node already declared by another importing
// file — the price of the substitution, and it has to be counted, not assumed.
const edgesOnASharedImportPackage: Record<string, number> = {}
for (const e of modEdges) {
  const abs = corpus.find((c) => `${c.repo}/${c.rel}` === e.file)?.abs
  const pkg = abs ? pkgOfFile.get(abs) : null
  if (pkg && sharedPkgSet.has(pkg)) edgesOnASharedImportPackage[e.type] = (edgesOnASharedImportPackage[e.type] ?? 0) + 1
}

// The stated-but-unmeasured limitation: basenames shared across the corpus.
const dupBasenames = [...basenames.entries()].filter(([, s]) => s.size > 1)
const importingBasenames = new Map<string, number>()
for (const abs of importingFiles) {
  const b = basename(abs)
  importingBasenames.set(b, (importingBasenames.get(b) ?? 0) + 1)
}
const importingFilesOnDupBasename = [...importingBasenames.entries()].filter(([, n]) => n > 1)
const edgesOnDupBasename = modEdges.filter((e) => {
  const abs = corpus.find((c) => `${c.repo}/${c.rel}` === e.file)?.abs
  return abs ? (basenames.get(basename(abs))?.size ?? 0) > 1 : false
})

const report = {
  corpus: { root: CR, files: corpus.length, parsedByAnalyzer: filesOk, parseFileThrew: filesFail },
  productionEdges: prodCounts,
  analyzerDirectModuleEdges: modEdges.length,
  filesWithAModuleEdge: importingFiles.size,
  perType,
  perTypeKeys: Object.keys(perType),
  filesDeclaringPackage: [...pkgOfFile.values()].filter((v) => v !== null).length,
  filesDeclaringNoPackage: [...pkgOfFile.values()].filter((v) => v === null).length,
  distinctPackages: fileOfPkg.size,
  packagesDeclaredByMoreThanOneFile: [...fileOfPkg.values()].filter((s) => s.size > 1).length,
  importingPackages: importingPkgs.size,
  importingPackagesSharedByMoreThanOneFile: sharedImportPkgs.length,
  edgesOnASharedImportPackage,
  filesPerSharedImportPkgHistogram: (() => {
    const h: Record<string, number> = {}
    for (const [, s] of sharedImportPkgs) h[String(s.size)] = (h[String(s.size)] ?? 0) + 1
    return h
  })(),
  sharedImportPkgDetail: sharedImportPkgs.slice(0, 10).map(([p, s]) => ({ pkg: p, files: [...s].map((a) => a.replace(`${CR}/`, "")) })),
  basenamesSharedAcrossCorpus: dupBasenames.length,
  filesOnASharedBasename: [...basenames.values()].filter((s) => s.size > 1).reduce((a, s) => a + s.size, 0),
  importingFilesOnASharedBasename: importingFilesOnDupBasename.length,
  moduleEdgesWhoseSourceBasenameIsShared: edgesOnDupBasename.length,
  symbolKindTally: kindTally,
  publishedIds: analyzerIds.size,
}
writeFileSync(OUT, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.log(`\nwrote ${OUT}`)