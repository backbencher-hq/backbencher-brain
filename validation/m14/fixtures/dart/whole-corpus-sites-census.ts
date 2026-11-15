/**
 * WHOLE-CORPUS CONSTRUCT-SITE CENSUS — the number a 120-file sample cannot give.
 *
 * ## The question
 *
 * `bun script/m14/firing-check.mjs DART` reported **10 of 10 types fired** on a 120-file
 * stride sample. A sample can never certify that a type is absent, and this programme has
 * already been sent after two defects a 120-file sample invented (SQL's `contains`, F#'s
 * `exports`) and one it hid (bash's `exports`). So the lane needs the SAME question answered
 * over EVERY `.dart` file in the corpus, together with the half the firing check cannot see:
 * how many files CONTAIN the construct a type is about.
 *
 * That second half is what finds a real emission gap. "Fires 33 times" is not a statement
 * about completeness; "310 files contain an `implements` clause and the analyzer emitted an
 * `implements` edge in 12 of them" is.
 *
 * ## What it counts
 *
 * ONE PARSE PER FILE, two readings of it:
 *
 *   A. the analyzer's output, exactly as `firing-check.mjs` obtains it (getParser -> parse ->
 *      `RealDartAnalyzer.analyze`), tallied per relationship type;
 *   B. an INDEPENDENT walk of the same tree counting CONSTRUCT SITES per type. The walk knows
 *      nothing about the analyzer: it tests node types only.
 *
 * The site rules are drawn from the shipped grammar, and every node type they name was first
 * OBSERVED in `grammar-construct-shapes.ts` over the real corpus (160 types). A rule naming a
 * node type this grammar does not produce would report 0 sites forever, which is exactly the
 * "probe that cannot fire" defect this programme keeps paying for.
 *
 *   extends       `superclass`                          (class X extends Y)
 *   implements    `interfaces`                          (class X implements I, J)
 *   overrides     `annotation` whose text is @override  (Dart's ONLY override marker)
 *   imports       `library_import`
 *   exports       `library_export`
 *   instantiates  `new_expression`, `const_object_expression`
 *   contains      a type declaration WITH a body: `class_definition`, `mixin_declaration`,
 *                 `extension_declaration`, `enum_declaration`, `extension_type_declaration`
 *   calls         `selector` carrying an `argument_part`
 *   references    `type_identifier`
 *   uses          identifier OCCURRENCES — reported as an UPPER BOUND and labelled as one:
 *                 `uses` is an ownership question the tree does not answer by node type.
 *
 * ## Resumable by construction
 *
 * One JSONL row per file, appended and flushed as soon as the file is done, keyed by path. A
 * killed run loses at most the file in flight; re-running skips rows already present. This
 * programme has lost three agent turns to a census that had to start over.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/dart/whole-corpus-sites-census.ts
 *   BB_DART_CORPUS=… BB_DART_MAX=500 npx tsx …        (bounded draw, same stride rule)
 *   BB_DART_JSONL=… BB_DART_SUMMARY=… npx tsx …
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const CORPUS = process.env.BB_DART_CORPUS || "/home/ishaq2321/bb_tests/repositories/dart-sdk"
const JSONL = process.env.BB_DART_JSONL || join(REPO, "validation/m14/fixtures/dart/measurements/dart-whole-corpus.jsonl")
const SUMMARY = process.env.BB_DART_SUMMARY || join(REPO, "validation/m14/fixtures/dart/measurements/dart-whole-corpus-census.json")
const MAX = Number(process.env.BB_DART_MAX || 0)
const RESUME = (process.env.BB_DART_RESUME ?? "1") !== "0"

function discover(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 20) return
    let ents; try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = join(d, e.name)
      if (e.isDirectory()) { if (!/node_modules|\.git|\.dart_tool/.test(e.name)) walk(p, depth + 1) }
      else if (e.name.endsWith(".dart")) out.push(p)
    }
  }
  walk(dir, 0)
  out.sort()
  if (MAX > 0 && out.length > MAX) {
    const stride = out.length / MAX
    const kept: string[] = []
    for (let i = 0; i < MAX; i++) kept.push(out[Math.floor(i * stride)]!)
    return [...new Set(kept)]
  }
  return out
}

const { getParser } = await import(join(REPO, "src/ast/engine.ts"))
const mod = await import(join(REPO, "src/ast/real-dart-analyzer.ts"))
const Cls: any = Object.values(mod).find((v: any) => typeof v === "function" && /Analyzer$/.test(v.name))
if (!Cls) throw new Error("no Analyzer export in real-dart-analyzer.ts")

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]
const SITE_RULES = ["extends", "implements", "overrides", "imports", "exports", "instantiates", "contains", "calls", "references", "uses"]

const TYPE_DECL = new Set(["class_definition", "mixin_declaration", "extension_declaration", "enum_declaration", "extension_type_declaration"])

/** Site counts for one file, from node types only. Iterative with a depth/visit guard. */
function countSites(root: any): Record<string, number> {
  const s: Record<string, number> = {}
  const stack: any[] = [root]
  let guard = 0
  while (stack.length && guard++ < 2_000_000) {
    const n = stack.pop()
    const t = n.type
    if (t === "superclass") s.extends = (s.extends ?? 0) + 1
    else if (t === "interfaces") s.implements = (s.implements ?? 0) + 1
    else if (t === "annotation") { const txt = n.text; if (txt.startsWith("@override")) s.overrides = (s.overrides ?? 0) + 1 }
    else if (t === "library_import") s.imports = (s.imports ?? 0) + 1
    else if (t === "library_export") s.exports = (s.exports ?? 0) + 1
    else if (t === "new_expression" || t === "const_object_expression") s.instantiates = (s.instantiates ?? 0) + 1
    else if (TYPE_DECL.has(t)) s.contains = (s.contains ?? 0) + 1
    else if (t === "selector") {
      let hasArgs = false
      for (let i = 0; i < n.namedChildCount; i++) if (n.namedChild(i)!.type === "argument_part") { hasArgs = true; break }
      if (hasArgs) s.calls = (s.calls ?? 0) + 1
    } else if (t === "type_identifier") s.references = (s.references ?? 0) + 1
    else if (t === "identifier") s.uses = (s.uses ?? 0) + 1
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
  return s
}

const files = discover(CORPUS)
mkdirSync(dirname(JSONL), { recursive: true })

const done = new Set<string>()
if (RESUME && existsSync(JSONL)) {
  for (const line of readFileSync(JSONL, "utf8").split("\n")) {
    if (!line.trim()) continue
    try { done.add(JSON.parse(line).file) } catch {}
  }
}
console.log(`population: ${files.length} .dart files under ${CORPUS}`)
console.log(`already measured: ${done.size}${done.size ? " (resuming)" : ""}`)

const parser = await getParser("dart")
let parsed = 0, failed = 0, skipped = 0, lastLog = Date.now()
const slow: { file: string; ms: number }[] = []

for (const f of files) {
  const rel = f.slice(CORPUS.length + 1)
  if (done.has(rel)) { skipped++; continue }
  let content: string
  try { content = readFileSync(f, "utf8") } catch { failed++; continue }
  const t0 = Date.now()
  try {
    const tree: any = await parser.parse(content, f)
    const res: any = new Cls().analyze(tree.rootNode, content, f)
    const edges: Record<string, number> = {}
    for (const r of res.relationships || []) {
      const t = String(r.relationshipType ?? r.type ?? "")
      if (t) edges[t] = (edges[t] ?? 0) + 1
    }
    const sites = countSites(tree.rootNode)
    const ms = Date.now() - t0
    if (ms > 2000) slow.push({ file: rel, ms })
    appendFileSync(JSONL, JSON.stringify({ file: rel, bytes: content.length, ms, edges, sites }) + "\n")
    parsed++
  } catch (e) {
    failed++
    appendFileSync(JSONL, JSON.stringify({ file: rel, error: String(e).slice(0, 160) }) + "\n")
  }
  if (Date.now() - lastLog > 30_000) {
    lastLog = Date.now()
    console.log(`  … ${parsed + skipped}/${files.length} measured (${parsed} this run, ${failed} failed)`)
  }
}

// ── aggregate everything in the JSONL, not only this run's rows
const agg: Record<string, { edges: number; edgeFiles: number; sites: number; siteFiles: number; siteNoEdge: number; edgeNoSite: number }> = {}
for (const t of ALL_TYPES) agg[t] = { edges: 0, edgeFiles: 0, sites: 0, siteFiles: 0, siteNoEdge: 0, edgeNoSite: 0 }
const missing: Record<string, string[]> = {}
let rows = 0
for (const line of readFileSync(JSONL, "utf8").split("\n")) {
  if (!line.trim()) continue
  let r: any
  try { r = JSON.parse(line) } catch { continue }
  if (!r.edges) continue
  rows++
  for (const t of ALL_TYPES) {
    const e = r.edges[t] ?? 0
    const s = r.sites?.[t] ?? 0
    const a = agg[t]!
    a.edges += e; a.sites += s
    if (e > 0) a.edgeFiles++
    if (s > 0) a.siteFiles++
    if (s > 0 && e === 0) {
      a.siteNoEdge++
      const m = (missing[t] ??= [])
      if (m.length < 10) m.push(`${r.file} (${s} site(s))`)
    }
    if (e > 0 && s === 0) a.edgeNoSite++
  }
}
const summary = {
  corpus: CORPUS,
  filesDiscovered: files.length,
  filesMeasured: rows,
  filesSkippedAsDone: skipped,
  filesFailed: failed,
  deterministic: "single-threaded, sorted discovery, one parse per file",
  analyzerPath: "getParser('dart') -> parse -> RealDartAnalyzer.analyze (the firing-check path)",
  siteRules: {
    extends: "superclass", implements: "interfaces", overrides: "annotation starting @override",
    imports: "library_import", exports: "library_export",
    instantiates: "new_expression | const_object_expression",
    contains: "class_definition | mixin_declaration | extension_declaration | enum_declaration | extension_type_declaration",
    calls: "selector with an argument_part child", references: "type_identifier",
    uses: "identifier (UPPER BOUND — ownership is not a node-type fact)",
  },
  perType: agg,
  sampleSiteNoEdge: missing,
  slowFiles: slow,
}
writeFileSync(SUMMARY, JSON.stringify(summary, null, 2))

console.log(`\nmeasured ${rows} files this corpus${skipped ? ` (${skipped} resumed)` : ""}, ${failed} failed`)
console.log(`type          edges   edgeFiles   sites   siteFiles   siteNoEdge   edgeNoSite`)
for (const t of ALL_TYPES) {
  const a = agg[t]!
  console.log(`${t.padEnd(13)} ${String(a.edges).padStart(6)} ${String(a.edgeFiles).padStart(11)} ${String(a.sites).padStart(7)} ${String(a.siteFiles).padStart(11)} ${String(a.siteNoEdge).padStart(12)} ${String(a.edgeNoSite).padStart(12)}`)
}
console.log(`\nSILENT corpus-wide (siteFiles > 0, edgeFiles === 0): ${ALL_TYPES.filter((t) => agg[t]!.siteFiles > 0 && agg[t]!.edgeFiles === 0).join(" ") || "(none)"}`)
console.log(`wrote ${SUMMARY}`)
