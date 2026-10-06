/**
 * PROTOBUF LANE — DUPLICATE-ID PROVENANCE: is an ambiguous target the analyzer's
 * choice, or the same declaration vendored into several repositories?
 *
 * ## The question
 *
 * `protobuf-incoming-audit.mts` reports, per relationship type, how many targets
 * bind to MORE THAN ONE published symbol:
 *
 *   uses      1461 edges   target published by >1 file
 *   contains   302 edges   source published by >1 file
 *
 * The workstream's incoming-edge brief names this as the failure it most wants
 * avoided: "A TARGET THAT RESOLVES TO MORE THAN ONE PUBLISHED SYMBOL. The reverse
 * walk picks one by a rule nobody chose." So the number matters. But a count of
 * 1,763 is not yet a finding, because there are three very different things it
 * could be:
 *
 *   (a) a PACKAGE. The analyzer publishes a file's `package X;` as a `namespace`
 *       symbol (real-protobuf-analyzer.ts:1298, `metadata.isProtoPackage`). N
 *       files declaring the same package is correct protobuf — a package is a
 *       namespace and every file in it repeats the declaration. Nothing is
 *       ambiguous and no resolution rule could improve it.
 *   (b) a VENDORED COPY. The well-known `google/protobuf/*.proto` types are
 *       vendored into many repositories, so the corpus holds byte-identical
 *       copies that publish the same fully-qualified id.
 *   (c) a REAL COLLISION — two texts that agree on a fully-qualified name and
 *       disagree on everything else. This is the only class where an arbitrary
 *       pick produces wrong refactoring advice, and it is the only class an
 *       analyzer can do anything about.
 *
 * (b) and (c) are separated by hashing: for every id published by more than one
 * file, SHA-256 over the declaring files' raw bytes. Identical hashes mean one
 * text seen twice; differing hashes mean two texts. Nothing here reads their
 * contents.
 *
 * ## Four defects this probe had before the numbers meant anything
 *
 * 1. Its corpus walk also skipped `vendor`, which removed docker's 135 vendored
 *    protos and printed a population of **686** against the census's **821**. The
 *    walk now skips exactly what `protobuf-census.ts` skips (`.git`,
 *    `node_modules`), and the population is printed on every run so a drift is
 *    visible rather than inferred.
 * 2. Its first classification had no package split, so its widest "divergence"
 *    was `proto2_unittest <- 37 files, 37 distinct hashes` — 37 unittest files
 *    each opening `package proto2_unittest;`. A bare duplicate count reads a
 *    namespace as a collision.
 * 3. Its edge-dedup key could not see `metadata`, so it reported 1,074 redundant
 *    `uses` edges that are 1,074 rpc request/response pairs distinguished by
 *    `metadata.role`.
 * 4. Its dedup sets lived for the whole CORPUS rather than per file, so 3,018
 *    `contains` edges that merely share an id because `descriptor.proto` is
 *    vendored into four repositories were scored as one edge emitted twice. An
 *    independent per-file walk measured 0, which is what exposed it.
 *
 * A fifth, smaller one: the line component of the key read `r.line`, and the field
 * is `line_number` (src/ast/types.ts:143), so every edge keyed as line -1 and the
 * "same ends, different line" column read 0 by construction. Found by noticing
 * that a column which can only be 0 is not a measurement.
 *
 * ## What is measured where
 *
 * Id provenance is read off the analyzer directly, because pool-worker's symbol
 * projection does not carry per-symbol `metadata`, and `metadata.id` is the
 * resolved id every relationship endpoint uses. So this is the ANALYZER-DIRECT
 * population and it is labelled as such wherever it is printed — the same
 * distinction `protobuf-census.ts` draws. The EDGE counts quoted above as context
 * come from the incoming audit's own output, not recomputed here, because
 * recomputing them needs the production entry point and would put two different
 * bands in one table.
 *
 * ## No regular expression
 *
 * String operations only, as the contract requires of a census script.
 *
 * CLI: npx tsx script/m14/protobuf-duplicate-id-provenance.mts [--out /tmp/x.json]
 */
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { RealProtobufAnalyzer } from "../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/opencode/pb/dupids.json"

// ------------------------------------------------------------------ corpus walk

type CorpusFile = { repo: string; rel: string; abs: string }
const corpus: CorpusFile[] = []
const perRepo = new Map<string, number>()
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  let isDir = false
  try {
    isDir = statSync(dir).isDirectory()
  } catch {
    continue
  }
  if (!isDir) continue
  let n = 0
  const stack: string[] = [dir]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    let kids: string[]
    try {
      kids = readdirSync(cur)
    } catch {
      continue
    }
    for (const sub of kids.sort()) {
      const p = path.join(cur, sub)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        // EXACTLY the census's skip list. An earlier version of this probe also
        // skipped `vendor`, which quietly removed docker's 135 vendored protos
        // and printed a population of 686 against the census's 821. The two
        // numbers disagreed and the walk was the one that was wrong.
        if (sub === ".git" || sub === "node_modules") continue
        stack.push(p)
      } else if (sub.endsWith(".proto")) {
        corpus.push({ repo: entry, rel: path.relative(dir, p), abs: p })
        n++
      }
    }
  }
  if (n > 0) perRepo.set(entry, n)
}

// ---------------------------------------------------------------- the grammar
// The bytes the PRODUCT loads: `wasm/tree-sitter-protobuf.wasm`, the same file
// `src/ast/engine.ts` copies to its temp dir. Loading a grammar from
// `node_modules` instead would make this probe a second opinion about which
// grammar the language has, which is the mistake this workstream keeps paying for.
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await LanguageClass.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)
const analyzer = new RealProtobufAnalyzer()

/** The package prefix of a published id, by string slicing at the last dot. */
function packageOf(id: string): string {
  const i = id.lastIndexOf(".")
  return i < 0 ? "" : id.slice(0, i)
}

function repoOf(abs: string): string {
  const rel = path.relative(CR, abs)
  const i = rel.indexOf(path.sep)
  return i < 0 ? rel : rel.slice(0, i)
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((n / d) * 100).toFixed(2)}%`
}

// ------------------------------------------------------------ id provenance

const fileHash = new Map<string, string>()
const hashOf = (abs: string): string => {
  let h = fileHash.get(abs)
  if (h === undefined) {
    h = createHash("sha256").update(readFileSync(abs)).digest("hex")
    fileHash.set(abs, h)
  }
  return h
}

type Slot = { files: Set<string>; isPackage: boolean; declHashes: Set<string> }
const publishers = new Map<string, Slot>()
const edges: { type: string; source: string; target: string; line: number; meta: string; file: string }[] = []
const ALL_TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
]

let filesRead = 0
let filesFailed = 0
let symbolsSeen = 0
let idsSeen = 0
let symbolsWithoutByteRange = 0
let edgesSeen = 0
let edgesWrongShape = 0
for (const c of corpus) {
  const content = readFileSync(c.abs, "utf8")
  fileHash.set(c.abs, createHash("sha256").update(content).digest("hex"))
  let tree
  try {
    tree = parser.parse(content)
  } catch {
    filesFailed++
    continue
  }
  if (tree === null) {
    filesFailed++
    continue
  }
  const res = analyzer.analyze(tree.rootNode, content, c.abs) as {
    symbols?: { range?: { startIndex?: number; endIndex?: number }; metadata?: { id?: string; isProtoPackage?: boolean } }[]
    relationships?: { type?: string; source?: string; target?: string; line_number?: number; metadata?: Record<string, unknown> }[]
  }
  for (const r of res.relationships ?? []) {
    edgesSeen++
    if (typeof r.type !== "string" || typeof r.source !== "string" || typeof r.target !== "string") {
      edgesWrongShape++
      continue
    }
    edges.push({
      type: r.type,
      source: r.source,
      target: r.target,
      line: typeof r.line_number === "number" ? r.line_number : -1,
      meta: stableMeta(r.metadata),
      file: c.abs,
    })
  }
  for (const s of res.symbols ?? []) {
    symbolsSeen++
    const id = s.metadata?.id
    if (typeof id !== "string" || id.length === 0) continue
    idsSeen++
    let slot = publishers.get(id)
    if (slot === undefined) {
      slot = { files: new Set<string>(), isPackage: false, declHashes: new Set<string>() }
      publishers.set(id, slot)
    }
    slot.files.add(c.abs)
    // A package marker on ANY publisher makes the id a package id. If one file
    // called it a namespace and another called it a declaration, that
    // disagreement is itself worth seeing, so the flag records it rather than
    // taking a side on which publisher was seen first.
    if (s.metadata?.isProtoPackage === true) slot.isPackage = true
    // Hash the DECLARATION's own bytes, not the file's. `range.startIndex` is the
    // first non-comment child's start and `range.endIndex` is the node's end
    // (real-protobuf-analyzer.ts:204), so the slice excludes the license header
    // and the doc comment — which is the whole difference between the four
    // helloworld.proto copies this probe first reported as a 4-way divergence.
    const si = s.range?.startIndex
    const ei = s.range?.endIndex
    if (typeof si !== "number" || typeof ei !== "number" || si < 0 || ei < si || ei > content.length) {
      symbolsWithoutByteRange++
      continue
    }
    slot.declHashes.add(createHash("sha256").update(content.slice(si, ei)).digest("hex"))
  }
  filesRead++
}

// The self-check that catches a walk which saw nothing. A run that read no files
// would report 0 duplicates, and 0 agrees with a clean corpus — so refuse to
// print a ratio rather than print one against 0.
if (filesRead === 0 || publishers.size === 0) {
  console.error(`ABORT: files read ${filesRead}, ids published ${publishers.size}. Refusing to report a ratio.`)
  process.exit(1)
}

type Dupe = { id: string; files: string[]; distinctHashes: number; distinctDecls: number; pkg: string; isPackage: boolean }
const dupes: Dupe[] = []
for (const [id, slot] of publishers) {
  if (slot.files.size < 2) continue
  const files = [...slot.files].sort()
  dupes.push({
    id,
    files,
    distinctHashes: new Set(files.map(hashOf)).size,
    distinctDecls: slot.declHashes.size,
    pkg: packageOf(id),
    isPackage: slot.isPackage,
  })
}
const packageDupes = dupes.filter((d) => d.isPackage)
const declDupes = dupes.filter((d) => !d.isPackage)
const byWidest = (a: Dupe, b: Dupe): number => b.files.length - a.files.length || a.id.localeCompare(b.id)

// The discriminator is `distinctDecls`: how many DIFFERENT declaration texts
// publish this id. `distinctHashes` (whole-file) is kept beside it because the
// gap between the two is itself the finding — files that differ in a license
// header declare the same thing.
const sameDecl = declDupes.filter((d) => d.distinctDecls <= 1)
const diffDecl = declDupes.filter((d) => d.distinctDecls > 1)

const byPackage = new Map<string, { ids: number; same: number; differ: number }>()
for (const d of declDupes) {
  const slot = byPackage.get(d.pkg) ?? { ids: 0, same: 0, differ: 0 }
  slot.ids++
  if (d.distinctDecls <= 1) slot.same++
  else slot.differ++
  byPackage.set(d.pkg, slot)
}
const packages = [...byPackage.entries()].sort((a, b) => b[1].ids - a[1].ids)

let crossRepo = 0
let sameRepo = 0
for (const d of declDupes) {
  if (new Set(d.files.map(repoOf)).size > 1) crossRepo++
  else sameRepo++
}

const R = "-".repeat(84)

// ------------------------------------------- EDGE-LEVEL ATTRIBUTION of the classes
//
// The id-level split above says how many NAMES are duplicated. The question the
// incoming-edge brief actually asks is how many EDGES are affected, so each edge
// endpoint is looked up in the class map and tallied per relationship type.
// `imports`/`exports` are counted too and expected to fall out entirely as
// module paths, which is the separation the brief asks for between "external"
// and "never indexed".
type Class = "unique" | "package" | "sameDecl" | "diffDecl" | "notPublished"
const classOf = new Map<string, Class>()
for (const [id, slot] of publishers) classOf.set(id, slot.files.size > 1 ? (slot.isPackage ? "package" : "unset") : "unique")
for (const d of sameDecl) classOf.set(d.id, "sameDecl")
for (const d of diffDecl) classOf.set(d.id, "diffDecl")

const edgeTally = new Map<string, Record<Class, number>>()
for (const t of ALL_TYPES) edgeTally.set(t, { unique: 0, package: 0, sameDecl: 0, diffDecl: 0, notPublished: 0 })
/** An edge is ambiguous when EITHER end names a duplicated id. */
// THREE dedup keys, because "same type + source + target" is not automatically a
// redundant edge. An earlier version of this probe used ONE key and reported 4,567
// redundant edges; every one of the 1,074 `uses` rows was an rpc whose request and
// response are the SAME message, and the analyzer writes `metadata.role` of
// `rpcRequest` and `rpcResponse` on the two edges (real-protobuf-analyzer.ts:974).
// They are two facts, not one fact counted twice, and a key that cannot see
// metadata cannot tell that.
//
//   ends            type + source + target
//   ends+line       ... + line
//   ends+line+meta  ... + metadata   <- only a repeat HERE is true redundancy
// The dedup sets are PER FILE, and that is load-bearing. An earlier version kept
// them for the whole corpus and reported 4,061 "redundant" edges, of which 3,018
// were `contains` — every one a cross-file coincidence: `descriptor.proto` is
// vendored into 4 repositories, each copy emits the same `contains` edge at the
// same line with the same metadata, and a corpus-wide set scored those as one edge
// counted twice. An independent per-file walk measured 0 redundant `contains`
// edges, which is what exposed it. Identical ids ACROSS files are the
// duplicate-id question measured above, not a redundancy question.
const dupeEndsByType = new Map<string, number>()
const dupeLineByType = new Map<string, number>()
const dupeFullByType = new Map<string, number>()
const seenEnds = new Set<string>()
const seenLine = new Set<string>()
const seenFull = new Set<string>()
let currentFile = ""
let edgesCounted = 0
const bump = (m: Map<string, number>, k: string): void => m.set(k, (m.get(k) ?? 0) + 1)
for (const e of edges) {
  if (e.file !== currentFile) {
    currentFile = e.file
    seenEnds.clear()
    seenLine.clear()
    seenFull.clear()
  }
  const kEnds = `${e.type}\u0000${e.source}\u0000${e.target}`
  const kLine = `${kEnds}\u0000${e.line}`
  const kFull = `${kLine}\u0000${e.meta}`
  if (seenFull.has(kFull)) {
    bump(dupeFullByType, e.type)
    continue
  }
  seenFull.add(kFull)
  edgesCounted++
  if (seenLine.has(kLine)) bump(dupeLineByType, e.type)
  else seenLine.add(kLine)
  if (seenEnds.has(kEnds)) bump(dupeEndsByType, e.type)
  else seenEnds.add(kEnds)
  const row = edgeTally.get(e.type)
  if (row === undefined) continue
  for (const end of [e.source, e.target]) {
    const c = classOf.get(end)
    row[(c ?? "notPublished") as Class]++
  }
}

console.log("")
console.log("DUPLICATE-ID PROVENANCE — analyzer-direct population")
console.log(R)
console.log(`corpus                       ${corpus.length} .proto files in ${perRepo.size} repositories`)
console.log(`files read / failed          ${filesRead} / ${filesFailed}`)
console.log(`symbols seen / with an id    ${symbolsSeen} / ${idsSeen}`)
console.log(`symbols with no usable byte range   ${symbolsWithoutByteRange}`)
console.log(`distinct published ids       ${publishers.size}`)
console.log(`ids published by >1 file     ${dupes.length}`)
console.log(`relationships seen           ${edgesSeen}`)
console.log(`  of those, endpoint shape not (string type, source, target)   ${edgesWrongShape}`)
console.log(`  after removing those                              ${edgesSeen - edgesWrongShape}`)
console.log(`  WITHIN-FILE, byte-identical incl. metadata (redundant)   ${sumOf(dupeFullByType)}`)
console.log(`  WITHIN-FILE, same ends + line, differ ONLY in metadata  ${sumOf(dupeLineByType)}`)
console.log(`  WITHIN-FILE, same ends, DIFFERENT line                  ${sumOf(dupeEndsByType) - sumOf(dupeLineByType)}`)
console.log("")
console.log("SPLIT — a package is a NAMESPACE, so N files declaring it is correct protobuf")
console.log(R)
console.log(`  package ids (metadata.isProtoPackage)   ${packageDupes.length}   <- not a collision`)
console.log(`  DECLARATION ids                         ${declDupes.length}   <- the ambiguity population`)
console.log(`  widest package id                       ${widestOf(packageDupes)}`)
console.log("")
console.log("CLASSIFICATION of the DECLARATION ids — by the DECLARATION's own bytes")
console.log(R)
console.log(`  ONE declaration text, N copies           ${sameDecl.length}  (${pct(sameDecl.length, declDupes.length)})`)
console.log(`  MORE THAN ONE declaration text           ${diffDecl.length}  (${pct(diffDecl.length, declDupes.length)})`)
console.log("")
console.log("  the same classification by WHOLE-FILE bytes, for contrast:")
console.log(`    one file text               ${declDupes.filter((d) => d.distinctHashes === 1).length}`)
console.log(`    more than one file text     ${declDupes.filter((d) => d.distinctHashes > 1).length}`)
console.log(`    -> a license header or doc comment alone moved ${declDupes.filter((d) => d.distinctHashes > 1 && d.distinctDecls <= 1).length} ids into "files differ"`)
console.log("")
console.log("EDGE ATTRIBUTION — each edge ENDPOINT looked up in the class map above.")
console.log("An endpoint that is a module path (imports/exports) falls out as notPublished,")
console.log("which is the 'external, not a declaration' class the incoming brief asks to keep apart.")
console.log(R)
console.log(`  ${"type".padEnd(13)} ends  unique  package  sameDecl  diffDecl  notPublished`)
for (const t of ALL_TYPES) {
  const row = edgeTally.get(t) as Record<Class, number>
  const total = ALL_TYPES.includes(t) ? Object.values(row).reduce((a, b) => a + b, 0) : 0
  if (total === 0) continue
  console.log(
    `  ${t.padEnd(13)} ${String(total).padStart(5)} ${String(row.unique).padStart(7)} ${String(row.package).padStart(8)} ` +
      `${String(row.sameDecl).padStart(8)} ${String(row.diffDecl).padStart(9)} ${String(row.notPublished).padStart(14)}`,
  )
}
const allEnds = ALL_TYPES.reduce(
  (acc, t) => {
    const row = edgeTally.get(t) as Record<Class, number>
    for (const k of Object.keys(acc) as Class[]) acc[k] += row[k]
    return acc
  },
  { unique: 0, package: 0, sameDecl: 0, diffDecl: 0, notPublished: 0 } as Record<Class, number>,
)
const allTotal = Object.values(allEnds).reduce((a, b) => a + b, 0)
console.log(`  ${"ALL".padEnd(13)} ${String(allTotal).padStart(5)} ${String(allEnds.unique).padStart(7)} ${String(allEnds.package).padStart(8)} ${String(allEnds.sameDecl).padStart(8)} ${String(allEnds.diffDecl).padStart(9)} ${String(allEnds.notPublished).padStart(14)}`)
console.log("")
console.log("WITHIN-FILE REDUNDANCY by type — the two columns are DIFFERENT findings")
console.log("  redundant          = byte-identical incl. metadata: one edge emitted twice")
console.log("  differ-in-metadata = two facts a metadata-blind key cannot separate")
console.log(`  ${"type".padEnd(13)} redundant   differ-in-metadata`)
for (const t of ALL_TYPES) {
  const r = dupeFullByType.get(t) ?? 0
  const d = dupeLineByType.get(t) ?? 0
  if (r === 0 && d === 0) continue
  console.log(`  ${t.padEnd(13)} ${String(r).padStart(9)}   ${String(d).padStart(18)}`)
}
console.log("")
console.log("SPREAD — the duplicated DECLARATION ids by how many repositories declare them")
console.log(`  declared by >1 repository   ${crossRepo}  (${pct(crossRepo, declDupes.length)})`)
console.log(`  declared within 1 repo      ${sameRepo}  (${pct(sameRepo, declDupes.length)})`)
console.log("")
console.log("TOP PACKAGES by duplicated DECLARATION id")
console.log(`  ${"package".padEnd(44)} ids       same     differ`)
for (const [pkg, s] of packages.slice(0, 18)) {
  console.log(`  ${pkg.slice(0, 44).padEnd(44)} ${String(s.ids).padStart(4)} ${String(s.same).padStart(9)} ${String(s.differ).padStart(8)}`)
}
console.log("")
console.log("WHICH FILES DECLARE THE GENUINELY-AMBIGUOUS ids — the full 222, not a sample")
for (const r of basenameHistogram(diffDecl).slice(0, 14)) {
  console.log(`  ${r.file.padEnd(34)} id-mentions ${String(r.ids).padStart(4)}   across ${r.repos} repo(s)`)
}
console.log(`  ... ${basenameHistogram(diffDecl).length} distinct filenames in total`)
console.log("")
console.log(`ONE DECLARATION TEXT, N COPIES: ${sameDecl.length} ids. The 6 widest:`)
for (const d of [...sameDecl].sort(byWidest).slice(0, 6)) {
  console.log(`  ${d.id}  <- ${d.files.length} files, ${d.distinctHashes} file texts, 1 declaration`)
  for (const f of d.files.slice(0, 3)) console.log(`      ${f.replace(`${CR}/`, "")}`)
  if (d.files.length > 3) console.log(`      ... and ${d.files.length - 3} more`)
}
console.log("")

writeFileSync(
  OUT,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      corpusRoot: CR,
      population: {
        files: corpus.length,
        repos: perRepo.size,
        filesRead,
        filesFailed,
        analyzerDirect: true,
        symbolsSeen,
        idsSeen,
        symbolsWithoutByteRange,
      },
      distinctPublishedIds: publishers.size,
      idsPublishedByMoreThanOneFile: dupes.length,
      packageIds: packageDupes.length,
      declarationIds: declDupes.length,
      oneDeclarationText: sameDecl.length,
      multipleDeclarationTexts: diffDecl.length,
      oneFileText: declDupes.filter((d) => d.distinctHashes === 1).length,
      multipleFileTexts: declDupes.filter((d) => d.distinctHashes > 1).length,
      differByFileButSameDeclaration: declDupes.filter((d) => d.distinctHashes > 1 && d.distinctDecls <= 1).length,
      crossRepo,
      sameRepo,
      edgeAttribution: {
        note: "each edge ENDPOINT, deduplicated by (type, from, to), looked up in the class map",
        edgesSeen,
        edgesWrongShape,
        withinFileRedundant: sumOf(dupeFullByType),
        withinFileSameEndsAndLineDifferInMetadata: sumOf(dupeLineByType),
        withinFileSameEndsDifferentLine: sumOf(dupeEndsByType) - sumOf(dupeLineByType),
        redundantByType: Object.fromEntries(dupeFullByType),
        differOnlyInMetadataByType: Object.fromEntries(dupeLineByType),
        perType: Object.fromEntries([...edgeTally.entries()].map(([t, r]) => [t, r])),
        all: allEnds,
      },
      packages: packages.map(([p, s]) => ({ package: p, ...s })),
      // Which FILENAME declares the duplicated id. The genuine-ambiguity class
      // turns out to be dominated by one file, and a 60-example sample would have
      // made that a guess; the full id list and the full histogram are what make
      // it a measurement.
      multipleDeclarationBasenames: basenameHistogram(diffDecl),
      sameDeclarationBasenames: basenameHistogram(sameDecl),
      examples: {
        sameDeclaration: [...sameDecl].sort(byWidest).slice(0, 40),
        multipleDeclarations: [...diffDecl].sort((a, b) => b.distinctDecls - a.distinctDecls || byWidest(a, b)),
        widestPackage: widestOf(packageDupes),
      },
    },
    null,
    2,
  ),
)
console.log(`wrote ${OUT}`)

/** The widest duplicated id as `id <- n files`, so the split is never a bare count. */
function widestOf(list: Dupe[]): string {
  if (list.length === 0) return "none"
  const w = [...list].sort(byWidest)[0]
  return `${w.id} <- ${w.files.length} files`
}

/**
 * A stable string for an edge's metadata, so two edges that differ only in their
 * metadata are separable. Keys are sorted so object insertion order cannot make
 * two equal edges look different.
 */
function stableMeta(m: Record<string, unknown> | undefined): string {
  if (m === undefined || m === null) return ""
  const keys = Object.keys(m).sort()
  const parts: string[] = []
  for (const k of keys) {
    const v = m[k]
    if (v === null || v === undefined) continue
    if (typeof v === "object") {
      // One level of nesting is enough for this analyzer's metadata and keeps the
      // comparison total; anything deeper falls back to its key NAMES, which is
      // still stable and still separates an empty object from a populated one.
      const inner = Object.keys(v as Record<string, unknown>).sort()
      parts.push(`${k}={${inner.join(",")}}`)
    } else {
      parts.push(`${k}=${String(v)}`)
    }
  }
  return parts.join(";")
}

/** Sum a per-type tally, for the one-line totals above the table. */
function sumOf(m: Map<string, number>): number {
  let n = 0
  for (const v of m.values()) n += v
  return n
}

/** How many ids each declaring FILENAME accounts for. The tail of the table is the point. */
function basenameHistogram(list: Dupe[]): { file: string; ids: number; repos: number }[] {
  const byFile = new Map<string, { ids: number; repos: Set<string> }>()
  for (const d of list) {
    for (const f of d.files) {
      const base = path.basename(f)
      const slot = byFile.get(base) ?? { ids: 0, repos: new Set<string>() }
      slot.ids++
      slot.repos.add(repoOf(f))
      byFile.set(base, slot)
    }
  }
  return [...byFile.entries()]
    .map(([file, s]) => ({ file, ids: s.ids, repos: s.repos.size }))
    .sort((a, b) => b.ids - a.ids || a.file.localeCompare(b.file))
}
