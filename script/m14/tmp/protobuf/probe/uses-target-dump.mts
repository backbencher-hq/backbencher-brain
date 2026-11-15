/**
 * DUMP every `uses` edge's emitted target plus the corpus-wide published id set,
 * so two REVISIONS of the analyzer can be compared by diffing two JSON files.
 *
 * ## Why a dump rather than an in-process A/B
 *
 * The alternative is a flag on the analyzer, and a flag that exists only to turn
 * a production behaviour off is a production surface with no consumer. Instead
 * this probe is run twice — once on HEAD, once with the change applied — and the
 * two dumps are compared. Both runs see the same corpus walk and the same
 * published id set, so a difference in the output is attributable to the source
 * and not to a corpus that moved between runs.
 *
 * The id set comes from the analyzer on ITS OWN parser, never from `parseFile`,
 * so a production-side parse loss cannot delete a declaration from the index and
 * make a published id look absent — which would turn a real binding into an
 * apparent break.
 *
 * ## What the comparison decides
 *
 * For each `uses` edge whose emitted target differs between the two runs:
 *
 *   FIXED  published by 0 files before, exactly 1 after.
 *   BROKE  published by exactly 1 file before, 0 after. This is the number that
 *          decides admissibility. A change that recovers 6 and breaks 1 is a
 *          trade, not a fix.
 *   SWAP   published by exactly 1 both times, but a DIFFERENT declaration. The
 *          reverse walk would follow a real edge to a wrong declaration, which is
 *          worse than an unresolved one and is counted separately for that reason.
 *
 * CLI: npx tsx script/m14/tmp/protobuf/probe/uses-target-dump.mts --out <path>
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"
import { RealProtobufAnalyzer } from "../../../../../src/ast/real-protobuf-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "/tmp/opencode/pb/uses-target-dump.json"

type CorpusFile = { label: string; abs: string }
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
      else if (k.endsWith(".proto")) corpus.push({ label: `${entry}/${r}`, abs })
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

type Edge = { file: string; source: string; target: string }
const edges: Edge[] = []
const published = new Map<string, Set<string>>()
let filesOk = 0, filesFail = 0, degraded = 0
let idx = 0

async function worker(): Promise<void> {
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  for (;;) {
    const i = idx++
    if (i >= corpus.length) return
    const f = corpus[i]
    const content = readFileSync(f.abs, "utf8")

    const tree = parser.parse(content)
    const a: any = analyzer.analyze(tree.rootNode, content, f.abs)
    for (const s of a.symbols ?? []) {
      const id = String(s.metadata?.id ?? s.name)
      let set = published.get(id)
      if (!set) { set = new Set(); published.set(id, set) }
      set.add(f.label)
    }
    tree.delete?.()

    let prod: any
    try { prod = await parseFile(f.abs, path.dirname(f.abs)) } catch { filesFail++; continue }
    filesOk++
    if (prod?.fallback === true) degraded++
    for (const x of prod.relationships ?? []) {
      if (String(x.type ?? x.relationshipType ?? "") !== "uses") continue
      edges.push({ file: f.label, source: String(x.source ?? ""), target: String(x.target ?? "") })
    }
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

edges.sort((a, b) =>
  a.file < b.file ? -1 : a.file > b.file ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : a.target < b.target ? -1 : 1,
)

console.log(`corpus ${corpus.length} .proto; parsed ${filesOk}, failed ${filesFail}, degraded ${degraded}`)
console.log(`uses edges ${edges.length}; distinct published ids ${published.size}`)
writeFileSync(OUT, JSON.stringify({
  at: new Date().toISOString(),
  corpusRoot: CR,
  filesParsed: filesOk,
  filesFailed: filesFail,
  degraded,
  distinctPublishedIds: published.size,
  published: Object.fromEntries([...published].map(([k, v]) => [k, [...v]])),
  edges,
}, null, 2))
console.log(`wrote ${OUT}`)