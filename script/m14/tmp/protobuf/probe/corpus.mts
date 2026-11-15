/**
 * Protobuf corpus probe — extraction breadth and damage over real repositories.
 *
 * The tree is parsed HERE as well as the analyzer being run, which is what makes
 * PHANTOM detection possible: a phantom is a symbol whose byte range overlaps an
 * ERROR or MISSING node, i.e. a fact the analyzer asserted that the source does
 * not license. A grammar gap does not merely lose facts, it publishes invented
 * ones — graphql's two worst upstream gaps produced
 * `anonymous_operation_1566 -> Int` edges rather than missing ones — so this
 * number is the one that decides whether a lane is honest, and it is reported
 * next to the plain symbol count rather than instead of it.
 *
 * Resolution is reported split three ways, because the aggregate alone is
 * misleading in both directions:
 *   - sameFile   : the endpoint names a type this same file declared;
 *   - crossFile  : the endpoint resolves to a type declared in another corpus
 *                  file. This is CORRECT protobuf — a field's type is routinely
 *                  declared in an imported file — and is not counted as a
 *                  defect;
 *   - unresolved : the endpoint names nothing the corpus declares. On this
 *                  corpus these are the well-known `google.protobuf.*` types,
 *                  which no repo vendors as a declared message.
 *
 * Usage: tsx corpus.mts
 */
import * as fs from "fs"
import * as path from "path"
import { MANIFEST, OUT, ROOT, WASM } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(WASM)))
const { RealProtobufAnalyzer } = await import(path.join(ROOT, "src/ast/real-protobuf-analyzer.ts"))

interface CorpusDef {
  name: string
  role: string
  rev: string
  url?: string
  root: string
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as {
  note?: string
  corpora: CorpusDef[]
}

const analyzer = new RealProtobufAnalyzer()

function walkFiles(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      if (e.name === ".git") continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) stack.push(abs)
      else out.push(abs)
    }
  }
  return out.sort()
}

/** Byte ranges covered by ERROR and MISSING nodes. */
function damagedRanges(root: any): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    for (const c of n.children) {
      if (!c) continue
      if (c.type === "ERROR" || c.isMissing) out.push({ start: c.startIndex, end: c.endIndex })
      else stack.push(c)
    }
  }
  return out
}

interface Row {
  file: string
  corpus: string
  lines: number
  errorNodes: number
  symbols: number
  relationships: number
  imports: number
  phantoms: { name: string; kind: string; line: number }[]
  selfLoops: number
  duplicateIds: number
  symbolsMissingIndexes: number
  declared: Set<string>
  sameFile: number
  crossFile: number
  unresolved: number
  unresolvedSamples: string[]
}

const rows: Row[] = []

for (const c of manifest.corpora) {
  if (!fs.existsSync(c.root)) {
    console.error(`  !! corpus root missing, skipped: ${c.root}`)
    continue
  }
  const files = walkFiles(c.root).filter((f) => f.endsWith(".proto"))
  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8")
    const tree: any = parser.parse(src)
    const res: any = analyzer.analyze(tree.rootNode, src, abs)
    const ranges = damagedRanges(tree.rootNode)
    // The analyzer publishes its resolved id on each symbol as `metadata.id`.
    // Re-deriving `ownerName + "." + name` here would reconstruct the WRONG id
    // for a proto2 group, whose field and type share a name and are told apart
    // by a `#property` suffix — that mis-derivation is what made an earlier
    // version of this probe report 28 duplicate ids and 48 unresolved endpoints
    // that did not exist.
    const declared = new Set<string>()
    const dupIds = new Set<string>()
    for (const s of res.symbols) {
      const full = String(s.metadata?.id ?? (s.ownerName ? `${s.ownerName}.${s.name}` : s.name))
      if (declared.has(full)) dupIds.add(full)
      declared.add(full)
      // Also index the bare name, so a reference from one file to a type
      // declared in another is recognised as cross-file rather than unresolved.
      declared.add(s.name)
    }
    const row: Row = {
      file: path.relative(c.root, abs).split(path.sep).join("/"),
      corpus: c.name,
      lines: src.length ? src.split("\n").length : 0,
      errorNodes: ranges.length,
      symbols: res.symbols.length,
      relationships: res.relationships.length,
      imports: res.imports.length,
      phantoms: [],
      selfLoops: 0,
      duplicateIds: dupIds.size,
      symbolsMissingIndexes: res.symbols.filter(
        (s: any) => s.range.startIndex === undefined || s.range.endIndex === undefined,
      ).length,
      declared,
      sameFile: 0,
      crossFile: 0,
      unresolved: 0,
      unresolvedSamples: [],
    }
    for (const s of res.symbols) {
      if (s.range.startIndex === undefined || s.range.endIndex === undefined) continue
      for (const r of ranges) {
        if (s.range.startIndex < r.end && r.start < s.range.endIndex) {
          row.phantoms.push({ name: s.name, kind: s.kind, line: s.range.startLine })
          break
        }
      }
    }
    for (const rel of res.relationships) {
      if (rel.source && rel.target && rel.source === rel.target) row.selfLoops++
    }
    rows.push(row)
  }
}

// Every id and bare name any file in the corpus declares.
const corpusDeclared = new Set<string>()
for (const r of rows) for (const d of r.declared) corpusDeclared.add(d)

for (const r of rows) {
  const seen = new Set<string>()
  // Re-walk the file's relationships via the stored per-file results.
  const abs = path.join(
    manifest.corpora.find((c) => c.name === r.corpus)!.root,
    r.file.split("/").join(path.sep),
  )
  const src = fs.readFileSync(abs, "utf8")
  const res: any = analyzer.analyze((parser.parse(src) as any).rootNode, src, abs)
  for (const rel of res.relationships) {
    for (const end of [rel.source, rel.target]) {
      if (!end) continue
      const key = `${end}::${rel.type}`
      if (seen.has(key)) continue
      seen.add(key)
      if (r.declared.has(end)) r.sameFile++
      else if (corpusDeclared.has(end) || corpusDeclared.has(end.split(".").pop()!)) r.crossFile++
      else {
        r.unresolved++
        if (r.unresolvedSamples.length < 6) r.unresolvedSamples.push(end)
      }
    }
  }
}

/**
 * Sum a numeric Row field. Array-valued fields are summed by LENGTH, not
 * skipped: an earlier version tested `typeof r[k] === "number"` alone, so the
 * array-valued `phantoms` field contributed 0 on every row and the probe printed
 * "0 phantoms" for a corpus that actually had one. A metric that silently reads
 * zero is worse than a missing metric, because it is believed.
 */
const sum = (xs: Row[], k: keyof Row): number =>
  xs.reduce((a, r) => {
    const v = r[k]
    if (typeof v === "number") return a + v
    if (Array.isArray(v)) return a + v.length
    return a
  }, 0)

const corporaOut = manifest.corpora
  .map((c) => {
    const mine = rows.filter((r) => r.corpus === c.name)
    if (!mine.length) return null
    return {
      corpus: c.name,
      role: c.role,
      rev: c.rev,
      ...(c.url ? { url: c.url } : {}),
      files: mine.length,
      cleanFiles: mine.filter((r) => r.errorNodes === 0).length,
      lines: sum(mine, "lines"),
      errorNodes: sum(mine, "errorNodes"),
      symbols: sum(mine, "symbols"),
      relationships: sum(mine, "relationships"),
      imports: sum(mine, "imports"),
      phantoms: sum(mine, "phantoms"),
      selfLoops: sum(mine, "selfLoops"),
      duplicateIds: sum(mine, "duplicateIds"),
      symbolsMissingIndexes: sum(mine, "symbolsMissingIndexes"),
      sameFileEnds: sum(mine, "sameFile"),
      crossFileEnds: sum(mine, "crossFile"),
      unresolvedEnds: sum(mine, "unresolved"),
      worst: mine
        .filter((r) => r.errorNodes > 0)
        .sort((a, b) => b.errorNodes - a.errorNodes)
        .slice(0, 5)
        .map((r) => ({ file: r.file, errorNodes: r.errorNodes, symbols: r.symbols })),
    }
  })
  .filter(Boolean) as any[]

const total = {
  files: sum(rows, "file" as any) === 0 ? rows.length : rows.length,
  cleanFiles: corporaOut.reduce((a, t) => a + t.cleanFiles, 0),
  lines: corporaOut.reduce((a, t) => a + t.lines, 0),
  errorNodes: corporaOut.reduce((a, t) => a + t.errorNodes, 0),
  symbols: corporaOut.reduce((a, t) => a + t.symbols, 0),
  relationships: corporaOut.reduce((a, t) => a + t.relationships, 0),
  imports: corporaOut.reduce((a, t) => a + t.imports, 0),
  phantoms: corporaOut.reduce((a, t) => a + t.phantoms, 0),
  selfLoops: corporaOut.reduce((a, t) => a + t.selfLoops, 0),
  duplicateIds: corporaOut.reduce((a, t) => a + t.duplicateIds, 0),
  sameFileEnds: corporaOut.reduce((a, t) => a + t.sameFileEnds, 0),
  crossFileEnds: corporaOut.reduce((a, t) => a + t.crossFileEnds, 0),
  unresolvedEnds: corporaOut.reduce((a, t) => a + t.unresolvedEnds, 0),
}

const out = {
  generatedAt: new Date().toISOString(),
  analyzer: "src/ast/real-protobuf-analyzer.ts",
  grammar: "wasm/tree-sitter-protobuf.wasm (vendored, patched, pinned)",
  manifestNote: manifest.note,
  corpora: corporaOut,
  total,
  files: rows.map((r) => ({
    file: r.file,
    corpus: r.corpus,
    lines: r.lines,
    errorNodes: r.errorNodes,
    symbols: r.symbols,
    relationships: r.relationships,
    imports: r.imports,
    phantoms: r.phantoms.length,
    phantomDetail: r.phantoms,
    selfLoops: r.selfLoops,
    duplicateIds: r.duplicateIds,
    sameFileEnds: r.sameFile,
    crossFileEnds: r.crossFile,
    unresolvedEnds: r.unresolved,
    unresolvedSamples: r.unresolvedSamples,
  })),
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "corpus.json"), JSON.stringify(out, null, 2))

console.log(
  `\n  corpus      files  clean   lines  errNodes  symbols   rels  imports  phant  selfLp  dupId`,
)
for (const t of corporaOut) {
  console.log(
    `  ${t.corpus.padEnd(10)} ${String(t.files).padStart(5)} ${String(t.cleanFiles).padStart(5)} ${String(t.lines).padStart(8)} ${String(t.errorNodes).padStart(9)} ${String(t.symbols).padStart(8)} ${String(t.relationships).padStart(6)} ${String(t.imports).padStart(8)} ${String(t.phantoms).padStart(6)} ${String(t.selfLoops).padStart(7)} ${String(t.duplicateIds).padStart(6)}`,
  )
}
console.log(
  `  ${"TOTAL".padEnd(10)} ${String(total.files).padStart(5)} ${String(total.cleanFiles).padStart(5)} ${String(total.lines).padStart(8)} ${String(total.errorNodes).padStart(9)} ${String(total.symbols).padStart(8)} ${String(total.relationships).padStart(6)} ${String(total.imports).padStart(8)} ${String(total.phantoms).padStart(6)} ${String(total.selfLoops).padStart(7)} ${String(total.duplicateIds).padStart(6)}`,
)
console.log(
  `\n  relationship endpoints: ${total.sameFileEnds} same-file, ${total.crossFileEnds} cross-file, ${total.unresolvedEnds} unresolved`,
)
console.log(`\n  wrote ${path.join(OUT, "corpus.json")}`)
