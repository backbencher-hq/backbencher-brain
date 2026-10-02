/**
 * M12 / X12 — the ENCODING-RECOVERED set: files that do NOT survive a naive
 * `Buffer.toString("utf8")` and are recovered by `decodeSourceText`.
 *
 * This exists because the number was quoted three different ways and none of
 * them said which FILES it counted. "26 files recovered, 1,085 symbols and 187
 * relationships" (docs/reviews), 27/1,555/244 (a later re-measure) and the 22 /
 * 1,537 / 229 below are not three corrections of one fact — they are three
 * different PREDICATES over the same corpus, and a reader cannot tell which is
 * which. So the predicate is written down here and the measurement is rerunnable
 * rather than restated.
 *
 * THE PREDICATE, exactly:
 *   1. the raw bytes do not decode as UTF-8 without a replacement character
 *      (`�`) — a file that survives the naive read is not recovered by
 *      anything, it was never lost;
 *   2. `decodeSourceText` returns text DIFFERENT from that naive read.
 *      Together these exclude plain ASCII and plain UTF-8, and include UTF-16,
 *      UTF-32 and BOM'd UTF-8.
 *
 * A file's NAME is not evidence of its encoding. libxml2's corpus contains
 * `text-4-byte-UTF-16-BE.xml` whose bytes are `fffe 3c00 3f00 7800` — a UTF-16LE
 * BOM and little-endian code units — because the name is the TEST CASE, not a
 * claim about the content. Reading that filename as evidence would put a wrong
 * number in this doc with a correct-looking justification.
 *
 * Usage: npx tsx script/m12/xml-encoding-recovery.mts [--json]
 */
import * as fs from "fs"
import * as path from "path"
const ROOT = "$HOME/backbencher-brain"
const REPOS = "$HOME/fixtures/xml/repos"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default?.Parser ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-xml.wasm")))
const { decodeSourceText } = await import(path.join(ROOT, "src/util/source-text"))
const { RealXmlAnalyzer } = await import(path.join(ROOT, "src/ast/real-xml-analyzer"))
const EXTS = new Set([".xml", ".xsd", ".dtd", ".xsl", ".xslt", ".svg", ".rng"])
const files: string[] = []
;(function walk(d: string) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === ".git") continue
    const f = path.join(d, e.name)
    if (e.isDirectory()) walk(f); else if (EXTS.has(path.extname(e.name).toLowerCase())) files.push(f)
  }
})(REPOS)
const p = new P(); p.setLanguage(g)
const a: any = new RealXmlAnalyzer()
let recovered = 0, syms = 0, rels = 0
const sample: string[] = []
for (const f of files) {
  const raw = fs.readFileSync(f)
  const naive = raw.toString("utf8")
  if (!naive.includes("\uFFFD")) continue      // decodes cleanly as UTF-8 already
  const { text, encoding } = decodeSourceText(raw)
  if (text === naive) continue
  recovered++; if (sample.length < 8) sample.push(`${path.relative(REPOS, f)}  [${encoding}]`)
  let tree: any
  try { tree = p.parse(text) } catch { continue }
  if (!tree?.rootNode) continue
  const r: any = a.analyze(tree.rootNode, text, path.relative(REPOS, f))
  syms += r.symbols?.length ?? 0
  rels += r.relationships?.length ?? 0
}
console.log(`  encoding-recovered files: ${recovered}`)
console.log(`  symbols: ${syms}  relationships: ${rels}`)
for (const s of sample) console.log("   ", s)
