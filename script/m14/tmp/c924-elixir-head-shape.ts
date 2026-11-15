// c924-elixir-head-shape — the exact node shape behind the two elixir E defects.
//
// The probe `c924-node-types.ts` proves the comment node's parent is a binary_operator,
// but not WHICH child slot it occupies, and the analyzer reads the name at `child(1)`.
// This prints the real fixture's head structure, one level at a time, so the patch reads
// the tree instead of a guess.
//
// Run: bun script/m14/tmp/c924-elixir-head-shape.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FIXTURE = "/home/ishaq2321/bb_tests/repositories/elixir/lib/elixir/lib/list.ex"

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-elixir.wasm")))
const p = new P()
p.setLanguage(language)
const tree = p.parse(fs.readFileSync(FIXTURE, "utf8"))
const root = tree.rootNode
const flat = (s: string) => String(s).replace(/\s+/g, " ")

// The defp call whose head is split by a comment: its text contains the comment and
// it carries a do_block child.
let target: any = null
const stack = [root]
while (stack.length) {
  const n = stack.pop()!
  if (n.type === "call" && flat(n.text).includes("# 7..13") && n.text.includes("do")) {
    if (!target || n.endIndex - n.startIndex < target.endIndex - target.startIndex) target = n
  }
  for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
}

if (!target) { console.log("defp call not found"); process.exit(1) }

const show = (n: any, depth: number, label: string) => {
  const pad = "  ".repeat(depth)
  console.log(`${pad}${label}${n.type}(${n.namedChildCount}c${n.childCount - n.namedChildCount}tok) line=${n.startPosition.row + 1} text=${JSON.stringify(flat(n.text).slice(0, 70))}`)
}
const kids = (n: any, depth: number) => {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    const f = typeof n.fieldNameForChild === "function" ? n.fieldNameForChild(i) : null
    show(c, depth, `[${i}]${f ? `(${f})` : ""}${c.isNamed ? "" : " TOKEN "}`)
  }
}

console.log(`defp call @ line ${target.startPosition.row + 1}:`)
kids(target, 1)
console.log(`\n--- its non-token children, one more level ---`)
for (let i = 0; i < target.childCount; i++) {
  const c = target.child(i)
  if (!c.isNamed) continue
  show(c, 2, `child[${i}] `)
  kids(c, 3)
}

// The binary_operator the head hides behind — every child, with its index and token flag,
// because `name = actualCall.child(1)?.text` reads ONE index.
const walk: any[] = [target]
while (walk.length) {
  const c = walk.pop()!
  if (c.type !== "binary_operator") {
    for (let i = 0; i < c.namedChildCount; i++) walk.push(c.namedChild(i))
    continue
  }
  console.log(`\n--- binary_operator children (full text, not truncated) ---`)
  for (let j = 0; j < c.childCount; j++) {
    const k = c.child(j)
    const f = typeof c.fieldNameForChild === "function" ? c.fieldNameForChild(j) : null
    console.log(`  [${j}]${f ? `(${f})` : ""}${k.isNamed ? " named" : " TOKEN"} <${k.type}> line=${k.startPosition.row + 1} text=${JSON.stringify(flat(k.text).slice(0, 90))}`)
  }
}

// The visitor's view: what `filterChildren(node, c => c.type !== "identifier" && c.type !== "do_block")` keeps.
const kept = []
for (let i = 0; i < target.namedChildCount; i++) {
  const c = target.namedChild(i)
  if (c.type !== "identifier" && c.type !== "do_block") kept.push(c.type)
}
console.log(`\nsigNodes (what processFunction keeps first): ${kept.join(", ")}`)
