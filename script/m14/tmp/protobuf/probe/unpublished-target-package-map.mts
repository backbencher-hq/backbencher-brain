/**
 * THE 53 UNPUBLISHED `uses` TARGETS — split by cause, with protoc's scope rule
 * re-run against a CORPUS-WIDE package map.
 *
 * ## Why this exists
 *
 * `protobuf-incoming-audit.mts` reports, per type, an `ambiguous` /
 * `nameExistsUnbound` / `hopeless` triple, and its CROSS-FILE VOUCHING block
 * reports one more number: `published by NO file in the corpus 53`. That 53 is
 * a single bucket, and the workstream's own instruction is that a count which
 * merges two opposite findings is not a finding — a target that resolves to
 * nothing because it names a declaration in THIS corpus under a DIFFERENT
 * qualification is a binding defect, and a target that names an external
 * package is not. They print identically in a tally.
 *
 * `unpublished-uses-targets.mts` already separated the 53 by LEAF name, and its
 * output shows the dominant shape immediately: `common.EnterpriseMeta` over 16
 * edges, and the corpus publishes `hashicorp.consul.internal.common.EnterpriseMeta`.
 * The edge names a declaration that EXISTS, one scope-segment short of the id
 * this lane publishes.
 *
 * So the 53 are not 53 findings. They are (at least) three:
 *
 *   A. recoverable by a corpus-wide package map — the target resolves to
 *      exactly one published declaration once protoc's C++-style scope walk is
 *      allowed to see every file, not just this one. This is the `AnalyzeContext`
 *      companion index the lane has carried in §8 since pass 16; this probe
 *      PRICES that bucket instead of asserting it.
 *   B. ambiguous even with the map — the walk lands on two or more declarations.
 *      Per-file the analyzer cannot break this, and the count is the honest one.
 *   C. genuinely absent — no file publishes any id the walk can reach. External
 *      package, a path, a builtin, or a declaration this lane never published.
 *
 * Only C is a claim about this lane's analyzer; A and B are claims about the
 * corpus and about what a per-file analyzer can decide.
 *
 * ## What this measures, and what it does not
 *
 * Ids come from the ANALYZER on its OWN parser, never from `parseFile`, so a
 * production-side parse loss cannot delete a declaration from the index and make
 * a published id look absent. Edges come from `parseFile`, because that is the
 * set a consumer receives.
 *
 * The package map is built by walking every corpus file's own `package` node
 * (by node type, never by matching text) together with its own `import` node
 * paths. protoc maps an imported PATH to a PACKAGE via the include roots it was
 * handed, and this probe never learns the include roots either — so the map is
 * keyed on package prefix, and the walk that consumes it is deliberately the
 * permissive one. That makes this an UPPER BOUND on what a correct companion
 * index would recover, and the report says so in those words rather than
 * presenting the number as the achievable one.
 *
 * A run where the number recovered is 0 is a run that observed nothing, and the
 * probe prints that it establishes nothing either way.
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/unpublished-target-package-map.mts
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = "/tmp/opencode/pb/unpublished-target-package-map.json"

type CorpusFile = { repo: string; rel: string; abs: string; label: string }
const corpus: CorpusFile[] = []
for (const entry of readdirSync(CR).sort()) {
  const dir = path.join(CR, entry)
  let isDir = false
  try { isDir = statSync(dir).isDirectory() } catch { continue }
  if (!isDir) continue
  const walk = (d: string, rel: string): void => {
    let kids: string[]
    try { kids = readdirSync(d) } catch { return }
    for (const k of kids.sort()) {
      if (k === ".git" || k === "node_modules") continue
      const abs = path.join(d, k)
      const r = rel ? `${rel}/${k}` : k
      let st
      try { st = statSync(abs) } catch { continue }
      if (st.isDirectory()) walk(abs, r)
      else if (k.endsWith(".proto")) corpus.push({ repo: entry, rel: r, abs, label: `${entry}/${r}` })
    }
  }
  walk(dir, "")
}
corpus.sort((a, b) => (a.label < b.label ? -1 : 1))

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const LanguageClass = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await LanguageClass.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-protobuf.wasm")))
const analyzer = new RealProtobufAnalyzer()

/** A `package` node's `full_ident`, read by node type. */
function packageOf(root: any): string | null {
  const cur = root.walk()
  let found: any = null
  const visit = (): void => {
    const n: any = cur.currentNode
    if (n.type === "package" && !found) found = n
    if (!found && cur.gotoFirstChild()) {
      do { visit() } while (!found && cur.gotoNextSibling())
      cur.gotoParent()
    }
  }
  visit()
  let out = ""
  if (found) {
    const ident = found.childForFieldName?.("full_ident") ?? found.namedChildren.find((k: any) => k.type === "full_ident")
    out = String(ident?.text ?? "")
  }
  cur.delete?.()
  return out.length > 0 ? out : null
}

type Facts = {
  label: string
  pkg: string | null
  ids: Set<string>
  imports: { dir: string; base: string }[]
  usesTargets: { target: string; source: string }[]
  ownsDecls: boolean
}
const facts: Facts[] = []
let filesOk = 0, filesFail = 0, degraded = 0
let idx = 0

async function worker(): Promise<void> {
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  for (;;) {
    const i = idx++
    if (i >= corpus.length) return
    const f = corpus[i]
    let prod: any
    try { prod = await parseFile(f.abs, path.dirname(f.abs)) } catch { filesFail++; continue }
    filesOk++
    if (prod?.fallback === true) degraded++

    const content = readFileSync(f.abs, "utf8")
    const tree = parser.parse(content)
    const a: any = analyzer.analyze(tree.rootNode, content, f.abs)
    const pkg = packageOf(tree.rootNode)
    tree.delete?.()

    const ids = new Set<string>()
    for (const s of a.symbols ?? []) ids.add(String(s.metadata?.id ?? s.name))

    const imports: Facts["imports"] = []
    const usesTargets: Facts["usesTargets"] = []
    for (const x of prod.relationships ?? []) {
      const kind = String(x.type ?? x.relationshipType ?? "")
      if (kind === "imports") {
        const raw = String((x.metadata as any)?.modulePath ?? x.target ?? "")
        if (!raw) continue
        const cut = raw.lastIndexOf("/")
        imports.push({ dir: cut > 0 ? raw.slice(0, cut) : "", base: cut > 0 ? raw.slice(cut + 1) : raw })
      } else if (kind === "uses") {
        usesTargets.push({ target: String(x.target ?? ""), source: String(x.source ?? "") })
      }
    }
    facts.push({ label: f.label, pkg, ids, imports, usesTargets, ownsDecls: (a.symbols ?? []).length > 0 })
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))
facts.sort((a, b) => (a.label < b.label ? -1 : 1))

/** id -> every file publishing it. */
const publishers = new Map<string, Set<string>>()
for (const f of facts) for (const id of f.ids) {
  let s = publishers.get(id)
  if (!s) { s = new Set(); publishers.set(id, s) }
  s.add(f.label)
}

/**
 * protoc's C++-style relative-name walk, given the whole corpus.
 *
 * For a target written WITHOUT a leading dot, every enclosing scope is tried
 * from the innermost outward and the first candidate the DESCRIPTOR POOL holds
 * wins. The scope chain is the source symbol's own scopes, then the file's
 * package's own scopes, then the root.
 */
function scopeChainOf(sourceId: string, pkg: string | null): string[] {
  const chain: string[] = []
  const push = (v: string): void => { if (!chain.includes(v)) chain.push(v) }
  const segs = sourceId.split(".")
  // drop the FIELD's own leaf: the chain is the scopes the reference sits in
  for (let i = segs.length - 1; i > 0; i--) push(segs.slice(0, i).join("."))
  if (pkg) {
    const ps = pkg.split(".")
    for (let i = ps.length; i > 0; i--) push(ps.slice(0, i).join("."))
  }
  push("")
  return chain
}

type Bucket = "A-recovered-unique" | "B-still-ambiguous" | "C-absent" | "D-already-published"
const rows: { target: string; edges: number; bucket: Bucket; hits: { id: string; file: string }[]; scope: string }[] = []
const bucketEdges: Record<Bucket, number> = { "A-recovered-unique": 0, "B-still-ambiguous": 0, "C-absent": 0, "D-already-published": 0 }
const bucketTargets: Record<Bucket, number> = { "A-recovered-unique": 0, "B-still-ambiguous": 0, "C-absent": 0, "D-already-published": 0 }

for (const f of facts) {
  for (const e of f.usesTargets) {
    const t = e.target
    if (!t) continue
    if (publishers.has(t)) { bucketEdges["D-already-published"]++; bucketTargets["D-already-published"]++; continue }
    const chain = t.startsWith(".")
      ? [""]
      : scopeChainOf(e.source, f.pkg)
    let bucket: Bucket = "C-absent"
    let hits: { id: string; file: string }[] = []
    let scope = ""
    for (const base of chain) {
      const cand = base ? `${base}.${t.startsWith(".") ? t.slice(1) : t}` : (t.startsWith(".") ? t.slice(1) : t)
      const ps = publishers.get(cand)
      if (!ps) continue
      bucket = ps.size === 1 ? "A-recovered-unique" : "B-still-ambiguous"
      scope = base || "(root)"
      hits = [...ps].map((file) => ({ id: cand, file }))
      break
    }
    bucketEdges[bucket]++
    const seen = rows.find((r) => r.target === t)
    if (seen) { seen.edges++; if (seen.bucket === "C-absent" && bucket !== "C-absent") { seen.bucket = bucket; seen.hits = hits; seen.scope = scope } }
    else rows.push({ target: t, edges: 1, bucket, hits, scope })
  }
}

const totalEdges = Object.values(bucketEdges).reduce((a, b) => a + b, 0)
const unpublishedEdges = totalEdges - bucketEdges["D-already-published"]

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`corpus ${corpus.length} .proto files; parsed ${filesOk}, failed ${filesFail}, degraded ${degraded}`)
console.log(`distinct published ids ${publishers.size}; ids published by >1 file ${[...publishers.values()].filter((s) => s.size > 1).length}`)
console.log(`\nuses edges ${totalEdges}, of which unpublished as written ${unpublishedEdges}\n`)
console.log(`${w("bucket", 22)}${w("edges", 9)}${w("distinct", 10)}share`)
console.log("-".repeat(52))
for (const b of ["D-already-published", "A-recovered-unique", "B-still-ambiguous", "C-absent"] as Bucket[]) {
  const share = totalEdges ? ((bucketEdges[b] / totalEdges) * 100).toFixed(2) : "0.00"
  console.log(`${w(b, 22)}${w(String(bucketEdges[b]), 9)}${w(String(bucketTargets[b]), 10)}${share}%`)
}
console.log(`\nA + B = ${bucketEdges["A-recovered-unique"] + bucketEdges["B-still-ambiguous"]} edges reachable by a corpus-wide package map (an UPPER BOUND: this probe never learns protoc's include roots, so it walks more permissively than a correct index would)`)

console.log("\nthe distinct targets, by bucket")
for (const b of ["A-recovered-unique", "B-still-ambiguous", "C-absent"] as Bucket[]) {
  const list = rows.filter((r) => r.bucket === b).sort((x, y) => y.edges - x.edges)
  console.log(`\n${b} — ${list.length} distinct targets`)
  for (const r of list) {
    const hit = r.hits.length ? `${r.hits.length} hit(s) at scope ${r.scope}, first ${r.hits[0].id} in ${r.hits[0].file}` : "no candidate in the corpus"
    console.log(`  ${w(r.target, 46)}${w(String(r.edges), 5)} ${hit}`)
  }
}
if (unpublishedEdges === 0) console.log("\nNOT OBSERVED — this run establishes nothing either way.")

writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), corpusRoot: CR, filesParsed: filesOk, filesFailed: filesFail, degraded, distinctPublishedIds: publishers.size, totalUsesEdges: totalEdges, unpublishedEdges, bucketEdges, bucketTargets, rows: rows.sort((a, b) => b.edges - a.edges) }, null, 2))
console.log(`\nwrote ${OUT}`)