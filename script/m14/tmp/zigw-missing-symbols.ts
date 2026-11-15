// Why are `tagFromName`, `findInList`, `uniqueIndex` and `nameFromUniqueIndex`
// declared in the tree but absent from the symbol table, while their call sites
// publish `calls` edges pointing at them?
import * as fs from "fs"
import { init, parser, analyzer } from "./zigw-harness"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const f = `${CORPUS}/zig/lib/compiler/aro/aro/Attribute/names.zig`
const src = fs.readFileSync(f, "utf8")

await init()
const tree = parser().parse(src)
const res = analyzer().analyze(tree.rootNode, src, f) as any

const WANT = ["tagFromName", "findInList", "uniqueIndex", "nameFromUniqueIndex", "fromName"]
console.log(`symbols: ${(res.symbols ?? []).length}`)
for (const w of WANT) {
  const s = (res.symbols ?? []).find((x: any) => x.name === w)
  console.log(`  ${w.padEnd(22)} ${s ? `SYMBOL kind=${s.kind} line=${s.range?.startLine}` : "*** NO SYMBOL ***"}`)
}

console.log("\ncall sites targeting them:")
for (const r of res.relationships ?? []) {
  if (r.type !== "calls") continue
  if (!WANT.includes(String(r.target))) continue
  console.log(`  L${r.line_number}  ${r.source} -> ${r.target}`)
}

console.log("\nwhat the TREE says about those declarations:")
const stack: any[] = [tree.rootNode]
while (stack.length > 0) {
  const n = stack.pop()!
  if (n.type === "function_declaration") {
    let name: string | null = null
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c && c.type === "identifier") { name = String(c.text); break }
    }
    if (name && WANT.includes(name)) {
      const parent = n.parent
      const grand = parent?.parent
      const anonish = !parent || parent.type === "source_file" || parent.type === "block"
      console.log(`  ${name}: line ${n.startPosition.row + 1}  parent=${parent?.type}  grandparent=${grand?.type}  fileScope=${anonish}`)
      console.log(`      children: ${Array.from({ length: n.namedChildCount }, (_, i) => n.namedChild(i)?.type).join(", ")}`)
    }
  }
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
}
tree.delete()
