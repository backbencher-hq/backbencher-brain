// #908: why does the c oracle derive no `uses` row for YY_INITIAL_VALUE when
// the analyzer emits one? Parse jq's src/parser.c with the committed c grammar,
// print every mention of the name with its ancestor chain, then ask the oracle
// itself (deriveCCalls) what it produced.
import fs from "node:fs"
import { deriveCCalls } from "../differential"

const WTS: any = await import("web-tree-sitter")
const P = WTS.Parser ?? WTS.default ?? WTS
const L = WTS.Language ?? WTS.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const FILE = "/home/ishaq2321/bb_tests/repositories/jq/src/parser.c"
const src = fs.readFileSync(FILE, "utf8")
const tree = parser.parse(src)
const NAME = "YY_INITIAL_VALUE"

const chain = (n: any): string => {
  const out: string[] = []
  let cur = n.parent
  while (cur) {
    out.push(`${cur.type}@${cur.startPosition.row + 1}`)
    cur = cur.parent
  }
  return out.join(" < ")
}

const hits: any[] = []
const stack: any[] = [tree.rootNode]
while (stack.length) {
  const n = stack.pop()!
  if (n.type === "identifier" && n.text === NAME) hits.push(n)
  for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
}
console.log(`mentions of ${NAME}: ${hits.length}`)
for (const h of hits) {
  const line = h.startPosition.row + 1
  const bol = src.lastIndexOf("\n", h.startIndex - 1) + 1
  const eol = src.indexOf("\n", h.endIndex)
  const text = src.slice(bol, eol < 0 ? src.length : eol)
  console.log(`  L${line} parent=${h.parent?.type}: ${text.trim().slice(0, 90)}`)
  console.log(`    chain: ${chain(h)}`)
}

const edges = deriveCCalls(tree.rootNode, src)
const rows = edges.filter((e: any) => e.target === NAME)
console.log(`\noracle rows targeting ${NAME}: ${rows.length}`)
for (const r of rows) console.log(`  ${r.label} ${r.from} -> ${r.target}`)
const usesYY = edges.filter((e: any) => e.label === "uses" && e.target === "yyparse")
console.log(`oracle rows 'uses yyparse -> ...': ${usesYY.map((e: any) => e.target).join(", ") || "(none)"}`)
