// #908 round 2: is YY_INITIAL_VALUE wrongly collected as a function-LOCAL of
// yyparse (fnLocals)? If so truth suppresses the use and the analyzer emits it.
import fs from "node:fs"

const WTS: any = await import("web-tree-sitter")
const P = WTS.Parser ?? WTS.default ?? WTS
const L = WTS.Language ?? WTS.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(lang)

const src = fs.readFileSync("<corpus-root>/bb_tests/repositories/jq/src/parser.c", "utf8")
const root = parser.parse(src).rootNode

const show = (n: any, depth = 0): void => {
  const ind = "  ".repeat(depth)
  const t = n.text.replace(/\s+/g, " ").slice(0, 70)
  console.log(`${ind}${n.type}@${n.startPosition.row + 1}${n.childForFieldName ? "" : ""} :: ${t}`)
  if (depth >= 3) return
  for (let k = 0; k < n.namedChildCount; k++) show(n.namedChild(k), depth + 1)
}

// the two declarations of interest
const target = [2229, 2230]
const stack: any[] = [root]
const decls: any[] = []
while (stack.length) {
  const n = stack.pop()!
  if (n.type === "declaration" && target.includes(n.startPosition.row + 1)) decls.push(n)
  for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
}
for (const d of decls) {
  console.log(`=== declaration @L${d.startPosition.row + 1} ===`)
  console.log(`  fields: declarator=${d.childForFieldName("declarator")?.type ?? "(none)"} type=${d.childForFieldName("type")?.type ?? "(none)"}`)
  show(d)
}

// replicate the oracle's collectLocalDecl + leftmostDeclaratorIdentifier
const leftmost = (node: any): string | undefined => {
  const LEAF = /^(identifier|field_identifier|type_identifier)$/
  let cur: any = node
  while (cur) {
    if (LEAF.test(cur.type)) return cur.text
    let next: any = null
    for (let k = 0; k < cur.namedChildCount; k++) {
      const c = cur.namedChild(k)
      if (c && (c.type.endsWith("declarator") || LEAF.test(c.type))) {
        if (LEAF.test(c.type)) return c.text
        next = c
        break
      }
    }
    cur = next
  }
  return undefined
}

// find yyparse's function_definition
const fns: any[] = []
const st2: any[] = [root]
while (st2.length) {
  const n = st2.pop()!
  if (n.type === "function_definition" && (n.childForFieldName("declarator")?.text ?? "").includes("yyparse")) fns.push(n)
  for (let i = 0; i < n.namedChildCount; i++) st2.push(n.namedChild(i))
}
console.log(`\nyyparse function_definitions: ${fns.length}`)
const fn = fns[0]
const body = fn.childForFieldName("body")
const locals = new Set<string>()
const attributions: Array<[string, number]> = []
const collect = (node: any): void => {
  if (!node) return
  if (node.type === "declaration") {
    for (let k = 0; k < node.namedChildCount; k++) {
      const c = node.namedChild(k)
      if (c && (c.type.endsWith("declarator") || c.type === "identifier")) {
        const id = leftmost(c)
        if (id) {
          locals.add(id)
          if (id === "YY_INITIAL_VALUE") attributions.push([c.type, c.startPosition.row + 1])
        }
      }
    }
  }
  for (let k = 0; k < node.namedChildCount; k++) collect(node.namedChild(k))
}
collect(body)
console.log(`YY_INITIAL_VALUE in yyparse locals: ${locals.has("YY_INITIAL_VALUE")}`)
for (const [t, l] of attributions) console.log(`  added via child ${t} of a declaration @L${l}`)
