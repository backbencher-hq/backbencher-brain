// The main walk pushes namedChild(i). Does string_interpolation inside a
// slashy_string appear among named children? If the grammar made it an unnamed
// child there, the walk never visits it. Compare named vs all children.
import { readFileSync } from "node:fs"
import * as m from "../run-fixtures"

async function main(): Promise<void> {
  const parser: any = await (m as any).getParser("groovy")
  const tree = parser.parse('def f(x) { return /a ${x} b/ }\n')
  const slashy: any = []
  const find = (n: any): void => {
    if (n.type === "slashy_string") slashy.push(n)
    for (let i = 0; i < n.childCount; i++) { const c: any = n.child(i); if (c) find(c) }
  }
  find(tree.rootNode)
  const s = slashy[0]
  console.log("slashy namedChildren:", [...(s.namedChildren ?? [])].map((c: any) => c.type))
  const si = s.namedChildren?.find?.((c: any) => c.type === "string_interpolation") ?? [...(s.namedChildren ?? [])][0]
  console.log("string_interpolation IS a named child:", s.namedChildren.some((c: any) => c.type === "string_interpolation"))
  const interp = s.namedChildren.find((c: any) => c.type === "string_interpolation")
  if (interp) {
    console.log("interp namedChildren:", interp.namedChildren.map((c: any) => c.type))
    // walk down: is `identifier x` visible via namedChild?
    console.log("interp namedChildCount:", interp.namedChildCount)
  }
  // and the double-quoted form for comparison
  const t2 = parser.parse('def f(x) { return "a ${x} b" }\n')
  const sl2: any = []
  const find2 = (n: any): void => {
    if (n.type === "string_literal") sl2.push(n)
    for (let i = 0; i < n.childCount; i++) { const c: any = n.child(i); if (c) find2(c) }
  }
  find2(t2.rootNode)
  console.log("\nstring_literal namedChildren:", sl2[0]?.namedChildren?.map((c: any) => c.type))
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
