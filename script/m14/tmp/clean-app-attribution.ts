// script/m14/tmp/clean-app-attribution.ts
//
// Attribution triage: for every `application` whose head identifier has a given
// text, print the head's text, position, and its full ancestor chain — so the
// scope that a call would attribute to is read off the tree instead of guessed.
//
// Run: bun script/m14/tmp/clean-app-attribution.ts <Corpus> <relative/path.icl> <headText>
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = process.cwd()
const CORPUS = "<corpus-root>/bb_tests/repositories"
const repo = process.argv[2] ?? "clean-stdlib"
const rel = process.argv[3] ?? "StdOverloadedList.icl"
const head = process.argv[4] ?? "flatten"
const full = path.join(CORPUS, repo, rel)

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(lang)

const src = readFileSync(full, "utf8")
const root = parser.parse(src).rootNode

const walk = (n: any, out: any[]) => {
  if (n.type === "application" && (n.namedChildCount ?? 0) > 0) {
    const h = n.namedChild(0)
    if (h?.type === "identifier" && h.text === head) out.push({ node: n, head: h })
  }
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) walk(c, out) }
}
const hits: any[] = []
walk(root, hits)
console.log(`applications with head '${head}': ${hits.length}`)
for (const h of hits) {
  const chain: string[] = []
  let cur = h.node.parent
  while (cur) {
    const field = cur.parent ? Object.keys(cur.parent).length >= 0 ? "" : "" : ""
    chain.push(`${cur.type}${field}`)
    cur = cur.parent
  }
  console.log(`  line ${h.node.startPosition.row + 1} col ${h.node.startPosition.column + 1}  text=<${h.node.text.replace(/\s+/g, " ").slice(0, 70)}>`)
  console.log(`    ancestry: ${chain.join(" < ")}`)
}
