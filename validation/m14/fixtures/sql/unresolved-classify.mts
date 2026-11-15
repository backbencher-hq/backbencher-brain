/**
 * UNRESOLVED CLASSIFY — of every edge target that resolves to nothing, which are declarations this
 * lane failed to publish, and which are not declarations at all?
 *
 * ## WHY THIS EXISTS
 *
 * `incoming-check.ts` reports `unresolvedTargets` as ONE number, and the brief that produced it says
 * plainly that this number is two findings wearing the same coat: an EXTERNAL package or path, and a
 * declaration in this corpus that the analyzer did not publish. Those demand opposite responses — one
 * is correct and must be labelled, the other is a defect the lane owns — and a reader given the total
 * cannot tell them apart, so they cannot act on it either.
 *
 * `ambiguity-split.mts` already splits the unresolved population by the analyzer's OWN
 * `metadata.external` label, read through production `parseFile`, which settles the external half. It
 * cannot settle the other half: its symbol set comes from `parseFile`, so "the analyzer published
 * nothing for this name" and "the corpus declares nothing by this name" are the same observation. That
 * needs a SECOND, INDEPENDENT read of the declarations, and this is it.
 *
 * ## THE INDEPENDENCE, AND ITS LIMITATION
 *
 * Pass A reads declarations the production way: `parseFile` from `src/ast/pool-worker.ts`, which is
 * the entry point whose counts every other number on this lane's page is measured through.
 *
 * Pass B reads them the other way: a direct `web-tree-sitter` parse plus a per-node-type name rule
 * written against the node shape, with no call into the analyzer. It therefore answers a question
 * Pass A structurally cannot: a `create_table` node whose declared name never became a published
 * symbol is a fact about the ANALYZER, visible only from outside it.
 *
 * THE LIMITATION IS DECLARED BECAUSE IT IS REAL. Both passes walk the same grammar, so a grammar bug
 * that hides a declaration from the name rule hides it from the analyzer too, and Pass B reports
 * agreement instead of the defect. Every U1 hit is therefore reported with the node type and the file
 * so it can be read, and the direction of the bias is stated: **U1 is a LOWER bound** — the bucket can
 * only miss defects that the grammar hides from both paths, never invent them.
 *
 * ## THE BUCKETS, and the test each one uses
 *
 *   U1_declaredNotPublished  a declaration node on the parse tree names the target, in a file that
 *                            published no symbol of that name.                  THE DEFECT BUCKET
 *   U2_implicitSequence      the target ends in `_seq` and no `create_sequence` node declares it.
 *                            PostgreSQL creates `<table>_<column>_seq` for a `serial` column with
 *                            no `CREATE SEQUENCE` in any migration, so the name is real in the
 *                            database and absent from the repository by construction.
 *   U3_listedBuiltinLeak     the target IS in the analyzer's own exported `SQL_BUILTINS` and still
 *                            reached an edge — a hole in a suppression that claims to be total.
 *   U4_synthesizedName       the target carries a `.` followed by digits, or is otherwise a name the
 *                            FILE generates rather than any object the database has. Surfacing one
 *                            as a target is the analyzer inventing a dependency.
 *   U5_rest                  neither declared, nor a sequence, nor a listed builtin, nor
 *                            synthesized. The remainder: names the database provides, or names that
 *                            really are dangling. NOT subdivided further, and that is a decision
 *                            rather than an omission — calling a name "platform-provided" needs a
 *                            judgement, and smuggling one into a measurement is how a census becomes
 *                            an opinion. The full frequency table and the file examples are reported
 *                            so a reader can classify them themselves.
 *
 * ## NO REGEX
 *
 * The only string tests are `endsWith` on a literal and `startsWith` on a literal, both in this
 * file and both over a name already lifted off the parse tree by `parseFile`. Nothing here reads SQL
 * text.
 *
 * ## USAGE
 *
 *   npx tsx validation/m14/fixtures/sql/unresolved-classify.mts [--files N] [--out FILE] [--shapes]
 *
 * `--files N` takes a deterministic stride over the same admitted population `ambiguity-split.mts`
 * uses, so the two instruments' numbers are comparable at the same N.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { Parser, Language } from "web-tree-sitter"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { SQL_BUILTINS } from "../../../../src/ast/real-sql-analyzer"
import { fileURLToPath } from "node:url"

const argv = process.argv.slice(2)
const fail = (m: string): never => { console.error(`unresolved-classify: ${m}`); process.exit(2) }
const argOf = (f: string) => {
  const i = argv.indexOf(f)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v == null || v.startsWith("--")) fail(`\`${f}\` has no value`)
  return v
}
const OUT = argOf("--out")
const N = Number(argOf("--files") ?? 600)
const SHAPES = argv.includes("--shapes")
if (!Number.isInteger(N) || N < 1) fail(`--files must be a positive integer, got \`${argOf("--files")}\``)

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "sql"
const SIZE_CAP = 512 * 1024
const TYPES = ["calls", "uses", "contains", "brain_import", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

/** The node types that DECLARE a name something else can reference. */
const DECL_NODES = [
  "create_table", "create_view", "create_materialized_view", "create_function",
  "create_procedure", "create_sequence", "create_index", "create_type", "create_schema",
] as const

// ------------------------------------------------------------------ population

const admitted: { label: string; abs: string; text: string }[] = []
let reposScanned = 0
for (const entry of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, entry)
  let tracked: string[] = []
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    reposScanned++
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text = ""
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    admitted.push({ label: `${entry}/${rel}`, abs, text })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const population = admitted.length
const picked = population <= N ? admitted.slice() : Array.from({ length: N }, (_, i) => admitted[Math.floor((i * population) / N)])

console.log(`unresolved classify — parseFile for edges, an independent tree-sitter pass for declarations`)
console.log(`corpus root        ${CORPUS}`)
console.log(`--files            ${N}${argv.includes("--files") ? "" : "   (DEFAULT)"}`)
console.log(`repos scanned      ${reposScanned}`)
console.log(`admitted population${String(population).padStart(8)}`)
console.log(`sample             ${String(picked.length).padStart(8)}`)

// ------------------------------------------------------------------ pass A: edges, the production way

const publishedByFile = new Map<string, Set<string>>()
const globalPublished = new Set<string>()
const kindOfEdge = new Map<string, number>()
const allEdges: { type: string; target: string; file: string; source: string; memberKind: string | null }[] = []
let symbols = 0
let parseFailures = 0

for (const f of picked) {
  let r: any
  try { r = await parseFile(f.abs, LANG) } catch { parseFailures++; continue }
  const names = new Set<string>()
  for (const s of Array.isArray(r?.symbols) ? r.symbols : []) {
    const n = String(s?.name ?? "")
    if (n.length === 0) continue
    symbols++
    names.add(n)
    globalPublished.add(n)
  }
  publishedByFile.set(f.label, names)
  for (const rel of Array.isArray(r?.relationships) ? r.relationships : []) {
    const type = String(rel?.type ?? "")
    if (!(TYPES as readonly string[]).includes(type)) { kindOfEdge.set(type, (kindOfEdge.get(type) ?? 0) + 1); continue }
    const tgt = String(rel?.target ?? "")
    const src = String(rel?.source ?? "")
    if (tgt.length === 0 || src === tgt) continue
    allEdges.push({ type, target: tgt, file: f.label, source: src, memberKind: rel?.metadata?.memberKind == null ? null : String(rel.metadata.memberKind) })
  }
}

// Resolved against the WHOLE sample's symbol set, not the set as it stood when the file was read.
// Deciding per file instead would make the count a function of file order — an edge in the first file
// could not resolve against a declaration in the last, which is a defect of the INSTRUMENT and reads
// as a defect of the ANALYZER.
const unresolved = allEdges.filter((e) => !globalPublished.has(e.target))

// ------------------------------------------------------------------ pass B: declarations, independently

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-sql.wasm")))
const parser = new Parser()
parser.setLanguage(language as any)

/** name-bearing leaves, the grammar's own answer to "where is an identifier". */
const NAME_LEAF = new Set(["identifier", "literal"])
function firstNameLeaf(n: any): string | null {
  for (const c of n.namedChildren) {
    if (NAME_LEAF.has(c.type) && c.text.length > 0) return c.text
    if (c.type === "object_reference") {
      const l = firstNameLeaf(c)
      if (l) return l
    }
  }
  return null
}

const declaredByFile = new Map<string, { nodeType: string; name: string }[]>()
const shapes = new Map<string, Map<string, number>>()
const shapeUnresolved: Record<string, number> = {}
let treeFailures = 0
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

for (const f of picked) {
  let tree: any
  try { tree = parser.parse(f.text) } catch { treeFailures++; continue }
  if (!tree) { treeFailures++; continue }
  const out: { nodeType: string; name: string }[] = []
  const stack = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    if ((DECL_NODES as readonly string[]).includes(n.type)) {
      let m = shapes.get(n.type); if (!m) { m = new Map(); shapes.set(n.type, m) }
      bump(m, n.namedChildren.map((c: any) => c.type).join(" "))
      const nm = firstNameLeaf(n)
      if (nm == null) shapeUnresolved[n.type] = (shapeUnresolved[n.type] ?? 0) + 1
      else out.push({ nodeType: n.type, name: nm })
    }
    for (let i = n.childCount - 1; i >= 0; i--) { const c = n.child(i); if (c) stack.push(c) }
  }
  declaredByFile.set(f.label, out)
}

/** name -> the declaration sites that carry it, across the whole sample. */
const declaredAt = new Map<string, { file: string; nodeType: string }[]>()
for (const [file, list] of declaredByFile) for (const d of list) {
  const arr = declaredAt.get(d.name)
  if (arr) arr.push({ file, nodeType: d.nodeType })
  else declaredAt.set(d.name, [{ file, nodeType: d.nodeType }])
}

// ------------------------------------------------------------------ classify

type Bucket = "U1_declaredNotPublished" | "U2_implicitSequence" | "U3_listedBuiltinLeak" | "U4_synthesizedName" | "U5_rest"
const buckets: Record<Bucket, number> = {
  U1_declaredNotPublished: 0, U2_implicitSequence: 0, U3_listedBuiltinLeak: 0, U4_synthesizedName: 0, U5_rest: 0,
}
const perType = new Map<string, Record<Bucket, number>>()
const freq = new Map<string, Map<string, number>>()
const examples = new Map<string, Map<string, { file: string; nodeType?: string }[]>>()
const u1Sites = new Map<string, { file: string; nodeType: string }[]>()

const bFor = (t: string) => {
  let m = perType.get(t)
  if (!m) { m = { U1_declaredNotPublished: 0, U2_implicitSequence: 0, U3_listedBuiltinLeak: 0, U4_synthesizedName: 0, U5_rest: 0 }; perType.set(t, m) }
  return m
}
const endsWithSeq = (s: string) => s.length > 4 && s.endsWith("_seq")
const synthesized = (s: string): boolean => {
  // `<stem>.<digits>` — a name the FILE generates. No regex: a dot, then a run of digits to the end.
  const dot = s.lastIndexOf(".")
  if (dot < 0 || dot === s.length - 1) return false
  for (let i = dot + 1; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 48 || c > 57) return false }
  return true
}
const note = (bucket: string, target: string, site: { file: string; nodeType?: string }) => {
  let m = examples.get(bucket); if (!m) { m = new Map(); examples.set(bucket, m) }
  const arr = m.get(target)
  if (arr) { if (arr.length < 3) arr.push(site) } else m.set(target, [site])
}

for (const u of unresolved) {
  const decls = declaredAt.get(u.target)
  const pubHere = publishedByFile.get(u.file)
  let bucket: Bucket
  if (decls && decls.some((d) => !pubHere?.has(u.target))) {
    bucket = "U1_declaredNotPublished"
    const key = `${u.target}`
    const arr = u1Sites.get(key)
    if (arr) { if (arr.length < 6) arr.push(decls[0]) } else u1Sites.set(key, [decls[0]])
  } else if (endsWithSeq(u.target)) bucket = "U2_implicitSequence"
  else if (SQL_BUILTINS.has(u.target.toLowerCase())) bucket = "U3_listedBuiltinLeak"
  else if (synthesized(u.target)) bucket = "U4_synthesizedName"
  else bucket = "U5_rest"
  buckets[bucket]++
  bFor(u.type)[bucket]++
  let fm = freq.get(bucket); if (!fm) { fm = new Map(); freq.set(bucket, fm) }
  bump(fm, u.target)
  note(bucket, u.target, { file: u.file, nodeType: bucket === "U1_declaredNotPublished" ? decls![0].nodeType : undefined })
}

// ------------------------------------------------------------------ report

const pad = (s: string | number, n: number) => String(s).padStart(n)
console.log("")
console.log(`symbols published  ${String(symbols).padStart(8)}   distinct names ${globalPublished.size}`)
console.log(`declarations read  ${String([...declaredByFile.values()].reduce((a, b) => a + b.length, 0)).padStart(8)}   distinct declared names ${declaredAt.size}`)
console.log(`tree failures      ${String(treeFailures).padStart(8)}   parseFile failures ${parseFailures}`)
console.log(`UNRESOLVED EDGES   ${String(unresolved.length).padStart(8)}   (edge types outside the ten: ${JSON.stringify(Object.fromEntries(kindOfEdge))})`)

console.log("")
console.log("A. BUCKETS — denominator is every unresolved edge")
const order: Bucket[] = ["U1_declaredNotPublished", "U2_implicitSequence", "U3_listedBuiltinLeak", "U4_synthesizedName", "U5_rest"]
console.log("type".padEnd(14) + pad("unres", 8) + order.map((b) => pad(b.slice(0, 10), 12)).join(""))
console.log("-".repeat(90))
for (const [t, m] of [...perType].sort()) {
  const tot = order.reduce((a, b) => a + m[b], 0)
  console.log(t.padEnd(14) + pad(tot, 8) + order.map((b) => pad(m[b], 12)).join(""))
}
console.log("TOTAL".padEnd(14) + pad(unresolved.length, 8) + order.map((b) => pad(buckets[b], 12)).join(""))

console.log("")
console.log("B. U1 — DECLARED ON THE PARSE TREE, NOT PUBLISHED. The defect bucket; a LOWER bound.")
console.log("   target   edges  declared at")
for (const [name, sites] of [...u1Sites].sort((a, b) => (freq.get("U1_declaredNotPublished")!.get(b[0])! - freq.get("U1_declaredNotPublished")!.get(a[0])!))) {
  const c = freq.get("U1_declaredNotPublished")!.get(name)!
  console.log(`   ${pad(c, 5)}  ${name}  <- ${sites.map((s) => `${s.nodeType} in ${s.file}`).join(" ; ")}`)
}

for (const b of order) {
  if (b === "U1_declaredNotPublished" || buckets[b] === 0) continue
  const fm = freq.get(b)!
  console.log("")
  console.log(`C. ${b} — ${buckets[b]} edges, ${fm.size} distinct targets`)
  const ex = examples.get(b)!
  for (const [name, c] of [...fm].sort((a, b2) => b2[1] - a[1]).slice(0, 30)) {
    console.log(`   ${pad(c, 5)}  ${name}   ${(ex.get(name) ?? []).map((s) => s.file).slice(0, 2).join(" ; ")}`)
  }
  if (fm.size > 30) console.log(`   ... and ${fm.size - 30} more distinct targets`)
}

if (SHAPES) {
  console.log("")
  console.log("D. THE NAME RULE'S COVERAGE, per node type — a rule that cannot read a node cannot audit it")
  for (const [t, m] of [...shapes].sort()) {
    const total = [...m.values()].reduce((a, b) => a + b, 0)
    console.log(`   ${t.padEnd(26)} ${pad(total, 7)} nodes, ${pad(shapeUnresolved[t] ?? 0, 6)} with no name leaf`)
    for (const [k, c] of [...m].sort((a, b) => b[1] - a[1]).slice(0, 3)) console.log(`        ${pad(c, 6)}  ${k}`)
  }
}

if (OUT) {
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify({
    instrument: "validation/m14/fixtures/sql/unresolved-classify.mts",
    edgeEntryPoint: "parseFile (src/ast/pool-worker.ts)",
    declarationOracle: "direct web-tree-sitter parse + per-node-type name rule (independent of the analyzer)",
    corpusRoot: CORPUS,
    reposScanned,
    admittedPopulation: population,
    requestedFiles: N,
    sampleFiles: picked.length,
    symbolsPublished: symbols,
    distinctPublishedNames: globalPublished.size,
    declarationsRead: [...declaredByFile.values()].reduce((a, b) => a + b.length, 0),
    distinctDeclaredNames: declaredAt.size,
    treeFailures,
    parseFailures,
    unresolvedEdges: unresolved.length,
    edgeTypesOutsideTheTen: Object.fromEntries(kindOfEdge),
    buckets,
    perType: Object.fromEntries([...perType].sort()),
    u1Sites: Object.fromEntries(u1Sites),
    shapeCoverage: Object.fromEntries([...shapes].map(([t, m]) => [t, { nodes: [...m.values()].reduce((a, b) => a + b, 0), noNameLeaf: shapeUnresolved[t] ?? 0, childShapes: Object.fromEntries([...m].sort((a, b) => b[1] - a[1])) }])),
    frequency: Object.fromEntries([...freq].map(([b, m]) => [b, Object.fromEntries([...m].sort((a, b2) => b2[1] - a[1]))])),
    examples: Object.fromEntries([...examples].map(([b, m]) => [b, Object.fromEntries(m)])),
  }, null, 2))
  console.log("")
  console.log(`wrote ${OUT}`)
}
